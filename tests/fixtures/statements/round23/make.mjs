// Dummy statements for round 23, step 3 "Banking" (Hashim, Nov 16, 2026). Run:
//   node tests/fixtures/statements/round23/make.mjs
// The test file is "Maple Dummy Realty Inc.", year Sep 1, 2025 to Aug 31, 2026. All names and amounts are dummies.
//   - rbc-chq-*.pdf: chequing ••• 2468, 14 statements that share a day with the next (Jul 2 to Aug 1, Aug 1 to Sep 2,
//     ..., Aug 3 to Sep 2, 2026), with a running balance. The bank has 1,262.40 on Aug 31, 2025; cheque #121 of 750.00,
//     written last year, clears on Sep 9, 2025.
//   - rbc-sav-*.pdf: savings ••• 5678, calendar months Sep 2025 to Aug 2026, opening 5,110.00. rbc-sav-2026-03-misread.pdf
//     is March again, read with one amount wrong (cheque #118: 327.50 for 325.50): "1 to fix".
//   - rbc-visa-into-chequing: the round 22 Visa ••• 4405 statements are dropped into chequing to test the refusal.
//   - maple-chq-year.csv: the chequing account's lines for the year as one CSV (Date, Description, Amount),
//     opening 1,262.40 on Aug 31, 2025 (H9: the same result as the PDFs).
// Writes each PDF and its ReadResult (<name>.json), then adds them to ../manifest.json for the test reader.
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
const short = (s) => { const [, m, d] = parts(s); return `${String(d).padStart(2, "0")} ${MON[m - 1]}`; };
const long = (s) => { const [y, m, d] = parts(s); return `${MON[m - 1]} ${d}, ${y}`; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cents = (r, lo, hi) => Math.round(lo * 100 + r() * (hi - lo) * 100);
const printer = new PdfPrinter({ Times: { normal: "Times-Roman", bold: "Times-Bold", italics: "Times-Italic", bolditalics: "Times-BoldItalic" } });
const pdfBuffer = (doc) => new Promise((resolve, reject) => {
  const pdf = printer.createPdfKitDocument(doc); const chunks = [];
  pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
});
const files = [];
// One statement: the PDF (as printed) and the ReadResult (as read; misread: { line index, cents read }).
async function statement(rel, acct, from, to, opening, raw, { misread = null, tag = "" } = {}) {
  let bal = opening;
  const lines = raw.map(([date, description, c], i) => {
    bal += c;
    return { id: `l${i + 1}`, date, description, amountCents: Math.abs(c), dir: c > 0 ? "in" : "out", balanceCents: bal, page: 1, unsure: false, unsureReason: "", source: "read" };
  });
  const read = lines.map((l, i) => (misread && misread.index === i ? { ...l, amountCents: misread.cents } : l));
  const result = { bank: "RBC Royal Dummy Bank", pages: 1, accounts: [{ key: "a1", last4: acct.last4, name: acct.name, kind: "bank", periodStart: from, periodEnd: to,
    opening, closing: bal, summary: null, lines: read }] };
  const body = [[{ text: "Date", bold: true }, { text: "Description", bold: true }, { text: "Debits", bold: true }, { text: "Credits", bold: true }, { text: "Balance", bold: true }],
    ["", "Opening balance", "", "", fmt(opening)],
    ...lines.map((l) => [short(l.date), l.description, l.dir === "out" ? fmt(l.amountCents) : "", l.dir === "in" ? fmt(l.amountCents) : "", fmt(l.balanceCents)]),
    ["", { text: "Closing balance", bold: true }, "", "", { text: fmt(bal), bold: true }]];
  const doc = {
    pageSize: "LETTER", pageMargins: [50, 50, 50, 50], defaultStyle: { font: "Times", fontSize: 10 },
    info: { title: `Business Account Statement ${to}${tag}`, author: "RBC Royal Dummy Bank", producer: "Dummy statement generator", creationDate: new Date(`${to}T06:00:00Z`), modDate: new Date(`${to}T06:00:00Z`) },
    content: [
      { text: "Business Account Statement", bold: true, fontSize: 14 },
      { text: `${long(from).replace(/^(\w+) /, (m) => m)} to ${long(to)}`, margin: [0, 2, 0, 10] },
      { text: `Maple Dummy Realty Inc. · ${acct.name} ••• ${acct.last4}`, margin: [0, 0, 0, 10] },
      { table: { headerRows: 1, widths: [44, "*", 60, 60, 66], body }, layout: "lightHorizontalLines" },
      { text: "Dummy statement for testing. Not a real account.", color: "#888", margin: [0, 16, 0, 0] },
    ],
  };
  writeFileSync(join(DIR, rel), await pdfBuffer(doc));
  writeFileSync(join(DIR, rel.replace(/\.pdf$/, ".json")), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round23/${rel}`, result: `round23/${rel.replace(/\.pdf$/, ".json")}` });
  return { closing: bal, lines };
}

// ---------- Chequing ••• 2468: 14 statements sharing a day
const CHQ = { name: "Business chequing", last4: "2468" };
const ends = ["2025-07-02", "2025-08-01", "2025-09-02", "2025-10-02", "2025-11-03", "2025-12-02", "2026-01-02", "2026-02-02", "2026-03-02", "2026-04-02", "2026-05-01", "2026-06-02", "2026-07-02", "2026-08-03", "2026-09-02"];
const r = rng(2468);
let open = 98000;
const yearLines = [];
for (let k = 0; k < 14; k++) {
  const from = ends[k], to = ends[k + 1];
  const raw = [];
  const day = (n) => plus(from, n);
  raw.push([day(3), "Monthly fee", -600], [day(5), "e-Transfer received", cents(r, 300, 1400)], [day(9), "PAD telecom", -cents(r, 60, 95)],
    [day(13), "Deposit", cents(r, 800, 2600)], [day(17), "Loan payment", -cents(r, 150, 400)], [day(21), "e-Transfer sent", -cents(r, 100, 700)], [day(25), "Activity fee", -2500]);
  if (k === 2) raw.splice(2, 1, ["2025-09-09", "Cheque #121", -75000]);
  // The bank has 1,262.40 at the end of Aug 31, 2025.
  if (k === 1) {
    const before = raw.filter(([d]) => d <= "2025-08-31").reduce((n, [, , c]) => n + c, open);
    raw.push(["2025-08-29", 126240 - before < 0 ? "Transfer to savings" : "Deposit", 126240 - before]);
    raw.sort((a, b) => a[0].localeCompare(b[0]));
  }
  const keep = raw.filter(([d]) => d > from && d < to).sort((a, b) => a[0].localeCompare(b[0]));
  const s = await statement(`rbc-chq-${from}_to_${to}.pdf`, CHQ, from, to, open, keep);
  for (const l of s.lines) if (l.date >= "2025-09-01" && l.date <= "2026-08-31") yearLines.push([l.date, l.description, l.dir === "in" ? l.amountCents : -l.amountCents]);
  open = s.closing;
}
// The CSV for the year (Concept's template: Date, Description, Amount).
writeFileSync(join(DIR, "maple-chq-year.csv"), "Date,Description,Amount\n" + yearLines.map(([d, desc, c]) => `${d},${desc},${(c / 100).toFixed(2)}`).join("\n") + "\n");

// ---------- Savings ••• 5678: calendar months, March also read with one amount wrong
const SAV = { name: "Business savings", last4: "5678" };
const r2 = rng(5678);
let sOpen = 511000;
for (let k = 0; k < 12; k++) {
  const y = 2025 + Math.floor((8 + k) / 12), m = ((8 + k) % 12) + 1;
  const from = iso(y, m, 1), to = iso(y, m + 1, 0);
  const raw = k === 6
    ? [[iso(y, m, 3), "Monthly fee", -600], [iso(y, m, 5), "e-Transfer received", 50000], [iso(y, m, 9), "Cheque #118", -32550], [iso(y, m, 16), "PAD telecom", -8962],
       [iso(y, m, 24), "Deposit", 75000], [iso(y, m, 28), "Transfer to chequing", -cents(r2, 100, 900)]]
    : [[iso(y, m, 3), "Monthly fee", -600], [iso(y, m, 12), "Interest", cents(r2, 1, 9)], [iso(y, m, 20), "Deposit", cents(r2, 200, 1500)], [iso(y, m, 27), "Transfer to chequing", -cents(r2, 100, 900)]];
  const s = await statement(`rbc-sav-${from.slice(0, 7)}.pdf`, SAV, from, to, sOpen, raw);
  if (k === 6) await statement(`rbc-sav-${from.slice(0, 7)}-misread.pdf`, SAV, from, to, sOpen, raw, { misread: { index: 2, cents: 32750 }, tag: " (copy)" });
  sOpen = s.closing;
}

const manifest = JSON.parse(readFileSync(join(PARENT, "manifest.json"), "utf8"));
for (const k of Object.keys(manifest)) if (manifest[k].file?.startsWith("round23/")) delete manifest[k];
for (const f of files) manifest[createHash("sha256").update(readFileSync(join(PARENT, f.file))).digest("hex")] = f;
writeFileSync(join(PARENT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${files.length} statements written; CSV ${yearLines.length} lines; bank Aug 31, 2026: ${fmt(yearLines.reduce((n, [, , c]) => n + c, 126240))}`);
