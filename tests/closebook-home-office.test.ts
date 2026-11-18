// Run with: node --test tests/
// Piece 4 (Hashim, Nov 18, 2026, version 2): the Home office schedule's figures, exactly as the piece's tests give them.
// Piece 4c (approved change): the rows follow the client's home office form; the piece 4 tests use the new rows with the
// same figures (Heat and Electricity together as "Electricity and heat"), and P4c-T1 to T5 are the piece 4c tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcHome, upgradeHomeInputs, emptyHomeInputs, homeChanges, readHomeInputs, type HomeCtx, type HomeInputs } from "../src/lib/closebook/home-office.ts";

const ON: HomeCtx = { province: "ON", regular: true, factor: { numerator: 13, denominator: 113 }, taxCode: "HST_ON" };
const T1COSTS = { utilities: { paid: 248600, gst: null }, insurance: { paid: 90000, gst: null },
  property_tax: { paid: 400000, gst: null }, mortgage_interest: { paid: 600000, gst: null } };
const inp = (over: Partial<HomeInputs> = {}): HomeInputs => ({ ...emptyHomeInputs(), homeSqft: 2000, officeSqft: 200, costs: T1COSTS, ...over });
const entry = (r: ReturnType<typeof calcHome>) => r.lines.map((l) => `${l.amount > 0 ? "Dr" : "Cr"} ${l.number} ${(Math.abs(l.amount) / 100).toFixed(2)}`);

test("T1: 10.00%, GST/HST fills itself on electricity and heat", () => {
  const r = calcHome(inp(), ON);
  assert.equal(r.sharePct, "10.00%");
  assert.deepEqual(r.rows.filter((x) => x.paid).map((x) => [x.key, x.gst, x.gstText, x.business]), [
    ["mortgage_interest", 0, "none", 60000], ["property_tax", 0, "none", 40000], ["insurance", 0, "none", 9000], ["utilities", 28600, "286.00", 24860]]);
  assert.deepEqual([r.totalPaid, r.totalGst, r.totalBusiness], [1338600, 28600, 133860]);
  assert.deepEqual([r.expense, r.itc, r.owed], [131000, 2860, 133860]);
  assert.deepEqual(entry(r), ["Dr 65100 1310.00", "Dr 21500 28.60", "Cr 23000 1338.60"]);
  assert.equal(r.lines[0].tax_code, "HST_ON");
  assert.equal(r.lines[1].is_tax, true);
  assert.equal(r.working, "Expense 10.00% of 13,100.00 before tax = 1,310.00 · ITC 10.00% of 286.00 = 28.60 · Owed to the owner 1,338.60");
  assert.ok(r.ready);
  // Rows with nothing typed read "none" (no GST/HST) or are empty (filled rows with no amount, and Other).
  assert.deepEqual(r.rows.filter((x) => !x.paid).map((x) => [x.key, x.gstText]), [["rent", "none"], ["repairs", ""], ["office_repairs", ""], ["condo_fees", "none"],
    ["water", "none"], ["internet_phone", ""], ["security", ""], ["other", ""]]);
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
  const g = calcHome(inp({ costs: { ...T1COSTS, utilities: { paid: 15000, gst: 20000 } } }), ON);
  assert.deepEqual(g.problems.map((p) => [p.field, p.text]), [["utilities", "GST/HST can't be more than the amount paid."]]);
  assert.equal(g.ready, false);
  assert.deepEqual(calcHome(inp(), { ...ON, factor: null }).problems.map((p) => p.text), ["Enter the ITC factor for Ontario in Closebook rules › CRA rates."]);
});

test("T8: British Columbia: nothing fills itself; GST typed on electricity and heat", () => {
  const BC: HomeCtx = { province: "BC", regular: true, factor: { numerator: 5, denominator: 105 }, taxCode: "GST" };
  const at = (r: ReturnType<typeof calcHome>) => r.rows.find((x) => x.key === "utilities")!;
  assert.equal(at(calcHome(inp({ costs: { utilities: { paid: 112000, gst: null } } }), BC)).gstText, "");
  const r = calcHome(inp({ costs: { utilities: { paid: 112000, gst: 5000 } } }), BC);
  assert.deepEqual([r.expense, r.itc, r.owed], [10700, 500, 11200]);
  assert.equal(r.lines[0].tax_code, "GST");
});

test("T9: Alberta: electricity and heat fills GST at 5/105", () => {
  const AB: HomeCtx = { province: "AB", regular: true, factor: { numerator: 5, denominator: 105 }, taxCode: "GST" };
  const r = calcHome(inp({ costs: { utilities: { paid: 105000, gst: null } } }), AB);
  assert.equal(r.rows.find((x) => x.key === "utilities")!.gst, 5000);
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

// Piece 4c (Hashim, Nov 18, 2026, version 1): the rows of the client's form, office-only repairs, the rounding fix, four decimals, old schedules.
const H1 = { mortgage_interest: { paid: 600000, gst: null }, property_tax: { paid: 400000, gst: null }, repairs: { paid: 56500, gst: null },
  office_repairs: { paid: 22600, gst: null }, insurance: { paid: 90000, gst: null }, condo_fees: { paid: 300000, gst: null }, utilities: { paid: 248600, gst: null },
  water: { paid: 60000, gst: null }, internet_phone: { paid: 113000, gst: null }, security: { paid: 33900, gst: null } };

test("P4c-T1: mock H, the twelve rows in the form's order", () => {
  const r = calcHome(inp({ costs: H1 }), ON);
  assert.deepEqual(r.rows.map((x) => x.label), ["Rent", "Interest on mortgage", "Property tax", "General repairs and maintenance", "Repairs to the office only",
    "Home insurance", "Condominium fees", "Electricity and heat", "Water and sewer", "Home internet and phone", "Security system fees", "Other"]);
  assert.deepEqual(r.rows.filter((x) => x.office).map((x) => x.key), ["office_repairs"]);
  assert.deepEqual(r.rows.filter((x) => x.paid).map((x) => x.gstText), ["none", "none", "65.00", "26.00", "none", "none", "286.00", "none", "130.00", "39.00"]);
  assert.deepEqual([r.totalPaid, r.totalGst], [1924600, 54600]);
  assert.deepEqual(r.rows.filter((x) => x.paid).map((x) => x.business), [60000, 40000, 5650, 22600, 9000, 30000, 24860, 6000, 11300, 3390]);
  assert.equal(r.totalBusiness, 212800);
  assert.deepEqual([r.expense, r.itc, r.owed], [205000, 7800, 212800]);
  assert.deepEqual(entry(r), ["Dr 65100 2050.00", "Dr 21500 78.00", "Cr 23000 2128.00"]);
  assert.equal(r.working, "Expense 10.00% of 18,500.00 before tax = 1,850.00, plus office only 200.00 = 2,050.00 · ITC 10.00% of 520.00 = 52.00, plus office only 26.00 = 78.00 · Owed to the owner 2,128.00");
});

test("P4c-T2: rounding on the largest row, and four decimals", () => {
  const r = calcHome(inp({ homeSqft: 1300, officeSqft: 200, costs: { utilities: { paid: 180000, gst: null }, property_tax: { paid: 350000, gst: null }, mortgage_interest: { paid: 999999, gst: null } } }), ON);
  assert.equal(r.sharePct, "15.3846%");
  assert.equal(r.rows.find((x) => x.key === "utilities")!.gst, 20708);
  assert.deepEqual([r.expense, r.itc, r.owed], [232199, 3186, 235385]);
  assert.deepEqual(r.rows.filter((x) => x.paid).map((x) => [x.key, x.business]), [["mortgage_interest", 153847], ["property_tax", 53846], ["utilities", 27692]]);
  assert.equal(r.totalBusiness, 235385);
  assert.match(r.working, /^Expense 15\.3846% of 15,092\.91 before tax = 2,321\.99 · ITC 15\.3846% of 207\.08 = 31\.86 · Owed to the owner 2,353\.85$/);
});

test("P4c-T3: Alberta, home internet and phone fills 50.00, GST code", () => {
  const AB: HomeCtx = { province: "AB", regular: true, factor: { numerator: 5, denominator: 105 }, taxCode: "GST" };
  const r = calcHome(inp({ costs: { internet_phone: { paid: 105000, gst: null } } }), AB);
  assert.equal(r.rows.find((x) => x.key === "internet_phone")!.gstText, "50.00");
  assert.equal(r.lines[0].tax_code, "GST");
});

test("P4c-T4: not registered", () => {
  const r = calcHome(inp({ costs: H1 }), { province: "ON", regular: false, factor: null, taxCode: null });
  assert.deepEqual([r.expense, r.itc, r.owed], [212800, 0, 212800]);
  assert.deepEqual(entry(r), ["Dr 65100 2128.00", "Cr 23000 2128.00"]);
  assert.equal(r.working, "Expense 10.00% of 19,020.00 = 1,902.00, plus office only 226.00 = 2,128.00 · Owed to the owner 2,128.00");
});

test("P4c-T5: a schedule saved with the piece 4 rows reads into the new rows; the same entry", () => {
  const old = readHomeInputs({ mode: "area", homeSqft: 2000, officeSqft: 200, itc: true, costs: { heat: { paid: 135600, gst: null }, electricity: { paid: 113000, gst: null },
    insurance: { paid: 90000, gst: null }, property_tax: { paid: 400000, gst: null }, mortgage_interest: { paid: 600000, gst: null } } });
  const up = upgradeHomeInputs(old, ON);
  assert.deepEqual(up.costs.utilities, { paid: 248600, gst: null });
  assert.equal(up.costs.heat, undefined);
  const r = calcHome(old, ON);
  assert.equal(r.rows.find((x) => x.key === "utilities")!.gstText, "286.00");
  assert.deepEqual([r.expense, r.itc, r.owed], [131000, 2860, 133860]);
  assert.deepEqual(entry(r), ["Dr 65100 1310.00", "Dr 21500 28.60", "Cr 23000 1338.60"]);
  // Heat and electricity filled one by one (11.50 + 11.50) differ from filling the sum (23.01): the sum is kept, as typed.
  const odd = upgradeHomeInputs(readHomeInputs({ costs: { heat: { paid: 10000, gst: null }, electricity: { paid: 10000, gst: null } } }), ON);
  assert.deepEqual(odd.costs.utilities, { paid: 20000, gst: 2300 });
  // Typed amounts add as typed; water and repairs keep their figures.
  const typed = upgradeHomeInputs(readHomeInputs({ costs: { heat: { paid: 50000, gst: 4000 }, water: { paid: 30000 }, repairs: { paid: 11300 } } }), ON);
  assert.deepEqual([typed.costs.utilities, typed.costs.water, typed.costs.repairs], [{ paid: 50000, gst: 4000 }, { paid: 30000, gst: null }, { paid: 11300, gst: null }]);
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
  assert.deepEqual(homeChanges(inp(), inp({ officeSqft: 250, costs: { ...T1COSTS, utilities: { paid: 248600, gst: 15000 } } })), [
    { what: "Office area (sq ft)", old: "200", new: "250" }, { what: "Electricity and heat, GST/HST", old: "as filled", new: "150.00" }]);
  assert.deepEqual(readHomeInputs({ mode: "pct", pctBp: 1250, costs: { heat: { paid: 100, gst: -1 }, bogus: { paid: 5 } }, itc: false }),
    { mode: "pct", homeSqft: null, officeSqft: null, pctBp: 1250, costs: { heat: { paid: 100, gst: null } }, itc: false, paidTo: null });
});
