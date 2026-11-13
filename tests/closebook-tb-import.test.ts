// Run with: npm test
// Trial balance exports (Phase 3 batch, F1): QuickBooks Online, Xero and a bookkeeper's single column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { money, readAccountList, readTrialBalance } from "../src/lib/closebook/tb-import.ts";
import { parseCsv } from "../src/lib/closebook/seed.ts";

test("amounts: commas, brackets, dollar signs, minus, blanks", () => {
  assert.equal(money("1,234.56"), 1234.56);
  assert.equal(money("(1,234.56)"), -1234.56);
  assert.equal(money("-$50"), -50);
  assert.equal(money(""), 0);
  assert.equal(money(12.5), 12.5);
  assert.equal(money("n/a"), null);
});

// The shape of QuickBooks Online's Trial Balance export (invented company and figures).
const QBO = `Maple Test Realty Inc.
Trial Balance
"As of December 31, 2026"

,Debit,Credit
1000 Chequing,"48,210.00",
1100 Accounts Receivable (A/R),"2,500.00",
2100 Due to shareholder,,"9,800.00"
3000 Retained Earnings,,"28,510.00"
Commission income,,"312,400.00"
Meals and entertainment,"4,000.00",
Office expenses,"296,000.00",
TOTAL,"$350,710.00","$350,710.00"


"Accrual Basis Tuesday, January 12, 2027 10:15 AM GMT-05:00"`;

test("QuickBooks Online export: numbers split from names, totals and footer skipped", () => {
  const r = readTrialBalance(parseCsv(QBO));
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 7);
  assert.deepEqual(r.rows[0], { number: "1000", name: "Chequing", amount: 48210 });
  assert.deepEqual(r.rows[2], { number: "2100", name: "Due to shareholder", amount: -9800 });
  assert.deepEqual(r.rows[4], { number: "", name: "Commission income", amount: -312400 });
  assert.equal(r.debit, 350710);
  assert.equal(r.credit, 350710);
  assert.ok(r.skipped.includes("TOTAL"));
});

test("Xero-style export: a code column and year-to-date columns", () => {
  const r = readTrialBalance(parseCsv(`Trial Balance\nAccount Code,Account,Debit - Year to date,Credit - Year to date\n090,Business Bank Account,1000.00,\n200,Sales,,1000.00\n,Total,1000.00,1000.00\n`));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [{ number: "090", name: "Business Bank Account", amount: 1000 }, { number: "200", name: "Sales", amount: -1000 }]);
});

test("a single balance column, with credits in brackets", () => {
  const r = readTrialBalance([["Account", "Balance"], ["Bank", "500.00"], ["Revenue", "(500.00)"]]);
  assert.deepEqual(r.rows.map((x) => x.amount), [500, -500]);
});

test("problems are reported, never guessed", () => {
  assert.match(readTrialBalance([["Account", "Something"], ["Bank", "5"]]).error ?? "", /No Debit and Credit/);
  assert.match(readTrialBalance(parseCsv(",Debit,Credit\nBank,100,\nRevenue,,90\n")).error ?? "", /does not balance/);
});

// Round 5 (Hashim, Nov 21, 2026): a Type column (Xero "Account Type", QuickBooks Online account list "Type")
// comes through for step 7's type check; without one, rows carry no type.
test("a Type column comes through; the name column is still found", () => {
  const t = parseCsv("Code,Account,Account Type,Debit,Credit\n1500,Computer gear,Fixed Assets,3000,\n,Sundry,,200,\n4000,Consulting income,Revenue,,3200\n");
  const r = readTrialBalance(t);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [
    { number: "1500", name: "Computer gear", amount: 3000, type: "Fixed Assets" },
    { number: "", name: "Sundry", amount: 200 },
    { number: "4000", name: "Consulting income", amount: -3200, type: "Revenue" },
  ]);
});

test("no Type column: no type on any row", () => {
  const r = readTrialBalance(parseCsv("Account,Debit,Credit\nChequing,100,\nSales,,100\n"));
  assert.ok(r.rows.every((x) => !("type" in x)));
});

// Round 6 (Hashim, Nov 22, 2026): the QuickBooks Online Account List export.
test("Account List: title rows skipped, number column or number in the name, type kept", () => {
  const t = parseCsv("Spruce Dummy Inc.\nAccount List\n\nAccount #,Account,Type,Detail type,Description,Total balance\n15000,Computer equipment,Fixed Assets,Machinery & Equipment,,6000\n,Office supplies:Printing,Expenses,Office/General Administrative Expenses,,\n,61500 Amortization expense,Expenses,Depreciation,,\n,Bad row,,,,\n");
  const r = readAccountList(t);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [
    { number: "15000", name: "Computer equipment", type: "Fixed Assets" },
    { number: "", name: "Office supplies:Printing", type: "Expenses" },
    { number: "61500", name: "Amortization expense", type: "Expenses" },
  ]);
});

test("Account List: a trial balance uploaded by mistake is refused", () => {
  const r = readAccountList(parseCsv("Account,Debit,Credit\nChequing,100,\nSales,,100\n"));
  assert.match(r.error ?? "", /^This is not a QuickBooks Account List/);
});
