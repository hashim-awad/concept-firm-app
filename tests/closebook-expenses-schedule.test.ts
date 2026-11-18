// Run with: node --test tests/
// Piece 4b (Hashim, Nov 18, 2026, version 2): the Expenses paid personally schedule's figures, exactly as the piece's tests give them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcExpenses, emptyExpInputs, expChanges, readExpInputs, type ExpAcct, type ExpCtx, type ExpInputs, type ExpLine } from "../src/lib/closebook/expenses-schedule.ts";

const ACCTS: Record<string, ExpAcct> = {
  "chart:65000": { label: "65000 Office supplies", tax: "taxable", meals: false },
  "chart:70500": { label: "70500 Telephone", tax: "taxable", meals: false },
  "chart:60200": { label: "60200 Meals and entertainment", tax: "taxable", meals: true },
  "chart:62000": { label: "62000 Insurance", tax: "none", meals: false },
};
const ON: ExpCtx = { province: "ON", regular: true, factor: { numerator: 13, denominator: 113 }, taxCode: "HST_ON", mealsCode: "MEALS_HST_50", accts: ACCTS };
const L = (acct: string | null, paid: number | null, over: Partial<ExpLine> = {}): ExpLine => ({ acct, what: "", paid, gst: null, pctBp: null, ...over });
const T1: ExpLine[] = [L("chart:65000", 22600, { what: "Printer ink" }), L("chart:70500", 135600, { what: "Cell phone, year", pctBp: 6000 }),
  L("chart:60200", 5650, { what: "Client lunch" }), L("chart:62000", 50000, { what: "Liability policy" })];
const inp = (lines: ExpLine[], over: Partial<ExpInputs> = {}): ExpInputs => ({ lines, itc: true, ...over });
const entry = (r: ReturnType<typeof calcExpenses>) => r.lines.map((l) => `${l.amount > 0 ? "Dr" : "Cr"} ${l.account ?? l.number} ${(Math.abs(l.amount) / 100).toFixed(2)}${l.tax_code ? ` ${l.tax_code}` : ""}`);

test("starts with three empty lines; nothing to put in yet", () => {
  const e = emptyExpInputs();
  assert.equal(e.lines.length, 3);
  const r = calcExpenses(e, ON);
  assert.equal(r.ready, false);
  assert.deepEqual(r.problems.map((p) => p.text), ["Enter the amounts paid."]);
});

test("T1: four lines, Ontario", () => {
  const r = calcExpenses(inp(T1), ON);
  assert.deepEqual(r.rows.map((x) => [x.gstText, x.expense, x.itc]), [["26.00", 20000, 2600], ["156.00", 72000, 9360], ["6.50", 5325, 325], ["none", 50000, 0]]);
  assert.deepEqual([r.expense, r.itc, r.owed], [147325, 12285, 159610]);
  assert.deepEqual(entry(r), ["Dr chart:65000 200.00 HST_ON", "Dr chart:70500 720.00 HST_ON", "Dr chart:60200 53.25 MEALS_HST_50", "Dr chart:62000 500.00",
    "Dr 21500 122.85", "Cr 23000 1596.10"]);
  assert.equal(r.lines[0].memo, "Printer ink");
  assert.equal(r.lines[4].is_tax, true);
  assert.equal(r.working, "Expenses 1,473.25 · ITC 122.85 · Owed to the owner 1,596.10");
  assert.ok(r.rows[2].meals);
  assert.ok(r.ready);
});

test("T2 and T3: one line; a fifth line added", () => {
  const r2 = calcExpenses(inp([L("chart:65000", 11300)]), ON);
  assert.deepEqual([r2.expense, r2.itc, r2.owed], [10000, 1300, 11300]);
  const r3 = calcExpenses(inp([...T1, L("chart:65000", 4520)]), ON);
  assert.deepEqual([r3.rows[4].expense, r3.rows[4].itc, r3.owed], [4000, 520, 164130]);
});

test("T4: not registered, and quick method: no GST/HST, tax included", () => {
  for (const ctx of [{ ...ON, regular: false, factor: null, taxCode: null, mealsCode: null }]) {
    const r = calcExpenses(inp(T1), ctx);
    assert.deepEqual(r.rows.map((x) => x.expense), [22600, 81360, 5650, 50000]);
    assert.ok(r.rows.every((x) => x.gstText === "" && x.itc === 0));
    assert.deepEqual(entry(r), ["Dr chart:65000 226.00", "Dr chart:70500 813.60", "Dr chart:60200 56.50", "Dr chart:62000 500.00", "Cr 23000 1596.10"]);
    assert.deepEqual(r.problems, []);
  }
});

test("T5: British Columbia: nothing fills itself; 5.00 typed", () => {
  const BC: ExpCtx = { ...ON, province: "BC", factor: { numerator: 5, denominator: 105 }, taxCode: "GST", mealsCode: "MEALS_GST_50" };
  assert.equal(calcExpenses(inp([L("chart:65000", 10500)]), BC).rows[0].gstText, "");
  const r = calcExpenses(inp([L("chart:65000", 10500, { gst: 500 })]), BC);
  assert.deepEqual([r.expense, r.itc, r.owed], [10000, 500, 10500]);
  assert.equal(r.lines[0].tax_code, "GST");
});

test("T6: Alberta: 105.00 fills 5.00", () => {
  const AB: ExpCtx = { ...ON, province: "AB", factor: { numerator: 5, denominator: 105 }, taxCode: "GST", mealsCode: "MEALS_GST_50" };
  const r = calcExpenses(inp([L("chart:65000", 10500)]), AB);
  assert.equal(r.rows[0].gst, 500);
  assert.deepEqual([r.expense, r.itc, r.owed], [10000, 500, 10500]);
  assert.equal(r.lines[0].tax_code, "GST");
});

test("T7: the blocks", () => {
  const t = (lines: ExpLine[]) => calcExpenses(inp(lines), ON).problems.map((p) => [p.field, p.text]);
  assert.deepEqual(t([L(null, 22600)]), [["acct:0", "Choose the account for this line."]]);
  assert.deepEqual(t([L("chart:65000", 22600, { gst: 30000 })]), [["gst:0", "GST/HST can't be more than the amount paid."]]);
  assert.deepEqual(t([L("chart:65000", 22600, { pctBp: 0 })]), [["pct:0", "Business % must be from 1 to 100."]]);
  assert.deepEqual(t([L("chart:65000", 22600, { pctBp: 12000 })]), [["pct:0", "Business % must be from 1 to 100."]]);
  assert.deepEqual(t([L("chart:10000", 22600)]), [["acct:0", "Choose an expense account."]]);
  assert.deepEqual(calcExpenses(inp(T1), { ...ON, factor: null }).problems.map((p) => p.text), ["Enter the ITC factor for Ontario in Closebook rules › CRA rates."]);
  assert.equal(calcExpenses(inp([L(null, 22600)]), ON).ready, false);
});

test("T10: the record; Paid to; blocks only where the ITC is claimed", () => {
  const officer = { id: "signing-officer", name: "Pat Dummy, Director" };
  const r = calcExpenses(inp(T1), { ...ON, payee: officer });
  assert.deepEqual([r.record.amount, r.record.gst, r.record.payee?.name, r.record.claim], [159610, 12285, "Pat Dummy, Director", true]);
  assert.deepEqual(calcExpenses(inp(T1), { ...ON, payee: null, bnMissing: true }).problems.map((p) => p.text),
    ["Add the signing officer to the client record first.", "Add the business number to the client record first."]);
  const off = calcExpenses(inp(T1, { itc: false }), { ...ON, payee: null, bnMissing: true });
  assert.deepEqual([off.problems.length, off.ready, off.record.claim, off.itc, off.owed], [0, true, false, 0, 159610]);
  assert.ok(off.lines.every((l) => !l.tax_code));
});

test("History wording, and the window's values read safely", () => {
  assert.deepEqual(expChanges(inp(T1), inp([...T1.slice(0, 3), L("chart:62000", 60000, { what: "Liability policy" })]), ACCTS), [
    { what: "Line 4, amount paid", old: "500.00", new: "600.00" }]);
  assert.deepEqual(expChanges(inp([L("chart:65000", 100)]), inp([L("chart:65000", 100, { pctBp: 6000 }), L("chart:70500", 200)]), ACCTS), [
    { what: "Line 1, business %", old: "100", new: "60" }, { what: "Line 2, account", old: "empty", new: "70500 Telephone" }, { what: "Line 2, amount paid", old: "empty", new: "2.00" }]);
  assert.deepEqual(readExpInputs({ lines: [{ acct: "chart:65000", what: "Ink", paid: 100, gst: -1, pctBp: 6000 }, { acct: "bad; drop", paid: "x" }], itc: false }),
    { lines: [{ acct: "chart:65000", what: "Ink", paid: 100, gst: null, pctBp: 6000 }, { acct: null, what: "", paid: null, gst: null, pctBp: null }], itc: false, paidTo: null });
  assert.equal(readExpInputs(null).lines.length, 3);
});
