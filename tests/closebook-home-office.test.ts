// Run with: node --test tests/
// Piece 4 (Hashim, Nov 18, 2026, version 2): the Home office schedule's figures, exactly as the piece's tests give them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcHome, emptyHomeInputs, homeChanges, readHomeInputs, type HomeCtx, type HomeInputs } from "../src/lib/closebook/home-office.ts";

const ON: HomeCtx = { province: "ON", regular: true, factor: { numerator: 13, denominator: 113 }, taxCode: "HST_ON" };
const T1COSTS = { heat: { paid: 135600, gst: null }, electricity: { paid: 113000, gst: null }, insurance: { paid: 90000, gst: null },
  property_tax: { paid: 400000, gst: null }, mortgage_interest: { paid: 600000, gst: null } };
const inp = (over: Partial<HomeInputs> = {}): HomeInputs => ({ ...emptyHomeInputs(), homeSqft: 2000, officeSqft: 200, costs: T1COSTS, ...over });
const entry = (r: ReturnType<typeof calcHome>) => r.lines.map((l) => `${l.amount > 0 ? "Dr" : "Cr"} ${l.number} ${(Math.abs(l.amount) / 100).toFixed(2)}`);

test("T1: 10.00%, GST/HST fills itself on heat and electricity", () => {
  const r = calcHome(inp(), ON);
  assert.equal(r.sharePct, "10.00%");
  assert.deepEqual(r.rows.filter((x) => x.paid).map((x) => [x.key, x.gst, x.gstText, x.business]), [
    ["heat", 15600, "156.00", 13560], ["electricity", 13000, "130.00", 11300], ["insurance", 0, "none", 9000],
    ["property_tax", 0, "none", 40000], ["mortgage_interest", 0, "none", 60000]]);
  assert.deepEqual([r.totalPaid, r.totalGst, r.totalBusiness], [1338600, 28600, 133860]);
  assert.deepEqual([r.expense, r.itc, r.owed], [131000, 2860, 133860]);
  assert.deepEqual(entry(r), ["Dr 65100 1310.00", "Dr 21500 28.60", "Cr 23000 1338.60"]);
  assert.equal(r.lines[0].tax_code, "HST_ON");
  assert.equal(r.lines[1].is_tax, true);
  assert.equal(r.working, "Expense 10.00% of 13,100.00 before tax = 1,310.00 · ITC 10.00% of 286.00 = 28.60 · Owed to the owner 1,338.60");
  assert.ok(r.ready);
  // Rows with nothing typed read "none" (no GST/HST) or are empty (Other).
  assert.deepEqual(r.rows.filter((x) => !x.paid).map((x) => [x.key, x.gstText]), [["water", "none"], ["rent", "none"], ["repairs", ""], ["other", ""]]);
});

test("T2: 12.50% typed instead", () => {
  const r = calcHome(inp({ mode: "pct", pctBp: 1250 }), ON);
  assert.equal(r.sharePct, "12.50%");
  assert.deepEqual([r.expense, r.itc, r.owed], [163750, 3575, 167325]);
});

test("T3: the ITC unticked", () => {
  const r = calcHome(inp({ itc: false }), ON);
  assert.deepEqual([r.expense, r.itc, r.owed], [133860, 0, 133860]);
  assert.deepEqual(entry(r), ["Dr 65100 1338.60", "Cr 23000 1338.60"]);
  assert.equal(r.lines[0].tax_code, undefined);
  assert.equal(r.record.claim, false);
});

test("T4: the blocks", () => {
  assert.deepEqual(calcHome(inp({ officeSqft: 2500 }), ON).problems.map((p) => [p.field, p.text]), [["area", "Office area can't be more than home area."]]);
  const g = calcHome(inp({ costs: { ...T1COSTS, heat: { paid: 15000, gst: 20000 } } }), ON);
  assert.deepEqual(g.problems.map((p) => [p.field, p.text]), [["heat", "GST/HST can't be more than the amount paid."]]);
  assert.equal(g.ready, false);
  assert.deepEqual(calcHome(inp(), { ...ON, factor: null }).problems.map((p) => p.text), ["Enter the ITC factor for Ontario in Closebook rules › CRA rates."]);
});

test("T8: British Columbia: nothing fills itself; GST typed on heat", () => {
  const BC: HomeCtx = { province: "BC", regular: true, factor: { numerator: 5, denominator: 105 }, taxCode: "GST" };
  assert.equal(calcHome(inp({ costs: { heat: { paid: 112000, gst: null } } }), BC).rows[0].gstText, "");
  const r = calcHome(inp({ costs: { heat: { paid: 112000, gst: 5000 } } }), BC);
  assert.deepEqual([r.expense, r.itc, r.owed], [10700, 500, 11200]);
  assert.equal(r.lines[0].tax_code, "GST");
});

test("T9: Alberta: heat fills GST at 5/105", () => {
  const AB: HomeCtx = { province: "AB", regular: true, factor: { numerator: 5, denominator: 105 }, taxCode: "GST" };
  const r = calcHome(inp({ costs: { heat: { paid: 105000, gst: null } } }), AB);
  assert.equal(r.rows[0].gst, 5000);
  assert.deepEqual([r.expense, r.itc, r.owed], [10000, 500, 10500]);
  assert.equal(r.lines[0].tax_code, "GST");
});

test("T10: not registered (or quick method): no GST/HST at all", () => {
  const r = calcHome(inp(), { province: "ON", regular: false, factor: null, taxCode: null });
  assert.deepEqual([r.expense, r.itc, r.owed], [133860, 0, 133860]);
  assert.deepEqual(entry(r), ["Dr 65100 1338.60", "Cr 23000 1338.60"]);
  assert.ok(r.rows.every((x) => x.gst === 0 && x.gstText === ""));
  assert.deepEqual(r.problems, []);
});

test("T12/T14/T15: the record; Paid to is the Signing officer; blocks only where the ITC is claimed", () => {
  const officer = { id: "signing-officer", name: "Pat Dummy, Director" };
  const r = calcHome(inp(), { ...ON, payee: officer });
  assert.deepEqual([r.record.amount, r.record.gst, r.record.payee?.name, r.ready], [133860, 2860, "Pat Dummy, Director", true]);
  assert.deepEqual(calcHome(inp(), { ...ON, payee: null, bnMissing: true }).problems.map((p) => p.text),
    ["Add the signing officer to the client record first.", "Add the business number to the client record first."]);
  const off = calcHome(inp({ itc: false }), { ...ON, payee: null, bnMissing: true });
  assert.deepEqual([off.problems.length, off.ready, off.record.payee], [0, true, null]);
});

test("History wording, and the window's values read safely", () => {
  assert.deepEqual(homeChanges(inp(), inp({ officeSqft: 250, costs: { ...T1COSTS, heat: { paid: 135600, gst: 15000 } } })), [
    { what: "Office area (sq ft)", old: "200", new: "250" }, { what: "Heat, GST/HST", old: "as filled", new: "150.00" }]);
  assert.deepEqual(readHomeInputs({ mode: "pct", pctBp: 1250, costs: { heat: { paid: 100, gst: -1 }, bogus: { paid: 5 } }, itc: false }),
    { mode: "pct", homeSqft: null, officeSqft: null, pctBp: 1250, costs: { heat: { paid: 100, gst: null } }, itc: false, paidTo: null });
});
