// Dummy statements for round 28 (Hashim, Nov 17, 2026). Run:
//   node tests/fixtures/statements/round28/make.mjs
// Two business operating loan statements in the layout of the bank's real ones (Transaction Date and Effective Date
// columns, a running balance on every line, "Interest Payment" lines that leave the balance unchanged, and a
// summary whose Total Payments includes the interest). All names, numbers and amounts are dummies.
//   - loan-2025-10-02.pdf: Sep 3 to Oct 2, 2025. 4,000.00 - 800.00 + 1,100.00 = 4,300.00; one information line
//     (Interest Payment -27.35). Total Payments 827.35 - interest 27.35 = 800.00 principal.
//   - loan-2026-08-03.pdf: Jul 3 to Aug 3, 2026. 8,000.00 - 15,800.00 + 7,800.00 = 0.00; three information lines
//     (Interest Payment -52.10, its reversal +52.10, the Payment -31.80 that re-pays it). Total Payments 15,831.80 -
//     interest 31.80 = 15,800.00.
//   - chq-2025-09.pdf: the chequing account's September 2025, with the loan's other sides: LOAN PAYMENT 800.00 on
//     Sep 2, LOAN CREDIT 600.00, 300.00 and 200.00, and the interest the loan took (27.35).
// The loan account prints the number ending 2468. Writes each PDF and its ReadResult (<name>.json) and adds them
// to ../manifest.json for the test reader.
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
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (s) => (s ? `${MON[+s.slice(5, 7) - 1]} ${s.slice(8, 10)}` : "");
const long = (s) => `${LONG[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}`;
const printer = new PdfPrinter({ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } });
const pdfBuffer = (doc) => new Promise((resolve, reject) => {
  const pdf = printer.createPdfKitDocument(doc); const chunks = [];
  pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
});
const files = [];
const save = async (rel, doc, result) => {
  writeFileSync(join(DIR, rel), await pdfBuffer(doc));
  writeFileSync(join(DIR, rel.replace(/\.pdf$/, ".json")), JSON.stringify(result, null, 2) + "\n");
  files.push({ file: `round28/${rel}`, result: `round28/${rel.replace(/\.pdf$/, ".json")}` });
};

// One loan statement. raw: [transaction date, effective date | null, description, signed cents]; a positive amount
// is a withdrawal (borrowing), a negative one a payment. info: the line leaves the balance unchanged.
async function loan(rel, from, to, opening, raw, { interest, insurance = 0 }) {
  let bal = opening, payments = 0, borrowings = 0, n = 0;
  const lines = raw.map(([txn, eff, description, c, info]) => {
    if (!info) bal += c;
    if (c < 0) payments += -c;
    if (c > 0 && !info) borrowings += c;
    return { id: `l${++n}`, date: eff ?? txn, printedDate: eff ? txn : null, description, amountCents: Math.abs(c), dir: c > 0 ? "in" : "out", balanceCents: bal,
      page: 2, unsure: false, unsureReason: "", source: "read", cardKind: null, holder: null };
  });
  // Total Payments as printed: every payment line, interest included; reversals of interest take it back off.
  const totalPayments = raw.filter((r) => r[3] < 0).reduce((s, r) => s - r[3], 0) - raw.filter((r) => r[3] > 0 && r[4]).reduce((s, r) => s + r[3], 0);
  const closing = bal;
  const principal = totalPayments - interest - insurance;
  const result = { bank: "Dummy Royal Bank", pages: 2, accounts: [{ key: "a1", last4: "2468", name: "Royal Business Operating Loan", kind: "card", periodStart: from, periodEnd: to, opening, closing,
    summary: { inTotal: borrowings, inCount: null, outTotal: principal, outCount: null, loan: { payments: totalPayments, borrowings, interest, insurance } }, lines }] };
  const doc = {
    pageSize: "LETTER", pageMargins: [40, 40, 40, 40], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: `Dummy operating loan statement ${to}`, author: "Dummy Royal Bank", producer: "Dummy statement generator", creationDate: new Date(`${to}T06:00:00Z`), modDate: new Date(`${to}T06:00:00Z`) },
    content: [
      { text: "Dummy Royal Bank", bold: true, fontSize: 12 },
      { text: "Monthly Royal Business Operating Loan Statement", fontSize: 11, margin: [0, 2, 0, 0] },
      { text: `Business Loans | For ${long(from)} - ${long(to)}`, margin: [0, 0, 0, 12] },
      { columns: [{ text: "MAPLE DUMMY LOAN INC.\n100 DUMMY STREET\nTORONTO ON  M5V 0A0" },
        { table: { body: [["Statement Date:", long(to)], ["Loan Account Number:", "12345678 2468"], ["Transit Number:", "00000"]] }, layout: "noBorders" }], margin: [0, 0, 0, 14] },
      { text: "Payment Details", bold: true, margin: [0, 0, 0, 4] },
      { table: { widths: [200, 90], body: [["Opening Principal Balance", fmt(opening)], ["Total Payments", fmt(totalPayments)], ["Total Borrowings", fmt(borrowings)],
        ["Total Interest Paid", fmt(interest)], ["Total Insurance Paid", fmt(insurance)], ["Closing Principal Balance", fmt(closing)]] }, layout: "lightHorizontalLines" },
      { text: "Dummy statement for testing. Not a real account.", color: "#888", margin: [0, 12, 0, 0], pageBreak: "after" },
      { text: "Your Account Activity", bold: true, fontSize: 11, margin: [0, 0, 0, 6] },
      { table: { headerRows: 1, widths: [60, 60, "*", 90, 80], body: [
        [{ text: "Transaction Date", bold: true }, { text: "Effective Date", bold: true }, { text: "Description", bold: true }, { text: "Transaction Amount", bold: true }, { text: "Balance", bold: true }],
        ["", "", "Opening Principal Balance", "", fmt(opening)],
        ...raw.map(([txn, eff, description, c], i) => [short(txn), short(eff), description, fmt(c), fmt(lines[i].balanceCents)]),
        ["", "", "Closing Principal Balance", "", fmt(closing)]] }, layout: "lightHorizontalLines" },
    ],
  };
  await save(rel, doc, result);
  return { closing, principal, totalPayments };
}

await loan("loan-2025-10-02.pdf", "2025-09-03", "2025-10-02", 400000, [
  ["2025-09-03", "2025-09-02", "Payment", -80000],
  ["2025-09-10", "2025-09-09", "Withdrawal", 60000],
  ["2025-09-21", null, "Interest Payment", -2735, true],
  ["2025-09-24", "2025-09-23", "Withdrawal", 30000],
  ["2025-09-30", "2025-09-29", "Withdrawal", 20000],
], { interest: 2735 });

await loan("loan-2026-08-03.pdf", "2026-07-03", "2026-08-03", 800000, [
  ["2026-07-06", "2026-07-05", "Payment", -300000],
  ["2026-07-08", "2026-07-07", "Withdrawal", 200000],
  ["2026-07-13", "2026-07-10", "Payment", -250000],
  ["2026-07-15", "2026-07-14", "Withdrawal", 150000],
  ["2026-07-21", null, "Interest Payment", -5210, true],
  ["2026-07-22", null, "Reversal of Interest Payment", 5210, true],
  ["2026-07-22", "2026-07-21", "Payment", -400000],
  ["2026-07-24", null, "Payment", -3180, true],
  ["2026-07-27", "2026-07-24", "Withdrawal", 250000],
  ["2026-07-29", "2026-07-28", "Payment", -180000],
  ["2026-07-31", "2026-07-30", "Withdrawal", 180000],
  ["2026-08-01", "2026-07-31", "Payment", -250000],
  ["2026-08-03", "2026-08-02", "Payment", -200000],
], { interest: 3180 });

// Chequing, September 2025: the loan's other sides (the dates are the loan lines' Effective Dates).
{
  const opening = 500000;
  const raw = [["2025-09-02", "LOAN PAYMENT", -80000], ["2025-09-09", "LOAN CREDIT", 60000], ["2025-09-21", "LOAN INTEREST", -2735],
    ["2025-09-23", "LOAN CREDIT", 30000], ["2025-09-29", "LOAN CREDIT", 20000]];
  let bal = opening;
  const lines = raw.map(([date, description, c], i) => { bal += c; return { id: `l${i + 1}`, date, description, amountCents: Math.abs(c), dir: c > 0 ? "in" : "out", balanceCents: bal,
    page: 1, unsure: false, unsureReason: "", source: "read" }; });
  const result = { bank: "Dummy Royal Bank", pages: 1, accounts: [{ key: "a1", last4: "1357", name: "Business chequing", kind: "bank", periodStart: "2025-09-01", periodEnd: "2025-09-30",
    opening, closing: bal, summary: null, lines }] };
  const doc = { pageSize: "LETTER", pageMargins: [40, 40, 40, 40], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: "Dummy chequing statement 2025-09-30", author: "Dummy Royal Bank", producer: "Dummy statement generator", creationDate: new Date("2025-09-30T06:00:00Z"), modDate: new Date("2025-09-30T06:00:00Z") },
    content: [{ text: "Business Account Statement", bold: true, fontSize: 12 }, { text: "September 1, 2025 to September 30, 2025", margin: [0, 2, 0, 6] },
      { text: "MAPLE DUMMY LOAN INC. · Business chequing ••• 1357", margin: [0, 0, 0, 8] },
      { table: { headerRows: 1, widths: [50, "*", 70, 70, 80], body: [["Date", "Description", "Debits", "Credits", "Balance"], ["", "Opening balance", "", "", fmt(opening)],
        ...lines.map((l) => [short(l.date), l.description, l.dir === "out" ? fmt(l.amountCents) : "", l.dir === "in" ? fmt(l.amountCents) : "", fmt(l.balanceCents)]),
        ["", "Closing balance", "", "", fmt(bal)]] }, layout: "lightHorizontalLines" },
      { text: "Dummy statement for testing. Not a real account.", color: "#888", margin: [0, 12, 0, 0] }] };
  await save("chq-2025-09.pdf", doc, result);
}

const manifestPath = join(PARENT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const k of Object.keys(manifest)) if (manifest[k].file?.startsWith("round28/")) delete manifest[k];
for (const f of files) manifest[createHash("sha256").update(readFileSync(join(PARENT, f.file))).digest("hex")] = f;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`round28: ${files.length} statements`);
