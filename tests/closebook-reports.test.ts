// Run with: npm test
// Closebook reports built live from the postings (Hashim, Nov 15, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, type Posting } from "../src/lib/closebook/tb-build.ts";
import { journal, ledger, statements, trialBalance, type LineInfo, type RepAccount } from "../src/lib/closebook/reports.ts";

const chart = new Map([
  ["10000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }],
  ["21500", { name: "GST/HST payable", account_type: "Liability", line_no: "2680.00" }],
  ["40200", { name: "Commission income", account_type: "Revenue", line_no: "8120.00" }],
  ["65100", { name: "Office expenses", account_type: "Expense", line_no: "8810.00" }],
]);
const codes = new Map([["HST_ON", { code: "HST_ON", name: "HST ON", parts: [{ name: "HST ON", rate: 0.13, recoverable: true, liability: "gst_hst" as const, effective_from: "2000-01-01" }] }]]);
const ctx = { registered: true, quick: false };
const INFO: Record<string, LineInfo> = {
  "1002.00": { type: "Asset", sheet: "A", sheetName: "A Cash and bank" }, "2680.00": { type: "Liability", sheet: "AA", sheetName: "AA Payables" },
  "8120.00": { type: "Revenue", sheet: "20", sheetName: "20 Revenue" }, "8810.00": { type: "Expense", sheet: "40", sheetName: "40 Operating expenses" },
};
const info = (l: string | null) => (l ? INFO[l] ?? null : null);

function sample() {
  const { rows, postings } = buildLedger([{ id: "b", name: "TD chequing", kind: "bank", chart: "10000", openingCents: 500000 }], [
    { id: "l1", date: "2026-02-03", description: "SAMPLE COMMISSION", account_id: "b", cents: 113000, status: "done", chart_account: "40200", tax_code: "HST_ON" },
    { id: "l2", date: "2026-03-09", description: "SAMPLE STAPLES", account_id: "b", cents: -11300, status: "done", chart_account: "65100", tax_code: "HST_ON" },
    { id: "l3", date: "2026-04-01", description: "SAMPLE UNKNOWN", account_id: "b", cents: -2000, status: "new", chart_account: null, tax_code: null },
  ], chart, codes, ctx, null, "2026-01-01");
  const accounts: RepAccount[] = rows.map((r) => ({ key: r.key, number: r.number, name: r.name, line_no: r.line_no, lastCents: r.lastCents }));
  return { rows, postings, accounts };
}

test("the postings add up to the trial balance, account by account", () => {
  const { rows, postings } = sample();
  for (const r of rows) assert.equal(postings.filter((p) => p.key === r.key).reduce((n, p) => n + p.cents, 0), r.cents, r.key);
  assert.equal(postings.reduce((n, p) => n + p.cents, 0), 0);
  // One bank line posts its bank side, its account and its tax, all pointing back to the line.
  assert.deepEqual(postings.filter((p) => p.ref === "l1").map((p) => [p.key, p.cents]), [["chart:10000", 113000], ["chart:40200", -100000], ["chart:21500", -13000]]);
});

test("trial balance columns: opening, coded activity, adjusting entries, final, difference", () => {
  const { postings, accounts } = sample();
  const aje: Posting[] = [{ key: "chart:65100", cents: 5000, date: "2026-12-31", kind: "entry", ref: "e1", label: "AJE-1" }, { key: "chart:10000", cents: -5000, date: "2026-12-31", kind: "entry", ref: "e1", label: "AJE-1" }];
  const tb = trialBalance(accounts.map((a) => (a.key === "chart:10000" ? { ...a, lastCents: 480000 } : a)), [...postings, ...aje]);
  const bank = tb.find((t) => t.key === "chart:10000")!;
  assert.deepEqual([bank.last, bank.opening, bank.activity, bank.adjustments, bank.final, bank.diff], [480000, 500000, 113000 - 11300 - 2000, -5000, 594700, 114700]);
  assert.deepEqual(tb.map((t) => t.number), ["10000", "21500", "40200", "65100", "", ""], "by account number; holding accounts last");
  assert.equal(tb.reduce((n, t) => n + t.final, 0), 0);
});

test("statements: grouped by lead sheet, net income in equity, not yet sorted until zero", () => {
  const { postings, accounts } = sample();
  const s = statements(trialBalance(accounts, postings), info);
  assert.equal(s.pl.revenue.now, 100000);
  assert.equal(s.pl.expenses.now, 10000);
  assert.equal(s.pl.net.now, 90000);
  assert.deepEqual(s.bs.assets.groups.map((g) => [g.name, g.now]), [["A Cash and bank", 599700]]);
  assert.deepEqual(s.bs.equity.groups.map((g) => [g.code, g.now]), [["net-income", 90000]]);
  // Opening balances to enter (5,000.00 credit) and the uncoded payment (20.00 debit) are not yet sorted.
  assert.equal(s.bs.unsorted!.now, 500000 - 2000);   // shown on the credit side: the uncoded payment is a debit
  assert.ok(s.bs.balanced);
  // Everything sorted: the section goes.
  const sorted = postings.filter((p) => p.key !== "uncoded" && p.key !== "opening");
  const fixed: Posting[] = [...sorted, { key: "chart:65100", cents: 2000, date: "2026-04-01", kind: "bank", ref: "l3", label: "" }, { key: "chart:31000", cents: -500000, date: "2026-01-01", kind: "opening", ref: "gifi:3849", label: "" }];
  const s2 = statements(trialBalance([...accounts, { key: "chart:31000", number: "31000", name: "Retained earnings", line_no: "3600.00", lastCents: 0 }], fixed), (l) => info(l) ?? (l === "3600.00" ? { type: "Equity", sheet: "EE", sheetName: "EE Equity" } : null));
  assert.equal(s2.bs.unsorted, null);
});

test("general ledger: date order, running balance, date filter carries the balance before", () => {
  const { postings, accounts } = sample();
  const [bank] = ledger(accounts, postings, { key: "chart:10000" });
  assert.deepEqual(bank.lines.map((l) => [l.date, l.kind, l.running]), [["2026-01-01", "opening", 500000], ["2026-02-03", "bank", 613000], ["2026-03-09", "bank", 601700], ["2026-04-01", "bank", 599700]]);
  const [march] = ledger(accounts, postings, { key: "chart:10000", from: "2026-03-01", to: "2026-03-31" });
  assert.equal(march.before, 613000);
  assert.deepEqual(march.lines.map((l) => [l.ref, l.running]), [["l2", 601700]]);
  assert.ok(ledger(accounts, postings).length >= 5, "every account");
});

test("journal: one transaction per source, filter by source", () => {
  const { postings } = sample();
  const all = journal(postings);
  assert.equal(all[0].label, "Opening balances");
  assert.deepEqual(all.map((t) => t.kind), ["opening", "bank", "bank", "bank"]);
  for (const t of all) assert.equal(t.lines.reduce((n, l) => n + l.cents, 0), 0, "every transaction balances");
  assert.deepEqual(journal(postings, "bank").map((t) => t.ref), ["l1", "l2", "l3"]);
  assert.deepEqual(journal(postings, "entry"), []);
});

test("exports: the same table as the page, and an Excel file with the stamp that reads back", async () => {
  const { reportTable } = await import("../src/lib/closebook/report-table.ts");
  const { reportXlsx } = await import("../src/lib/closebook/xlsx-write.ts");
  const { readXlsx } = await import("../src/lib/closebook/xlsx.ts");
  const { postings, accounts } = sample();
  const d = { accounts, postings, info, bankFile: true, entryLabel: new Map<string, string>() };
  const t = reportTable(d, { report: "tb" });
  assert.deepEqual(t.columns.slice(0, 3), ["Number", "Account", "GIFI"], "the number once, the GIFI line in its own column");
  assert.deepEqual(t.rows[0].cells.slice(0, 3), ["10000", "Chequing", "1002"]);
  assert.equal(t.rows.at(-1)!.cells[7], 0, "the final column totals zero");
  const [sheet] = readXlsx(reportXlsx(t, ["Birch Dummy Realty Inc.", "Jan 1, 2026 to Dec 31, 2026"], "Working paper: not for the client"));
  assert.equal(sheet.rows[0][0], "Trial balance");
  assert.equal(sheet.rows[3][0], "Working paper: not for the client");
  assert.deepEqual(sheet.rows[5].slice(0, 3), ["Number", "Account", "GIFI"]);
  assert.equal(sheet.rows[6][7], 5997, "amounts in dollars, as numbers");
  for (const r of ["bs", "pl", "gl", "journal"]) assert.ok(reportTable(d, { report: r }).rows.length > 0, r);
  assert.deepEqual(reportTable(d, { report: "journal", source: "bank" }).rows.filter((r) => r.bold).map((r) => r.cells[2]), ["SAMPLE COMMISSION", "SAMPLE STAPLES", "SAMPLE UNKNOWN"]);
});

test("last year without Schedule 125: net income is the figure that ties last year's balance sheet", () => {
  // Board figures in cents: assets 60,590, liabilities 18,760, shares 100, RE start 29,480, dividends 8,000, typed 9999 20,250.
  const acc = (key: string, line_no: string, lastCents: number): RepAccount => ({ key, number: "", name: key, line_no, lastCents });
  const I: Record<string, LineInfo> = { "1002.00": INFO["1002.00"], "2620.00": { type: "Liability", sheet: "AA", sheetName: "AA" }, "3500.00": { type: "Equity", sheet: "FF", sheetName: "FF" },
    "3600.00": { type: "Equity", sheet: "FF", sheetName: "FF" }, "3700.00": { type: "Equity", sheet: "GG", sheetName: "GG" } };
  const s = statements(trialBalance([acc("a", "1002.00", 6059000), acc("l", "2620.00", -1876000), acc("sh", "3500.00", -10000), acc("re", "3600.00", -2948000), acc("dv", "3700.00", 800000)], []), (l) => (l ? I[l] ?? null : null));
  assert.equal(s.pl.lastFromT2, true);
  assert.equal(s.pl.net.last, 2025000);
  assert.equal(s.bs.totalLE.last, s.bs.assets.last, "last year balances");
});
