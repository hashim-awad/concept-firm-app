// Run with: node --test tests/
// Piece 3 (Hashim, Nov 18, 2026): the Vehicle schedule's figures, exactly as the piece's tests T1 to T14 give them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcVehicle, emptyInputs, inputChanges, mulDiv, readInputs, yearParts, type CompanyAccount, type VehicleCtx, type VehicleInputs } from "../src/lib/closebook/vehicle-schedule.ts";

const RATES = [
  { year: 2024, first_prov: 0.70, after_prov: 0.64, first_terr: 0.74, after_terr: 0.68 },
  { year: 2025, first_prov: 0.72, after_prov: 0.66, first_terr: 0.76, after_terr: 0.70 },
  { year: 2026, first_prov: 0.73, after_prov: 0.67, first_terr: 0.77, after_terr: 0.71 },
];
const FUEL: CompanyAccount[] = [{ account: "acc-70600", number: "70600", name: "Vehicle expenses", cost: 39822, gst: 5178 }];
const birch = (over: Partial<VehicleCtx> = {}): VehicleCtx => ({
  yearStart: "2025-09-01", yearEnd: "2026-08-31", province: "ON", rates: RATES, factor: { numerator: 13, denominator: 113 },
  regular: true, company: [], taxCode: "HST_ON", ...over,
});
const inp = (over: Partial<VehicleInputs> = {}): VehicleInputs => ({ ...emptyInputs(), ...over });
// The entry as "Dr 70600 7,345.13" strings, in order.
const entry = (r: ReturnType<typeof calcVehicle>) => r.lines.map((l) => `${l.amount > 0 ? "Dr" : "Cr"} ${l.number} ${(Math.abs(l.amount) / 100).toFixed(2)}`);

test("the year's parts: by month for Sep 1 to Aug 31, by days otherwise", () => {
  const y = yearParts("2025-09-01", "2026-08-31");
  assert.equal(y.byMonth, true);
  assert.deepEqual(y.parts.map((p) => [p.year, p.units, p.label]), [[2025, 4, "Sep 1 to Dec 31, 2025"], [2026, 8, "Jan 1 to Aug 31, 2026"]]);
  assert.equal(y.before, 8);
  assert.equal(y.beforeLabel, "Jan 1 to Aug 31, 2025");
  const d = yearParts("2025-09-15", "2026-09-14");
  assert.equal(d.byMonth, false);
  assert.deepEqual(d.parts.map((p) => p.units), [108, 257]);
  assert.equal(d.before, 257);
  assert.equal(yearParts("2026-01-01", "2026-12-31").before, 0);
});

test("T1 allowance only, prorated 12,000 km", () => {
  const r = calcVehicle(inp({ businessKm: 12000 }), birch());
  assert.deepEqual(r.parts.map((p) => p.km), [4000, 8000]);
  assert.equal(r.alreadyKm, 8000);
  assert.deepEqual(r.parts.map((p) => p.amount), [264000, 566000]);
  assert.equal(r.allowance, 830000);
  assert.equal(r.itc, 95487);
  assert.deepEqual(entry(r), ["Dr 70600 7345.13", "Dr 21500 954.87", "Cr 23000 8300.00"]);
  assert.equal(r.actual, null);
  assert.equal(r.used, "allowance");
  assert.ok(r.ready);
  assert.deepEqual(r.working.slice(0, 3), [
    "2025, Sep 1 to Dec 31, 2025 (after 8,000 km already driven): 4,000 km × 0.66 = 2,640.00",
    "2026, Jan 1 to Aug 31, 2026: 5,000 km × 0.73 + 3,000 km × 0.67 = 5,660.00",
    "Per-km allowance: 8,300.00 (ITC 954.87)",
  ]);
  assert.equal(r.working[3], "Actual costs: not entered (total km needed)");
  // The ITC line is the tax itself; the expense line carries the code for the GST/HST return.
  assert.equal(r.lines[1].is_tax, true);
  assert.equal(r.lines[0].tax_code, "HST_ON");
});

test("T2 detailed 4,000 and 8,000, already driven 0", () => {
  const r = calcVehicle(inp({ method: "detailed", partKm: [4000, 8000], alreadyKm: 0 }), birch());
  assert.deepEqual(r.parts.map((p) => p.amount), [288000, 566000]);
  assert.equal(r.allowance, 854000);
  assert.equal(r.itc, 98248);
  assert.deepEqual(entry(r), ["Dr 70600 7557.52", "Dr 21500 982.48", "Cr 23000 8540.00"]);
});

test("T3 a calendar year: 5,000 × 0.73 + 7,000 × 0.67", () => {
  const r = calcVehicle(inp({ businessKm: 12000 }), birch({ yearStart: "2026-01-01", yearEnd: "2026-12-31" }));
  assert.equal(r.alreadyKm, 0);
  assert.equal(r.allowance, 834000);
  assert.equal(r.itc, 95947);
  assert.equal(r.lines[0].amount, 738053);
});

const t4 = (over: Partial<VehicleInputs> = {}) => inp({ businessKm: 12000, totalKm: 20000, ownerPaid: 937000, ownerGst: 65000, ...over });

test("T4 both sources, the allowance is higher", () => {
  const r = calcVehicle(t4(), birch({ company: FUEL }));
  assert.equal(r.sharePct, "60.00%");
  assert.equal(r.company.total, 45000);
  assert.equal(r.actual, 589200);
  assert.equal(r.higher, "allowance");
  assert.deepEqual(entry(r), ["Dr 70600 7345.13", "Dr 21500 954.87", "Cr 23000 8300.00", "Dr 23000 450.00", "Cr 70600 398.22", "Cr 21500 51.78"]);
  assert.equal(r.debits, 875000);
  // After saving: 23000 net credit 7,850.00; 70600 holds 398.22 + 7,345.13 − 398.22.
  const net = (n: string) => r.lines.filter((l) => l.number === n).reduce((s, l) => s + l.amount, 0);
  assert.equal(net("23000"), -785000);
  assert.equal(39822 + net("70600"), 734513);
  assert.equal(r.lines.find((l) => l.part === "company_cost:acc-70600")!.account, "acc-70600");
  assert.ok(r.problems.every((p) => !p.hard));
});

test("T5 actual costs chosen with Use this instead; Use the higher one returns to T4", () => {
  const r = calcVehicle(t4({ choice: "actual" }), birch({ company: FUEL }));
  assert.equal(r.used, "actual");
  assert.deepEqual(entry(r), ["Dr 70600 5232.00", "Dr 21500 390.00", "Cr 23000 5622.00", "Dr 23000 180.00", "Cr 70600 159.29", "Cr 21500 20.71"]);
  assert.equal(r.debits, 580200);
  const net = (n: string) => r.lines.filter((l) => l.number === n).reduce((s, l) => s + l.amount, 0);
  assert.equal(net("23000"), -544200);
  assert.equal(39822 + net("70600"), 547093);
  assert.equal(mulDiv(911822, 60, 100), 547093);
  assert.deepEqual(entry(calcVehicle(t4({ choice: "higher" }), birch({ company: FUEL }))), entry(calcVehicle(t4(), birch({ company: FUEL }))));
});

test("T6 actual higher at 12,500 total km", () => {
  const r = calcVehicle(t4({ totalKm: 12500 }), birch({ company: FUEL }));
  assert.equal(r.sharePct, "96.00%");
  assert.equal(r.actual, 942720);
  assert.equal(r.higher, "actual");
  assert.equal(r.used, "actual");
  assert.deepEqual(entry(r), ["Dr 70600 8371.20", "Dr 21500 624.00", "Cr 23000 8995.20", "Dr 23000 18.00", "Cr 70600 15.93", "Cr 21500 2.07"]);
});

test("T7 company-paid only: the allowance and both parts", () => {
  const r = calcVehicle(inp({ businessKm: 12000 }), birch({ company: FUEL }));
  assert.equal(r.used, "allowance");
  assert.deepEqual(entry(r), entry(calcVehicle(t4(), birch({ company: FUEL }))));
  assert.ok(!r.problems.length);
});

test("T8 the blocks", () => {
  const over = calcVehicle(t4({ businessKm: 21000 }), birch({ company: FUEL }));
  assert.deepEqual(over.problems.map((p) => [p.field, p.text, p.hard]), [["business", "Business km can't be more than total km.", true]]);
  assert.equal(over.ready, false);
  const noTotal = calcVehicle(t4({ totalKm: null }), birch({ company: FUEL }));
  assert.deepEqual(noTotal.problems.map((p) => [p.field, p.text, p.hard]), [["total", "Enter total km to compare actual costs.", false]]);
  assert.equal(noTotal.ready, true, "the allowance stays usable");
  assert.equal(noTotal.used, "allowance");
  const noRates = calcVehicle(inp({ businessKm: 12000 }), birch({ rates: RATES.filter((r) => r.year !== 2026) }));
  assert.deepEqual(noRates.problems.map((p) => p.text), ["Enter the 2026 rates in Closebook rules › CRA rates."]);
  assert.equal(noRates.ready, false);
  const noFactor = calcVehicle(inp({ businessKm: 12000 }), birch({ factor: null }));
  assert.deepEqual(noFactor.problems.map((p) => p.text), ["Enter the ITC factor for Ontario in Closebook rules › CRA rates."]);
  assert.equal(noFactor.ready, false);
});

test("T9 reopened at 10,000 km", () => {
  const r = calcVehicle(inp({ businessKm: 10000 }), birch());
  assert.deepEqual(r.parts.map((p) => p.km), [3333, 6667]);
  assert.equal(r.alreadyKm, 6667);
  assert.deepEqual(r.parts.map((p) => p.amount), [219978, 476689]);
  assert.equal(r.allowance, 696667);
  assert.equal(r.itc, 80148);
  assert.equal(r.lines[0].amount, 616519);
});

test("T12 ITC unticked: the allowance goes to 70600 in full", () => {
  const r = calcVehicle(inp({ businessKm: 12000, itc: false }), birch());
  assert.deepEqual(entry(r), ["Dr 70600 8300.00", "Cr 23000 8300.00"]);
  assert.equal(r.lines[0].tax_code, undefined);
  // The company GST/HST still reverses.
  assert.deepEqual(entry(calcVehicle(inp({ businessKm: 12000, itc: false }), birch({ company: FUEL }))).slice(2), ["Dr 23000 450.00", "Cr 70600 398.22", "Cr 21500 51.78"]);
});

test("T13 not registered (or quick method): no GST/HST lines, amounts tax included", () => {
  const r = calcVehicle(inp({ businessKm: 12000 }), birch({ regular: false, factor: null, company: [{ ...FUEL[0], cost: 45000, gst: 0 }] }));
  assert.deepEqual(entry(r), ["Dr 70600 8300.00", "Cr 23000 8300.00", "Dr 23000 450.00", "Cr 70600 450.00"]);
  assert.ok(!r.problems.length, "no ITC factor needed");
  assert.ok(r.lines.every((l) => !l.tax_code && !l.is_tax));
});

test("T14 the rate changed to 0.74 and another 100.00 of fuel", () => {
  const rates = RATES.map((r) => (r.year === 2026 ? { ...r, first_prov: 0.74 } : r));
  const fuel = [{ ...FUEL[0], cost: 39822 + 8850, gst: 5178 + 1150 }];
  const r = calcVehicle(t4(), birch({ rates, company: fuel }));
  assert.equal(r.allowance, 835000);
  assert.equal(r.itc, 96062);
  assert.equal(r.company.total, 55000);
});

test("territories use their own rates", () => {
  const r = calcVehicle(inp({ businessKm: 12000 }), birch({ yearStart: "2026-01-01", yearEnd: "2026-12-31", province: "YT", factor: { numerator: 5, denominator: 105 } }));
  assert.equal(r.allowance, 5000 * 77 + 7000 * 71);
});

test("History wording of a changed input; the window's values are read safely", () => {
  assert.deepEqual(inputChanges(inp({ businessKm: 12000 }), inp({ businessKm: 10000, totalKm: 20000 }), "2025-09-01", "2026-08-31"), [
    { what: "Business km in the year", old: "12,000", new: "10,000" },
    { what: "Total km in the year", old: "empty", new: "20,000" },
  ]);
  assert.deepEqual(inputChanges(inp({ businessKm: 12000 }), inp({ method: "detailed", partKm: [4000, 8000] }), "2025-09-01", "2026-08-31").map((c) => c.what),
    ["Method", "Business km in the year", "Business km, Sep 1 to Dec 31, 2025", "Business km, Jan 1 to Aug 31, 2026"]);
  assert.deepEqual(readInputs({ method: "x", businessKm: -5, totalKm: 20000.4, choice: "actual", itc: false }),
    { method: "prorated", businessKm: null, partKm: [], alreadyKm: null, totalKm: 20000, ownerPaid: null, ownerGst: null, choice: "actual", itc: false });
});
