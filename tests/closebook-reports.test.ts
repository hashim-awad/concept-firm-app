// Run with: npm test
// Working balance sheet and income statement (Hashim, Nov 13, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReports } from "../src/lib/closebook/reports.ts";

const a = (key: string, number: string, name: string, type: string | null, final: number, last = 0) => ({ key, number, name, type, final, last });

test("the balance sheet balances, with net income in equity and unsorted accounts shown", () => {
  const r = buildReports([
    a("1", "1000", "Chequing", "Asset", 6017), a("2", "2150", "GST/HST payable", "Liability", -123.5),
    a("3", "4020", "Commission income", "Revenue", -1000), a("4", "6020", "Meals", "Expense", 106.5),
    a("o", "", "Opening balances to enter", null, -5000),
  ]);
  assert.equal(r.pl.revenue.now, 1000);
  assert.equal(r.pl.expenses.now, 106.5);
  assert.equal(r.pl.net.now, 893.5);
  assert.equal(r.bs.totalAssets.now, 6017);
  assert.equal(r.bs.totalOther.now, 6017);
  assert.equal(r.bs.balanced, true);
  assert.deepEqual(r.bs.sections.map((s) => s.title), ["Assets", "Liabilities", "Equity", "Not yet sorted"]);
  assert.equal(r.bs.sections[2].lines.at(-1)!.name, "Net income for the year");
});

test("last year side by side; empty accounts left out", () => {
  const r = buildReports([a("1", "1000", "Chequing", "Asset", 100, 80), a("2", "3100", "Retained earnings", "Equity", -100, -80), a("3", "6510", "Office", "Expense", 0, 0)]);
  assert.deepEqual(r.bs.sections[0].lines, [{ name: "1000 Chequing", now: 100, last: 80 }]);
  assert.equal(r.pl.expenses.lines.length, 0);
  assert.equal(r.bs.balanced, true);
});
