// Dummy statements for the round 22 fixes (Hashim, Nov 16, 2026). Run:
//   node tests/fixtures/statements/round22fix/make.mjs
// The test file is "Juniper Dummy Design Inc.", year Sep 1, 2025 to Aug 31, 2026. All names and amounts are dummies.
// Rideau Dummy Bank chequing ••• 4321: 13 statements that share a day with the ones on each side (Aug 1 to
// Sep 2, Sep 2 to Oct 2, Oct 2 to Nov 3, ...), as some banks print them. The balance on Aug 31, 2025 is 280.52,
// against 280 on last year's T2 (whole dollars). No line falls on a shared day.
// Writes each PDF and the ReadResult a perfect reader returns (<name>.json), then adds them to ../manifest.json.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake");
const DIR = dirname(fileURLToPath(import.meta.url));
const PARENT = join(DIR, "..");
const fmt = (c) => { const n = c < 0; const a = Math.abs(c); return (n ? "-" : "") + String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(a % 100).padStart(2, "0"); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (s) => s.split("-").map(Number);
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const plus = (s, n) => { const [y, m, d] = parts(s); return iso(y, m, d + n); };
const short = (s) => { const [, m, d] = parts(s); return `${MON[m - 1]} ${String(d).padStart(2, "0")}`; };
const long = (s) => { const [y, m, d] = parts(s); return `${MON[m - 1]} ${d}, ${y}`; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cents = (r, lo, hi) => Math.round(lo * 100 + r() * (hi - lo) * 100);
const printer = new PdfPrinter({ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } });
const pdfBuffer = (doc) => new Promise((resolve, reject) => {
  const pdf = printer.createPdfKitDocument(doc); const chunks = [];
  pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
});
const BANK = { name: "Rideau Dummy Bank", color: "#1d3f7a" }, ACCT = { name: "Business chequing", last4: "4321" };
const PERIODS = [["2025-08-01", "2025-09-02"], ["2025-09-02", "2025-10-02"], ["2025-10-02", "2025-11-03"], ["2025-11-03", "2025-12-02"], ["2025-12-02", "2026-01-02"],
  ["2026-01-02", "2026-02-02"], ["2026-02-02", "2026-03-02"], ["2026-03-02", "2026-04-02"], ["2026-04-02", "2026-05-01"], ["2026-05-01", "2026-06-02"],
  ["2026-06-02", "2026-07-02"], ["2026-07-02", "2026-08-03"], ["2026-08-03", "2026-09-02"]];
const files = [];
const r = rng(4321);
let opening = 228140;
for (const [k, [from, to]] of PERIODS.entries()) {
  const raw = k === 0
    ? [["2025-08-06", "PAD DUMMY TELECOM", 40000, "out"], ["2025-08-20", "DUMMY OFFICE RENT", 160088, "out"], ["2025-09-01", "E-TRANSFER DUMMY CLIENT", 90000, "in"]]
    : [[plus(from, 3), "PAD DUMMY TELECOM", cents(r, 38, 46), "out"], [plus(from, 8), "E-TRANSFER DUMMY CLIENT", cents(r, 900, 2600), "in"],
       [plus(from, 15), "DUMMY SOFTWARE SUBSCRIPTION", cents(r, 60, 140), "out"], [plus(from, 22), "DUMMY PRINT SHOP", cents(r, 80, 600), "out"],
       [plus(from, 26), "BANK SERVICE FEE", 1995, "out"]].filter(([d]) => d < to);
  let bal = opening, inT = 0, inN = 0, outT = 0, outN = 0;
  const lines = raw.map(([date, description, c, dir], i) => {
    bal += dir === "in" ? c : -c;
    if (dir === "in") { inT += c; inN++; } else { outT += c; outN++; }
    return { id: `l${i + 1}`, date, description, amountCents: c, dir, balanceCents: bal, page: 1, unsure: false, unsureReason: "", source: "read" };
  });
  const result = { bank: BANK.name, pages: 1, accounts: [{ key: "a1", last4: ACCT.last4, name: ACCT.name, kind: "bank", periodStart: from, periodEnd: to,
    opening, closing: bal, summary: { inTotal: inT, inCount: inN, outTotal: outT, outCount: outN }, lines }] };
  const body = [[{ text: "Date", bold: true }, { text: "Description", bold: true }, { text: "Withdrawals", bold: true, alignment: "right" }, { text: "Deposits", bold: true, alignment: "right" }, { text: "Balance", bold: true, alignment: "right" }],
    [short(from), "Opening balance", "", "", { text: fmt(opening), alignment: "right" }],
    ...lines.map((l) => [short(l.date), l.description, { text: l.dir === "out" ? fmt(l.amountCents) : "", alignment: "right" }, { text: l.dir === "in" ? fmt(l.amountCents) : "", alignment: "right" }, { text: fmt(l.balanceCents), alignment: "right" }]),
    [short(to), { text: "Closing balance", bold: true }, "", "", { text: fmt(bal), alignment: "right", bold: true }]];
  const doc = {
    pageSize: "LETTER", pageMargins: [44, 44, 44, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: `${BANK.name} statement ${to}`, author: BANK.name, producer: "Dummy statement generator", creationDate: new Date(`${to}T06:00:00Z`), modDate: new Date(`${to}T06:00:00Z`) },
    content: [
      { columns: [{ text: BANK.name.toUpperCase(), bold: true, fontSize: 15, color: BANK.color }, { text: `Statement period\n${long(from)} to ${long(to)}`, alignment: "right" }] },
      { text: "Juniper Dummy Design Inc.\n200 Dummy Avenue, Kitchener ON N2G 0A0", margin: [0, 12, 0, 8] },
      { text: `${ACCT.name} ••• ${ACCT.last4}`, bold: true, fontSize: 11, margin: [0, 0, 0, 6] },
      { table: { headerRows: 1, widths: [44, "*", 70, 70, 74], body }, layout: "lightHorizontalLines" },
      { text: "Dummy statement for testing. Not a real account.", color: "#888", margin: [0, 16, 0, 0] },
    ],
  };
  const rel = `rdb-chq-${from}_to_${to}.pdf`;
  writeFileSync(join(DIR, rel), await pdfBuffer(doc));
  writeFileSync(join(DIR, rel.replace(/\.pdf$/, ".json")), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round22fix/${rel}`, result: `round22fix/${rel.replace(/\.pdf$/, ".json")}` });
  opening = bal;
}
const manifest = JSON.parse(readFileSync(join(PARENT, "manifest.json"), "utf8"));
for (const k of Object.keys(manifest)) if (manifest[k].file?.startsWith("round22fix/")) delete manifest[k];
for (const f of files) manifest[createHash("sha256").update(readFileSync(join(PARENT, f.file))).digest("hex")] = f;
writeFileSync(join(PARENT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${files.length} statements written`);
