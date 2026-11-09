// Run with: npm test
// Uses the real T1 questionnaire and prices as seeded in supabase/migrations (exported to
// tests/fixtures/t1-personal-v1.json). Expected totals are worked out by hand in each test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, type Answers, type Questionnaire, type PricedItem } from "../src/lib/screening/engine.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/t1-personal-v1.json", import.meta.url), "utf8"));
const qn = fx.questionnaire as Questionnaire;
const items = fx.items as PricedItem[];

const noPerson = {
  non_resident: "no", us_person: "no", cra_review: "no", investment_sales: "no",
  foreign_property: "none", foreign_income: "no", employment_expenses: "no", moving_expenses: "no",
};
const household = {
  filing_type: "single", province: "ON", latest_year: "yes", estate_or_trust: "no",
  rental_count: 0, str_count: 0, business_count: 0, gst_return_count: 0, home_sale_count: 0, property_sale_count: 0,
};
const run = (h: object, people: object[]) => evaluate(qn, { household: { ...household, ...h }, people: people as Answers["people"] } as Answers, items);

test("single, nothing extra: $299.00", () => {
  const r = run({}, [noPerson]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 29900);
});

test("brief example: couple, both sold investments = 349 + 2 x 99 = $547.00", () => {
  const r = run({ filing_type: "couple" }, [{ ...noPerson, investment_sales: "yes" }, { ...noPerson, investment_sales: "yes" }]);
  assert.equal(r.personCount, 2);
  assert.equal(r.lines.filter((l) => l.code === "T1_INVESTMENT_SALES").length, 2);
  assert.equal(r.subtotal_cents, 34900 + 2 * 9900);
});

test("couple with 2 rentals (co-owned counted once) is charged per property, not per spouse", () => {
  // 349 + 2 x 249 = 847
  const r = run({ filing_type: "couple", rental_count: 2 }, [noPerson, noPerson]);
  assert.equal(r.subtotal_cents, 34900 + 2 * 24900);
});

test("self-employed: 1 business, 1 vehicle, home office, GST return = 299 + 499 + 150 + 150 + 149 = $1,247.00", () => {
  const r = run({ business_count: 1, vehicle_count: 1, home_office_count: 1, gst_return_count: 1 }, [noPerson]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 29900 + 49900 + 15000 + 15000 + 14900);
});

test("T1135 detailed for one spouse only = 349 + 299 = $648.00", () => {
  const r = run({ filing_type: "couple" }, [{ ...noPerson, foreign_property: "detailed" }, noPerson]);
  assert.equal(r.subtotal_cents, 34900 + 29900);
  assert.equal(r.lines.find((l) => l.code === "T1_T1135_DETAILED")?.person, 0);
});

test("vehicle and home office questions are ignored when there is no business", () => {
  const r = run({ business_count: 0, vehicle_count: 3, home_office_count: 2 }, [noPerson]);
  assert.equal(r.subtotal_cents, 29900);
});

test("more home offices than businesses is stopped", () => {
  const r = run({ business_count: 1, vehicle_count: 0, home_office_count: 2 }, [noPerson]);
  assert.ok(r.errors.some((e) => e.message.includes("Home offices")));
  assert.equal(r.lines.length, 0);
});

test("US person on the spouse makes the lead out of scope, no price", () => {
  const r = run({ filing_type: "couple" }, [noPerson, { ...noPerson, us_person: "yes" }]);
  assert.deepEqual(r.outOfScope, [{ reason: "US citizen or green card holder", person: 1 }]);
  assert.equal(r.lines.length, 0);
});

test("earlier tax year is out of scope", () => {
  const r = run({ latest_year: "no" }, [noPerson]);
  assert.equal(r.outOfScope[0].reason, "Earlier tax years");
});

test("missing answers are reported, for the right person", () => {
  const r = run({ filing_type: "couple" }, [noPerson, { ...noPerson, cra_review: "" }]);
  assert.deepEqual(r.errors, [{ key: "cra_review", person: 1, message: "Please answer this question." }]);
});

test("numbers outside the allowed range are refused", () => {
  const r = run({ rental_count: 99 }, [noPerson]);
  assert.equal(r.errors[0].key, "rental_count");
});

test("spouse answers are ignored when filing single", () => {
  const r = run({}, [noPerson, { ...noPerson, investment_sales: "yes" }]);
  assert.equal(r.personCount, 1);
  assert.equal(r.subtotal_cents, 29900);
});
