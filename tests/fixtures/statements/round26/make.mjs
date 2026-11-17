// Dummy card statements for round 26 (Hashim, Nov 17, 2026). Run:
//   node tests/fixtures/statements/round26/make.mjs
// The test file's card is "Dummy MC ••• 4417", year Sep 1, 2025 to Aug 31, 2026. All names and amounts are dummies.
// A business card statement lists two cardholders, each in its own section with a subtotal (the company card ••• 4417
// and a second cardholder ••• 9032), and a summary box (previous balance, payments and credits, purchases and
// debits, cash advances, interest, fees, new balance).
//   - card-2025-09-18.pdf: read in full (the fixed reader): every line of both sections, each with its kind and its
//     cardholder's digits. A purchase on Sep 16 posted on Sep 18 (before the period starts on Sep 18).
//   - card-2025-10-18.pdf: read as the old reader did on Live: one line of the second cardholder's section left out.
//   - card-2025-12-18.pdf: Dec 18, 2025 to Jan 19, 2026 (across the new year), a purchase on Dec 16 posted on Dec 18.
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
const fmt = (c) => { const n = c < 0; const a = Math.abs(c); return (n ? "-" : "") + "$" + String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(a % 100).padStart(2, "0"); };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const short = (s) => `${MON[+s.slice(5, 7) - 1]} ${s.slice(8, 10)}`;
const long = (s) => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}`;
const printer = new PdfPrinter({ Times: { normal: "Times-Roman", bold: "Times-Bold", italics: "Times-Italic", bolditalics: "Times-BoldItalic" } });
const pdfBuffer = (doc) => new Promise((resolve, reject) => {
  const pdf = printer.createPdfKitDocument(doc); const chunks = [];
  pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
});
const KIND_SUM = { payment: "Payments & credits", purchase: "Purchases & debits", cash_advance: "Cash advances", interest: "Interest", fee: "Fees" };
const files = [];

// sections: [{ holder, name, lines: [[date, posted, description, cents, kind]] }]. Payments are negative.
async function statement(rel, from, to, opening, sections, { leaveOut = null } = {}) {
  const all = sections.flatMap((s) => s.lines.map((l) => ({ holder: s.holder, l })));
  const sum = (k) => all.filter((x) => x.l[4] === k).reduce((n, x) => n + Math.abs(x.l[3]), 0);
  const closing = opening + all.reduce((n, x) => n + x.l[3], 0);
  let n = 0;
  const lines = all.map(({ holder, l: [date, posted, description, c, kind] }) => ({ id: `l${++n}`, date, postedDate: posted, description, amountCents: Math.abs(c),
    dir: c > 0 ? "in" : "out", balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read", cardKind: kind, holder }));
  const read = lines.filter((l) => !(leaveOut && l.description === leaveOut)).map((l, i) => ({ ...l, id: `l${i + 1}` }));
  const result = { bank: "Dummy Royal Bank", pages: 1, accounts: [{ key: "a1", last4: sections[0].holder, name: "Business Dummy Mastercard", kind: "card", periodStart: from, periodEnd: to,
    opening, closing, summary: { inTotal: sum("purchase") + sum("cash_advance") + sum("interest") + sum("fee"), inCount: null, outTotal: sum("payment"), outCount: null,
      purchases: sum("purchase"), cashAdvances: sum("cash_advance"), interest: sum("interest"), fees: sum("fee") }, lines: read }] };
  const sectionBlocks = sections.flatMap((s) => [
    { text: `${s.name}   5100 00** **** ${s.holder}`, bold: true, margin: [0, 10, 0, 4] },
    { table: { headerRows: 1, widths: [50, 50, "*", 70], body: [
      [{ text: "Transaction date", bold: true }, { text: "Posting date", bold: true }, { text: "Activity description", bold: true }, { text: "Amount ($)", bold: true }],
      ...s.lines.map(([d, p, desc, c]) => [short(d), short(p), desc, fmt(c)]),
      ["", "", { text: "SUBTOTAL OF MONTHLY ACTIVITY", bold: true }, { text: fmt(s.lines.reduce((x, l) => x + l[3], 0)), bold: true }]] }, layout: "lightHorizontalLines" },
  ]);
  const box = [["Previous Statement Balance", fmt(opening)], ...["payment", "purchase", "cash_advance", "interest", "fee"].map((k) => [KIND_SUM[k], fmt(k === "payment" ? -sum(k) : sum(k))]),
    [{ text: "NEW BALANCE", bold: true }, { text: fmt(closing), bold: true }]];
  const doc = {
    pageSize: "LETTER", pageMargins: [50, 50, 50, 50], defaultStyle: { font: "Times", fontSize: 10 },
    info: { title: `Dummy card statement ${to}`, author: "Dummy Royal Bank", producer: "Dummy statement generator", creationDate: new Date(`${to}T06:00:00Z`), modDate: new Date(`${to}T06:00:00Z`) },
    content: [
      { text: "Dummy Business Dummy Mastercard", bold: true, fontSize: 14 },
      { text: `MAPLE DUMMY CARD INC.   5100 00** **** ${sections[0].holder}`, margin: [0, 2, 0, 2] },
      { text: `STATEMENT FROM ${long(from).toUpperCase()} TO ${long(to).toUpperCase()}`, margin: [0, 0, 0, 8] },
      { table: { widths: ["*", 90], body: [[{ text: "CALCULATING YOUR BALANCE", bold: true }, ""], ...box] }, layout: "lightHorizontalLines", margin: [0, 0, 220, 6] },
      ...sectionBlocks,
      { text: "Dummy statement for testing. Not a real account.", color: "#888", margin: [0, 16, 0, 0] },
    ],
  };
  writeFileSync(join(DIR, rel), await pdfBuffer(doc));
  writeFileSync(join(DIR, rel.replace(/\.pdf$/, ".json")), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round26/${rel}`, result: `round26/${rel.replace(/\.pdf$/, ".json")}` });
  return closing;
}

const CO = { holder: "4417", name: "MAPLE DUMMY CARD INC." }, TWO = { holder: "9032", name: "SECOND DUMMY CARDHOLDER" };
let open = 125000;
// Sep 18 to Oct 17, 2025: read in full.
open = await statement("card-2025-09-18.pdf", "2025-09-18", "2025-10-17", open, [
  { ...CO, lines: [["2025-09-16", "2025-09-18", "OFFICE SUPPLY DUMMY", 8640, "purchase"], ["2025-09-25", "2025-09-25", "PAYMENT - THANK YOU", -60000, "payment"],
    ["2025-10-01", "2025-10-01", "ANNUAL FEE", 3900, "fee"], ["2025-10-17", "2025-10-17", "PURCHASE INTEREST 19.99%", 2135, "interest"]] },
  { ...TWO, lines: [["2025-09-20", "2025-09-22", "COFFEE DUMMY", 1275, "purchase"], ["2025-09-27", "2025-09-29", "PHONE DUMMY", 10420, "purchase"],
    ["2025-10-03", "2025-10-06", "FUEL DUMMY", 5890, "purchase"], ["2025-10-11", "2025-10-14", "HOSTING DUMMY", 7715, "purchase"]] },
]);
// Oct 18 to Nov 17, 2025: the second cardholder's "PARKING DUMMY" left out, as the old reader did.
open = await statement("card-2025-10-18.pdf", "2025-10-18", "2025-11-17", open, [
  { ...CO, lines: [["2025-10-24", "2025-10-24", "PAYMENT - THANK YOU", -50000, "payment"], ["2025-11-17", "2025-11-17", "PURCHASE INTEREST 19.99%", 1488, "interest"]] },
  { ...TWO, lines: [["2025-10-21", "2025-10-22", "PARKING DUMMY", 2450, "purchase"], ["2025-10-30", "2025-11-03", "SOFTWARE DUMMY", 4999, "purchase"],
    ["2025-11-08", "2025-11-10", "COURIER DUMMY", 3360, "purchase"]] },
], { leaveOut: "PARKING DUMMY" });
// Dec 18, 2025 to Jan 19, 2026: across the new year; a purchase on Dec 16 posted on Dec 18.
await statement("card-2025-12-18.pdf", "2025-12-18", "2026-01-19", 98000, [
  { ...CO, lines: [["2025-12-16", "2025-12-18", "HOLIDAY CARDS DUMMY", 4425, "purchase"], ["2025-12-29", "2025-12-29", "PAYMENT - THANK YOU", -40000, "payment"],
    ["2026-01-08", "2026-01-09", "SUBSCRIPTION DUMMY", 2999, "purchase"], ["2026-01-19", "2026-01-19", "PURCHASE INTEREST 19.99%", 1105, "interest"]] },
]);

const manifestPath = join(PARENT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const k of Object.keys(manifest)) if (manifest[k].file?.startsWith("round26/")) delete manifest[k];
for (const f of files) manifest[createHash("sha256").update(readFileSync(join(PARENT, f.file))).digest("hex")] = f;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`round26: ${files.length} statements`);
