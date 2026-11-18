// Run with: node --test tests/
// Piece 1 (Hashim, Nov 18, 2026): the CRA rates page's wording for History and the activity log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVINCES, checkFactor, checkKmForm, describeCraChange, factor, fieldOfKmError, rate, sameFactor } from "../src/lib/closebook/cra-rates.ts";

test("rates show as dollars per km with two decimals; factors as a fraction", () => {
  assert.equal(rate(0.7), "0.70");
  assert.equal(rate("0.73"), "0.73");
  assert.equal(rate(null), "");
  assert.equal(factor({ numerator: 13, denominator: 113 }), "13/113");
  assert.equal(factor(null), "");
});

test("every province and territory is listed once, provinces first", () => {
  assert.equal(PROVINCES.length, 13);
  assert.equal(new Set(PROVINCES.map((p) => p.code)).size, 13);
  assert.deepEqual(PROVINCES.slice(-3).map((p) => p.code), ["NT", "NU", "YT"]);
});

test("a change to a year names the rate, the old value and the new value", () => {
  const before = { year: 2026, first_prov: 0.73, after_prov: 0.67, first_terr: 0.77, after_terr: 0.71 };
  assert.equal(describeCraChange("cb_cra_km_rates", "update", before, { ...before, first_prov: 0.74 }),
    "2026, first 5,000 km (provinces) 0.73 → 0.74");
  assert.equal(describeCraChange("cb_cra_km_rates", "insert", {}, before),
    "2026 added: first 5,000 km (provinces) 0.73, after 5,000 km (provinces) 0.67, first 5,000 km (territories) 0.77, after 5,000 km (territories) 0.71");
});

test("a factor change names the province with old and new", () => {
  assert.equal(describeCraChange("cb_cra_itc_factors", "insert", {}, { province: "ON", numerator: 13, denominator: 113 }), "Ontario ITC factor set to 13/113");
  assert.equal(describeCraChange("cb_cra_itc_factors", "update", { province: "NS", numerator: 14, denominator: 114 }, { province: "NS", numerator: 15, denominator: 115 }),
    "Nova Scotia ITC factor 14/114 → 15/115");
});

// Round 1b: the checks behind the messages under each field.

test("a year form: each wrong field gets its own message", () => {
  const good = { year: "2027", first_prov: "0.75", after_prov: "0.69", first_terr: "0.79", after_terr: "0.73" };
  assert.deepEqual(checkKmForm(good, true), {});
  assert.deepEqual(checkKmForm({ ...good, year: "27", first_prov: "", after_prov: "0.735", first_terr: "abc" }, true), {
    year: "Type the year as four digits, for example 2026.", first_prov: "Fill in this rate.",
    after_prov: "At most two decimals, for example 0.73.", first_terr: "Dollars per km, for example 0.73.",
  });
  assert.deepEqual(checkKmForm({ ...good, year: "" }, false), {}, "a change keeps its year");
});

test("a database refusal about the year goes under the year; anything else under the form", () => {
  assert.equal(fieldOfKmError("2025 is already in the table. Change its rates instead."), "year");
  assert.equal(fieldOfKmError("Nothing changed."), "form");
});

test("factors: two whole numbers, top smaller than bottom; spaces do not count as a change", () => {
  assert.equal(checkFactor("13/113"), null);
  assert.equal(checkFactor(" 14 / 114 "), null);
  assert.equal(checkFactor("13.5/113"), "Type the factor as two whole numbers with a slash, for example 13/113.");
  assert.equal(checkFactor("113/13"), "The top number must be more than 0 and smaller than the bottom number, for example 13/113.");
  assert.ok(sameFactor("13/113", " 13 / 113 "));
  assert.ok(!sameFactor("13/113", "14/114"));
});
