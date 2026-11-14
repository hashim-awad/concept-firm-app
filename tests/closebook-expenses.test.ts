// Run with: npm test
// Expenses paid personally (round 9): the entry worked out from the amounts typed from the Summary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planExpenses, type ExpenseDef, type ExpenseHead, type ExpenseCtx } from "../src/lib/closebook/expenses.ts";

const def = (key: string, name: string, account: string | null, tax: ExpenseDef["tax"], more: Partial<ExpenseDef> = {}): ExpenseDef =>
  ({ key, name, account, tax, share: "none", capital: false, to_reviewer: false, pick: false, note_required: false, choices: [], ...more });
const DEFS: ExpenseDef[] = [
  def("meals", "Meals and entertainment", "60200", "meals"),
  def("phone", "Phone and internet", "70500", "taxable", { share: "phone" }),
  def("business_insurance", "Business insurance", "62000", "none"),
  def("vehicle_fuel", "Vehicle - fuel", "70600", "auto", { share: "km" }),
  def("vehicle_lease", "Vehicle - lease payments", "70600", "auto", { share: "km", to_reviewer: true }),
  def("equipment", "Equipment purchases", "15200", "taxable", { capital: true, to_reviewer: true }),
  def("cra", "Payments to CRA for the company", null, "none", { pick: true, choices: ["21400", "21500", "21300"] }),
  def("other", "Other business expenses", null, "taxable", { pick: true, note_required: true }),
];
const head = (more: Partial<ExpenseHead> = {}): ExpenseHead =>
  ({ summaryTotal: null, kmTotal: null, kmBusiness: null, phonePct: null, shareholder: "23000", sheet: true, autoEntry: false, autoChecked: false, ...more });
const REG: ExpenseCtx = { registered: true, quick: false, autoTax: "line", taxCode: (a) => (a === "60200" ? "MEALS_HST_50" : "HST_ON") };

test("meals for a regular registrant: half the HST is an ITC, the rest adds to the expense", () => {
  const p = planExpenses(DEFS, [{ key: "meals", before: 10000, tax: 1300 }], head({ summaryTotal: 11300 }), REG);
  assert.deepEqual(p.problems, []);
  assert.equal(p.rows[0].itc, 650);
  assert.equal(p.rows[0].cost, 10650);
  assert.equal(p.credit, 11300);
  assert.deepEqual(p.rpc, [
    { chart: "60200", amount: 106.5, memo: "Meals and entertainment", tax_code: "MEALS_HST_50" },
    { chart: "21500", amount: 6.5, memo: "ITCs on expenses paid personally", is_tax: true },
    { chart: "23000", amount: -113, memo: "Paid personally by the shareholder" },
  ]);
});

test("vehicle fuel at 15,000 of 20,000 km: the business share of the cost and its HST, the rest left out", () => {
  const p = planExpenses(DEFS, [{ key: "vehicle_fuel", before: 100000, tax: 13000 }], head({ summaryTotal: 113000, kmTotal: 20000, kmBusiness: 15000 }), REG);
  assert.deepEqual(p.problems, []);
  const r = p.rows[0];
  assert.equal(r.cost, 75000);
  assert.equal(r.itc, 9750);
  assert.equal(r.leftOut, 28250);
  assert.equal(p.credit, 84750);
  assert.ok(p.tieOut, "Summary total less the personal share is the shareholder credit");
  assert.equal(113000 - p.leftOut, p.credit);
});

test("the credit is the sum of every debit, with a CRA line picked to 21400", () => {
  const p = planExpenses(DEFS, [
    { key: "meals", before: 10000, tax: 1300 }, { key: "vehicle_fuel", before: 100000, tax: 13000 }, { key: "cra", before: 250000, tax: 0, account: "21400" },
  ], head({ summaryTotal: 374300, kmTotal: 20000, kmBusiness: 15000 }), REG);
  assert.deepEqual(p.problems.filter((x) => !x.includes("receipts")), []);
  const debits = p.rpc.filter((l) => l.amount > 0).reduce((n, l) => n + Math.round(l.amount * 100), 0);
  assert.equal(-Math.round(p.rpc.at(-1)!.amount * 100), debits);
  assert.equal(p.rpc.find((l) => l.chart === "21400")!.amount, 2500);
  assert.ok(p.tieOut);
});

test("phone at 60%: the share applies to the cost and the tax", () => {
  const p = planExpenses(DEFS, [{ key: "phone", before: 10000, tax: 1300 }], head({ summaryTotal: 11300, phonePct: 60 }), REG);
  assert.equal(p.rows[0].cost, 6000);
  assert.equal(p.rows[0].itc, 780);
  assert.equal(p.rows[0].leftOut, 4520);
});

test("not registered, or the quick method: the tax adds to the cost; a capital purchase on the quick method goes to the reviewer", () => {
  const not = planExpenses(DEFS, [{ key: "meals", before: 10000, tax: 1300 }], head({ summaryTotal: 11300 }), { ...REG, registered: false });
  assert.equal(not.rows[0].cost, 11300);
  assert.equal(not.itcTotal, 0);
  const quick = planExpenses(DEFS, [{ key: "equipment", before: 200000, tax: 26000 }], head({ summaryTotal: 226000 }), { ...REG, quick: true });
  assert.equal(quick.rows[0].cost, 226000);
  assert.ok(quick.toReviewer);
});

test("the save is refused when the lines do not add up to the Summary total", () => {
  const p = planExpenses(DEFS, [{ key: "meals", before: 10000, tax: 1300 }], head({ summaryTotal: 12000 }), REG);
  assert.ok(p.problems.some((x) => x.startsWith("The lines add up to 113.00, not the Summary total of 120.00")));
});

test("GST/HST on a 'No tax normally' line is flagged until checked, then adds to the cost", () => {
  const p = planExpenses(DEFS, [{ key: "business_insurance", before: 50000, tax: 4000 }], head({ summaryTotal: 54000 }), REG);
  assert.ok(p.problems.some((x) => x.includes("normally has none")));
  const ok = planExpenses(DEFS, [{ key: "business_insurance", before: 50000, tax: 4000, taxChecked: true }], head({ summaryTotal: 54000 }), REG);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.rows[0].cost, 54000);
  assert.equal(ok.rows[0].flag, "GST/HST typed on a line that normally has none.");
});

test("a vehicle amount with no km is refused; a lease goes to the reviewer", () => {
  const p = planExpenses(DEFS, [{ key: "vehicle_lease", before: 600000, tax: 78000, receipts: 1 }], head({ summaryTotal: 678000 }), REG);
  assert.ok(p.problems.some((x) => x.startsWith("Vehicle lines: type the total km")));
  const bad = planExpenses(DEFS, [{ key: "vehicle_fuel", before: 1000, tax: 0 }], head({ summaryTotal: 1000, kmTotal: 100, kmBusiness: 200 }), REG);
  assert.ok(bad.problems.some((x) => x.startsWith("Vehicle lines")));
  assert.ok(p.reviewer.some((x) => x.includes("passenger vehicle limits")));
});

test("a line over $5,000 needs receipts; Other needs a note and an account", () => {
  const p = planExpenses(DEFS, [{ key: "other", before: 600000, tax: 0 }], head({ summaryTotal: 600000 }), REG);
  assert.ok(p.problems.includes("Other business expenses is over $5,000: attach the receipts."));
  assert.ok(p.problems.includes("Other business expenses: choose the account."));
  assert.ok(p.problems.includes("Other business expenses: add a note saying what it is."));
  const ok = planExpenses(DEFS, [{ key: "other", before: 600000, tax: 0, receipts: 1, account: "65000", note: "Signs for open houses" }], head({ summaryTotal: 600000 }), REG);
  assert.deepEqual(ok.problems, []);
});

test("a CRA payment only goes to 21400, 21500 or 21300; an Auto expenses entry needs the double-booking check", () => {
  const p = planExpenses(DEFS, [{ key: "cra", before: 1000, tax: 0, account: "60000" }], head({ summaryTotal: 1000, autoEntry: true }), REG);
  assert.ok(p.problems.includes("Payments to CRA for the company: choose one of 21400, 21500, 21300."));
  assert.ok(p.problems.some((x) => x.startsWith("This file already has an Auto expenses entry")));
  const ok = planExpenses(DEFS, [{ key: "cra", before: 1000, tax: 0, account: "21300" }], head({ summaryTotal: 1000, autoEntry: true, autoChecked: true }), REG);
  assert.deepEqual(ok.problems, []);
});

test("blank lines are dropped and the sheet must be attached", () => {
  const p = planExpenses(DEFS, [{ key: "meals", before: 0, tax: 0 }], head({ summaryTotal: 0, sheet: false }), REG);
  assert.ok(p.problems.includes("Type the amounts from the Summary for the lines that apply."));
  assert.ok(p.problems.includes("Attach the client's sheet as the source."));
  assert.equal(p.rows.length, 0);
});
