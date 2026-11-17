// Dummy card statements for round 30 (Hashim, Nov 17, 2026). Run:
//   node tests/fixtures/statements/round30/make.mjs
// A business card statement of 3 pages, Jul 18 to Aug 17, 2026: the company card ••• 4417's section, then a second
// cardholder ••• 9032 whose section starts with purchases dated Jul 16 and Jul 17 (two days before the period), all
// posted Jul 20. Two reads of the same file layout:
//   - card-3p-2026-07-18.pdf: read in full, posting dates included (every line).
//   - card-3p-2026-07-18-noposted.pdf: the same statement (another copy) read without the second cardholder's
//     posting dates, as a reader can return them.
// All names and amounts are dummies. Adds the reads to ../manifest.json for the test reader.
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
const printer = new PdfPrinter({ Times: { normal: "Times-Roman", bold: "Times-Bold", italics: "Times-Italic", bolditalics: "Times-BoldItalic" } });
const pdfBuffer = (doc) => new Promise((resolve, reject) => {
  const pdf = printer.createPdfKitDocument(doc); const chunks = [];
  pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
});
const day = (n) => new Date(Date.UTC(2026, 6, 18 + n)).toISOString().slice(0, 10);
// Company section: 24 purchases over the period, a payment, interest. Second section: 4 early purchases, then 20 more.
const CO = [["2026-07-24", "2026-07-24", "PAYMENT - THANK YOU", -150000, "payment"]];
for (let i = 0; i < 24; i++) CO.push([day(1 + i), day(2 + i), `OFFICE DUMMY ${i + 1}`, 1000 + i * 137, "purchase"]);
CO.push(["2026-08-17", "2026-08-17", "PURCHASE INTEREST 19.99%", 2345, "interest"]);
const TWO = [["2026-07-16", "2026-07-20", "FUEL DUMMY A", 6420, "purchase"], ["2026-07-16", "2026-07-20", "COFFEE DUMMY B", 845, "purchase"],
  ["2026-07-17", "2026-07-20", "PARKING DUMMY C", 1500, "purchase"], ["2026-07-17", "2026-07-20", "HOTEL DUMMY D", 18900, "purchase"]];
for (let i = 0; i < 20; i++) TWO.push([day(3 + i), day(4 + i), `TRAVEL DUMMY ${i + 1}`, 2000 + i * 211, "purchase"]);
const opening = 250000;
const all = [...CO.map((l) => ["4417", ...l]), ...TWO.map((l) => ["9032", ...l])];
const closing = opening + all.reduce((n, l) => n + l[4], 0);
const sum = (k) => all.filter((l) => l[5] === k).reduce((n, l) => n + Math.abs(l[4]), 0);
const summary = { inTotal: sum("purchase") + sum("interest"), inCount: null, outTotal: sum("payment"), outCount: null, purchases: sum("purchase"), cashAdvances: 0, interest: sum("interest"), fees: 0 };
const rowsPerPage = 20;
const lineObjs = (dropSecondPosted) => all.map(([holder, date, posted, description, c, kind], i) => ({ id: `l${i + 1}`, date, postedDate: dropSecondPosted && holder === "9032" ? null : posted,
  description, amountCents: Math.abs(c), dir: c > 0 ? "in" : "out", balanceCents: null, page: holder === "9032" ? 3 : 2, unsure: false, unsureReason: "", source: "read", cardKind: kind, holder }));
const doc = (tag) => ({
  pageSize: "LETTER", pageMargins: [50, 50, 50, 50], defaultStyle: { font: "Times", fontSize: 10 },
  info: { title: `Dummy 3-page card statement 2026-08-17${tag}`, author: "Dummy Royal Bank", producer: "Dummy statement generator", creationDate: new Date("2026-08-17T06:00:00Z"), modDate: new Date("2026-08-17T06:00:00Z") },
  content: [
    { text: "Dummy Business Mastercard", bold: true, fontSize: 14 },
    { text: "MAPLE DUMMY CARD INC.   5100 00** **** 4417", margin: [0, 2, 0, 2] },
    { text: "STATEMENT FROM JUL 18 TO AUG 17, 2026", margin: [0, 0, 0, 8] },
    { table: { widths: ["*", 90], body: [["Previous Statement Balance", fmt(opening)], ["Payments & credits", fmt(-sum("payment"))], ["Purchases & debits", fmt(sum("purchase"))],
      ["Cash advances", fmt(0)], ["Interest", fmt(sum("interest"))], ["Fees", fmt(0)], [{ text: "NEW BALANCE", bold: true }, { text: fmt(closing), bold: true }]] }, layout: "lightHorizontalLines", margin: [0, 0, 220, 10] },
    ...[["4417", "MAPLE DUMMY CARD INC.", CO], ["9032", "SECOND DUMMY CARDHOLDER", TWO]].flatMap(([h, name, ls], k) => [
      { text: `${name}   5100 00** **** ${h}`, bold: true, margin: [0, 10, 0, 4], pageBreak: "before" },
      { table: { headerRows: 1, widths: [50, 50, "*", 70], body: [["Transaction date", "Posting date", "Activity description", "Amount ($)"].map((t) => ({ text: t, bold: true })),
        ...ls.map(([d, p, desc, c]) => [short(d), short(p), desc, fmt(c)]), ["", "", { text: "SUBTOTAL OF MONTHLY ACTIVITY", bold: true }, { text: fmt(ls.reduce((n, l) => n + l[3], 0)), bold: true }]] },
        layout: "lightHorizontalLines" }]),
    { text: `Dummy statement for testing. Not a real account.${tag}`, color: "#888", margin: [0, 16, 0, 0] },
  ],
});
const files = [];
for (const [rel, drop, tag] of [["card-3p-2026-07-18.pdf", false, ""], ["card-3p-2026-07-18-noposted.pdf", true, " (copy)"]]) {
  const buf = await pdfBuffer(doc(tag));
  writeFileSync(join(DIR, rel), buf);
  const result = { bank: "Dummy Royal Bank", pages: 3, accounts: [{ key: "a1", last4: "4417", name: "Business Dummy Mastercard", kind: "card", periodStart: "2026-07-18", periodEnd: "2026-08-17", opening, closing, summary, lines: lineObjs(drop) }] };
  writeFileSync(join(DIR, rel.replace(/\.pdf$/, ".json")), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round30/${rel}`, result: `round30/${rel.replace(/\.pdf$/, ".json")}` });
}
const manifestPath = join(PARENT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const k of Object.keys(manifest)) if (manifest[k].file?.startsWith("round30/")) delete manifest[k];
for (const f of files) manifest[createHash("sha256").update(readFileSync(join(PARENT, f.file))).digest("hex")] = f;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`round30: ${files.length} statements, ${all.length} lines, closing ${closing}`);
