// Dummy statements for round 22, Closebook step 3 rework (Hashim, Nov 16, 2026). Run:
//   node tests/fixtures/statements/round22/make.mjs
// The test file is "Willow Dummy Realty Inc.", year Sep 1, 2025 to Aug 31, 2026. All names are dummies.
// Writes each PDF and the ReadResult a perfect reader returns (<name>.json), then adds them to
// ../manifest.json (sha256 of the bytes -> result) for the test reader, keeping the round 20 entries.
//   - mdb-chq-*.pdf: Maple Dummy Bank chequing ••• 2201, statements from the 3rd to the 2nd, 13 of them
//     (Aug 3 to Sep 2, 2025 crosses the year start; Aug 3 to Sep 2, 2026 crosses the year end). Three
//     payments go to "MC 4455", a card the file does not have.
//   - ndb-chq-*.pdf: Northern Dummy Bank chequing ••• 3302, calendar months Sep 2025 to Aug 2026. Sep opens
//     at 5,860.00 and cheque #204 (written last year) clears on Sep 4. ndb-chq-2026-02-locked.pdf is February,
//     locked with AES-256 and an empty password to open (the viewer test).
//   - mdb-visa-*.pdf: Maple Dummy Bank Visa ••• 4405, cycles on the 16th, with transaction and posting
//     dates and interest and fees in the summary: Jul 16 to Aug 15, 2025 (outside the year) and 13 cycles
//     from Aug 16, 2025 to Sep 15, 2026. The last one is the mock's screen 5. mdb-visa-2025-11.pdf has two
//     lines the reader was not sure of ("Needs a look").
// PDFs are made with pdfmake (fixed dates, so the same bytes each run), except the AES-256 one: encryption
// uses random keys, so its bytes (and its manifest entry) change each time this runs.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake");
const DIR = dirname(fileURLToPath(import.meta.url));
const PARENT = join(DIR, "..");
mkdirSync(DIR, { recursive: true });

const fmt = (c) => { const n = c < 0; const a = Math.abs(c); return (n ? "-" : "") + String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(a % 100).padStart(2, "0"); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.toISOString().slice(0, 10); };
const parts = (s) => s.split("-").map(Number);
const short = (s) => { const [, m, d] = parts(s); return `${MON[m - 1]} ${String(d).padStart(2, "0")}`; };
const long = (s) => { const [y, m, d] = parts(s); return `${MON[m - 1]} ${d}, ${y}`; };
const addMonths = (s, k) => { const [y, m, d] = parts(s); return iso(y, m + k, d); };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cents = (r, lo, hi) => Math.round(lo * 100 + r() * (hi - lo) * 100);

const printer = new PdfPrinter({ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } });
const pdfBuffer = (doc, opts) => new Promise((resolve, reject) => {
  const pdf = printer.createPdfKitDocument(doc, opts);
  const chunks = []; pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
});
const grid = { hLineWidth: (i, n) => (i <= 1 || i === n.table.body.length ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: (i) => (i <= 1 ? "#7a8aa3" : "#d4d8de"),
  paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 2.6, paddingBottom: () => 2.6 };

const files = [];
const L = (n, date, description, amountCents, dir, extra = {}) => ({ id: `l${n}`, date, description, amountCents, dir, balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read", ...extra });

// ---------- A bank statement
async function bankStatement(rel, bank, acct, period, opening, raw, { lock = false } = {}) {
  let bal = opening, inT = 0, inN = 0, outT = 0, outN = 0;
  const lines = raw.map(([date, desc, c, dir], i) => {
    bal += dir === "in" ? c : -c;
    if (dir === "in") { inT += c; inN++; } else { outT += c; outN++; }
    return L(i + 1, date, desc, c, dir, { balanceCents: bal });
  });
  const result = { bank: bank.name, pages: 1, accounts: [{ key: "a1", last4: acct.last4, name: acct.name, kind: "bank", periodStart: period[0], periodEnd: period[1],
    opening, closing: bal, summary: { inTotal: inT, inCount: inN, outTotal: outT, outCount: outN }, lines }] };
  const body = [[{ text: "Date", bold: true }, { text: "Description", bold: true }, { text: "Withdrawals", bold: true, alignment: "right" }, { text: "Deposits", bold: true, alignment: "right" }, { text: "Balance", bold: true, alignment: "right" }],
    [short(period[0]), "Opening balance", "", "", { text: fmt(opening), alignment: "right" }],
    ...lines.map((l) => [short(l.date), l.description, { text: l.dir === "out" ? fmt(l.amountCents) : "", alignment: "right" }, { text: l.dir === "in" ? fmt(l.amountCents) : "", alignment: "right" }, { text: fmt(l.balanceCents), alignment: "right" }]),
    [short(period[1]), { text: "Closing balance", bold: true }, "", "", { text: fmt(bal), alignment: "right", bold: true }]];
  const doc = {
    pageSize: "LETTER", pageMargins: [44, 44, 44, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: `${bank.name} statement ${period[1]}`, author: bank.name, producer: "Dummy statement generator", creationDate: new Date(`${period[1]}T06:00:00Z`), modDate: new Date(`${period[1]}T06:00:00Z`) },
    content: [
      { columns: [{ text: bank.name.toUpperCase(), bold: true, fontSize: 15, color: bank.color }, { text: `Statement period\n${long(period[0])} to ${long(period[1])}`, alignment: "right" }] },
      { text: "Willow Dummy Realty Inc.\n100 Dummy Street, Kitchener ON N2G 0A0", margin: [0, 12, 0, 8] },
      { text: `${acct.name} ••• ${acct.last4}`, bold: true, fontSize: 11, margin: [0, 0, 0, 6] },
      { table: { widths: ["*", "*", "*", "*"], body: [["Opening balance", `Deposits (${inN})`, `Withdrawals (${outN})`, "Closing balance"], [fmt(opening), fmt(inT), fmt(outT), fmt(bal)]] }, layout: "lightHorizontalLines", margin: [0, 0, 0, 10] },
      { table: { headerRows: 1, widths: [44, "*", 70, 70, 74], body }, layout: grid },
      { text: "Dummy statement for testing. Not a real account.", color: "#888", margin: [0, 16, 0, 0] },
    ],
  };
  const opts = lock ? { userPassword: "", ownerPassword: "dummy-owner-pass", pdfVersion: "1.7ext3", permissions: { printing: "highResolution", copying: false, modifying: false } } : undefined;
  const lockedDoc = lock ? { ...doc, version: "1.7ext3", ownerPassword: "dummy-owner-pass", permissions: { printing: "highResolution", copying: false, modifying: false } } : doc;
  writeFileSync(join(DIR, rel), await pdfBuffer(lockedDoc, opts));
  const json = rel.replace(/\.pdf$/, ".json");
  writeFileSync(join(DIR, json), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round22/${rel}`, result: `round22/${json}` });
  return result.accounts[0];
}

// ---------- A card statement (transaction and posting dates; interest and fees on their own)
async function cardStatement(rel, bank, acct, period, opening, raw, { unsure = [] } = {}) {
  let bal = opening, inT = 0, inN = 0, outT = 0, outN = 0, interest = 0, fees = 0;
  const lines = raw.map(([date, posted, desc, c, dir], i) => {
    bal += dir === "in" ? c : -c;
    if (dir === "in") { inT += c; inN++; } else { outT += c; outN++; }
    if (/INTEREST/.test(desc)) interest += c;
    if (/FEE/.test(desc)) fees += c;
    const u = unsure.includes(i) ? { unsure: true, unsureReason: "part of the amount is smudged" } : {};
    return L(i + 1, date, desc, c, dir, { postedDate: posted, ...u });
  });
  const result = { bank: bank.name, pages: 1, accounts: [{ key: "a1", last4: acct.last4, name: acct.name, kind: "card", periodStart: period[0], periodEnd: period[1],
    opening, closing: bal, summary: { inTotal: inT, inCount: inN, outTotal: outT, outCount: outN, interest, fees }, lines }] };
  const purchases = inT - interest - fees;
  const body = [[{ text: "Trans. date", bold: true }, { text: "Posting date", bold: true }, { text: "Description", bold: true }, { text: "Amount ($)", bold: true, alignment: "right" }],
    ...lines.map((l) => [short(l.date), short(l.postedDate), l.description, { text: l.dir === "out" ? `-${fmt(l.amountCents)}` : fmt(l.amountCents), alignment: "right" }])];
  const doc = {
    pageSize: "LETTER", pageMargins: [44, 44, 44, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: `${acct.name} statement ${period[1]}`, author: bank.name, producer: "Dummy statement generator", creationDate: new Date(`${period[1]}T06:00:00Z`), modDate: new Date(`${period[1]}T06:00:00Z`) },
    content: [
      { columns: [{ text: `${bank.name.toUpperCase()} ${acct.name.toUpperCase()}`, bold: true, fontSize: 14, color: bank.color }, { text: `Statement period\n${long(period[0])} to ${long(period[1])}`, alignment: "right" }] },
      { text: `Willow Dummy Realty Inc.\nCard number •••• •••• •••• ${acct.last4}`, margin: [0, 12, 0, 8] },
      { text: "Account summary", bold: true, margin: [0, 0, 0, 4] },
      { table: { widths: ["*", 90], body: [["Previous balance", { text: fmt(opening), alignment: "right" }], [`Purchases and cash advances (${inN - (interest ? 1 : 0) - (fees ? 1 : 0)})`, { text: `+${fmt(purchases)}`, alignment: "right" }],
        ["Interest", { text: `+${fmt(interest)}`, alignment: "right" }], ["Fees", { text: `+${fmt(fees)}`, alignment: "right" }], [`Payments and credits (${outN})`, { text: `-${fmt(outT)}`, alignment: "right" }],
        [{ text: "New balance", bold: true }, { text: fmt(bal), alignment: "right", bold: true }]] }, layout: "lightHorizontalLines", margin: [0, 0, 200, 12] },
      { table: { headerRows: 1, widths: [60, 60, "*", 80], body }, layout: grid },
      { text: "Dummy statement for testing. Not a real card.", color: "#888", margin: [0, 16, 0, 0] },
    ],
  };
  writeFileSync(join(DIR, rel), await pdfBuffer(doc));
  const json = rel.replace(/\.pdf$/, ".json");
  writeFileSync(join(DIR, json), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round22/${rel}`, result: `round22/${json}` });
  return result.accounts[0];
}

const MDB = { name: "Maple Dummy Bank", color: "#7a1f1f" }, NDB = { name: "Northern Dummy Bank", color: "#14386b" };

// ---------- 1. MDB chequing ••• 2201, the 3rd to the 2nd
{
  const acct = { name: "Business chequing", last4: "2201" };
  // The mock's screen 4: Aug 3 to Sep 2, 2025. Balance on Aug 31, 2025: 1,957.62.
  let a = await bankStatement("mdb-chq-2025-08.pdf", MDB, acct, ["2025-08-03", "2025-09-02"], 293510, [
    ["2025-08-05", "PAD DUMMY TELECOM", 41230, "out"], ["2025-08-08", "COMMISSION DEPOSIT DUMMY BROKERAGE", 120000, "in"], ["2025-08-14", "ONLINE PAYMENT MDB VISA", 105000, "out"],
    ["2025-08-20", "PAD DUMMY MLS BOARD", 38968, "out"], ["2025-08-27", "CHEQUE #118", 32550, "out"], ["2025-09-02", "MOBILE CHEQUE DEPOSIT", 125000, "in"]]);
  const r = rng(22);
  for (let k = 1; k <= 12; k++) {
    const from = addMonths("2025-08-03", k), to = addMonths("2025-09-02", k);
    const [y, m] = parts(from);
    const raw = [
      [iso(y, m, 5), "PAD DUMMY TELECOM", cents(r, 380, 460), "out"],
      [iso(y, m, 9), "COMMISSION DEPOSIT DUMMY BROKERAGE", cents(r, 2600, 5200), "in"],
      [iso(y, m, 15), "ONLINE PAYMENT MDB VISA", cents(r, 700, 1500), "out"],
      [iso(y, m, 21), "PAD DUMMY MLS BOARD", 38968, "out"],
    ];
    if ([3, 6, 9].includes(k)) raw.push([iso(y, m, 24), "ONLINE PAYMENT MC 4455", [121000, 98450, 133020][[3, 6, 9].indexOf(k)], "out"]);
    raw.push([iso(y, m, 28), "BANK SERVICE FEE", 2995, "out"]);
    if (k === 12) raw.push(["2026-09-01", "COMMISSION DEPOSIT DUMMY BROKERAGE", 210000, "in"]);
    a = await bankStatement(`mdb-chq-${from.slice(0, 7)}.pdf`, MDB, acct, [from, to], a.closing, raw);
  }
}

// ---------- 2. NDB chequing ••• 3302, calendar months; February also locked with AES-256
{
  const acct = { name: "Business chequing", last4: "3302" };
  const r = rng(33);
  let opening = 586000;
  for (let k = 0; k < 12; k++) {
    const from = addMonths("2025-09-01", k), [y, m] = parts(from), to = iso(y, m, daysIn(y, m));
    const raw = k === 0 ? [["2025-09-04", "CHEQUE #204", 45000, "out"]] : [];
    raw.push([iso(y, m, 7), "DUMMY INSURANCE PAD", 21460, "out"], [iso(y, m, 12), "COMMISSION DEPOSIT", cents(r, 1800, 4200), "in"],
      [iso(y, m, 18), "ONLINE PAYMENT NDB MC", cents(r, 300, 900), "out"], [iso(y, m, 26), "TRANSFER TO DUMMY SAVINGS", cents(r, 500, 1500), "out"]);
    const name = `ndb-chq-${from.slice(0, 7)}${k === 5 ? "-locked" : ""}.pdf`;
    const a = await bankStatement(name, NDB, acct, [from, to], opening, raw, { lock: k === 5 });
    opening = a.closing;
  }
}

// ---------- 3. MDB Visa ••• 4405, cycles on the 16th
{
  const acct = { name: "Visa Business", last4: "4405" };
  const S = (d, p, desc, c, dir) => [d, p, desc, c, dir];
  // Outside the year: Jul 16 to Aug 15, 2025.
  await cardStatement("mdb-visa-2025-07.pdf", MDB, acct, ["2025-07-16", "2025-08-15"], 64000, [
    S("2025-07-20", "2025-07-21", "PAYMENT - THANK YOU", 64000, "out"), S("2025-07-28", "2025-07-29", "DUMMY OFFICE SUPPLY", 98000, "in")]);
  // Aug 16 to Sep 15, 2025: owing 1,322.08 on Aug 31, 2025.
  let c = await cardStatement("mdb-visa-2025-08.pdf", MDB, acct, ["2025-08-16", "2025-09-15"], 98000, [
    S("2025-08-18", "2025-08-19", "DUMMY GAS STATION", 21208, "in"), S("2025-08-25", "2025-08-26", "DUMMY PHOTOGRAPHY", 13000, "in"),
    S("2025-09-02", "2025-09-03", "PAYMENT - THANK YOU", 98000, "out"), S("2025-09-08", "2025-09-09", "DUMMY SIGN SHOP", 24550, "in"), S("2025-09-12", "2025-09-13", "DUMMY COFFEE", 8999, "in")]);
  const r = rng(44);
  for (let k = 1; k <= 11; k++) {
    const from = addMonths("2025-08-16", k), to = addMonths("2025-09-15", k), [y, m] = parts(from), [y2, m2] = parts(to);
    const raw = [S(iso(y, m, 22), iso(y, m, 23), "PAYMENT - THANK YOU", c.closing, "out"),
      S(iso(y, m, 19), iso(y, m, 20), "DUMMY GAS STATION", cents(r, 60, 120), "in"),
      S(iso(y, m, 27), iso(y, m, 28), "DUMMY OFFICE SUPPLY", cents(r, 90, 400), "in")];
    raw.sort((p, q) => p[0].localeCompare(q[0]));
    if (k === 11) {
      // Ends at 1,846.20 for the last cycle (the mock's screen 5).
      const sum = raw.reduce((n, x) => n + (x[4] === "in" ? x[3] : -x[3]), c.closing);
      raw.push(S(iso(y2, m2, 5), iso(y2, m2, 6), "DUMMY STAGING RENTAL", 184620 - sum, "in"));
    } else {
      raw.push(S(iso(y2, m2, 5), iso(y2, m2, 6), "DUMMY RESTAURANT", cents(r, 40, 160), "in"));
      if (k === 4) raw.push(S(iso(y2, m2, 15), iso(y2, m2, 15), "INTEREST CHARGES", 1240, "in"));
    }
    c = await cardStatement(`mdb-visa-${from.slice(0, 7)}.pdf`, MDB, acct, [from, to], c.closing, raw, { unsure: k === 3 ? [1, 2] : [] });
  }
  // The last cycle: the mock's screen 5. Owing on Aug 31, 2026: 629.05.
  await cardStatement("mdb-visa-2026-08.pdf", MDB, acct, ["2026-08-16", "2026-09-15"], 184620, [
    S("2026-08-18", "2026-08-19", "DUMMY GAS STATION", 8640, "in"), S("2026-08-22", "2026-08-23", "PAYMENT - THANK YOU", 184620, "out"),
    S("2026-08-25", "2026-08-26", "DUMMY OFFICE SUPPLY", 41275, "in"), S("2026-08-30", "2026-09-02", "DUMMY RESTAURANT", 12990, "in"),
    S("2026-09-03", "2026-09-04", "DUMMY STAGING RENTAL", 30115, "in"), S("2026-09-10", "2026-09-11", "DUMMY PRINT SHOP", 17325, "in")]);
}

// ---------- The manifest: round 20 entries kept, round 22 entries replaced
const manifestPath = join(PARENT, "manifest.json");
const manifest = Object.fromEntries(Object.entries(JSON.parse(readFileSync(manifestPath, "utf8"))).filter(([, v]) => !v.file.startsWith("round22/")));
for (const f of files) {
  const h = createHash("sha256").update(readFileSync(join(PARENT, f.file))).digest("hex");
  if (manifest[h]) throw new Error(`${f.file} has the same bytes as ${manifest[h].file}`);
  manifest[h] = { file: f.file, result: f.result };
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${files.length} round 22 statements written.`);
