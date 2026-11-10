// Run with: npm test
// Personal tax (T1) screening, version 2 (Phase 2 batch, section 4). Uses the same definition the
// migration publishes, and the section 4 prices. Expected totals worked out by hand in each test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, type Answers, type PricedItem, type Questionnaire } from "../src/lib/screening/engine.ts";
import { T1_V2_COUPLE, T1_V2_PRICES, T1_V2_QUESTIONS, T1_V2_RULES, fillRuleValues } from "../src/lib/screening/t1-v2.ts";
import { generate } from "../scripts/gen-t1-screening-sql.ts";

const qn: Questionnaire = { couple_question_key: T1_V2_COUPLE.key, couple_value: T1_V2_COUPLE.value, questions: T1_V2_QUESTIONS, rules: T1_V2_RULES };
const items: PricedItem[] = Object.entries(T1_V2_PRICES).map(([code, amount_cents]) => ({ code, name: code, unit_label: "each", amount_cents }));

const fit = { lived_in_canada: "yes", us_citizen: "no", deceased_or_trust: "no", earlier_year: "no", cra_review: "no" };
const none = { self_employed: "no", rental: "no", sold_property: "no", t5013: "no" };
const person = { investment_sales: "no", crypto: "no", foreign_property: "no", foreign_income: "no", foreign_return: "no", t2200: "no", moving: "no" };
const couple = { filing_type: "couple", spouse_first_name: "Sam", spouse_last_name: "Dummy", spouse_email: "sam@example.test" };
const run = (h: object, people: object[]) =>
  evaluate(qn, { household: { ...fit, ...none, ...h }, people: people.map((p) => ({ ...person, ...p })) } as Answers, items);
const codes = (r: ReturnType<typeof run>) => r.lines.map((l) => `${l.code}${l.person === null ? "" : `/${l.person}`}x${l.quantity}`).sort();

test("the latest migration holds exactly the generated SQL", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261110060000_t1_screening_no_hint.sql", import.meta.url), "utf8");
  const block = sql.split("-- BEGIN GENERATED (scripts/gen-t1-screening-sql.ts)\n")[1].split("\n-- END GENERATED")[0];
  assert.equal(block, generate(), "Run: node scripts/gen-t1-screening-sql.ts and paste the output into the migration.");
});

test("single, nothing extra: PTX-110 $299", () => {
  const r = run({ filing_type: "single" }, [{}]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 29900);
});

test("batch example: couple, both employed, one rental, he has stock sales = $697", () => {
  // 349 + 249 + 99 = 697
  const r = run({ ...couple, rental: "yes", rental_count: 1 }, [{ investment_sales: "yes" }, {}]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 69700);
  assert.deepEqual(codes(r), ["PTX-111x1", "PTX-120x1", "PTX-125/0x1"]);
});

test("couple, both have investment sales: 2 x $99, per spouse", () => {
  const r = run(couple, [{ investment_sales: "yes" }, { investment_sales: "yes" }]);
  assert.equal(r.subtotal_cents, 34900 + 2 * 9900);
});

test("per-property and per-business items are once per household for a couple", () => {
  // 349 + 2 x 499 (businesses) + 1 x 150 (vehicle) + 1 x 150 (home office) + 4 x 149 (quarterly GST) + 2 x 249 (rentals)
  const r = run({ ...couple, self_employed: "yes", business_count: 2, business_totals: "yes", vehicle_count: 1, home_office_count: 1, gst_registered: "yes", gst_frequency: "4", rental: "yes", rental_count: 2 }, [{}, {}]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 34900 + 2 * 49900 + 15000 + 15000 + 4 * 14900 + 2 * 24900);
});

test("property sales: home $99, other properties $249 each", () => {
  const r = run({ filing_type: "single", sold_property: "yes", sold_home: "yes", property_sale_count: 2, assignment: "no" }, [{}]);
  assert.equal(r.subtotal_cents, 29900 + 9900 + 2 * 24900);
});

test("T1135: over the first threshold $149, over the second $299; per person", () => {
  const r = run(couple, [{ foreign_property: "yes", foreign_property_high: "no" }, { foreign_property: "yes", foreign_property_high: "yes" }]);
  assert.deepEqual(codes(r), ["PTX-111x1", "PTX-128/0x1", "PTX-129/1x1"]);
  assert.equal(r.subtotal_cents, 34900 + 14900 + 29900);
});

test("US return $799 plus $249 per state; crypto $249; T5013 $149 each; T2200, moving, foreign income $149", () => {
  const r = run({ filing_type: "single", t5013: "yes", t5013_count: 2 },
    [{ foreign_return: "yes", foreign_return_country: "us", us_state_count: 2, crypto: "yes", crypto_report: "yes", t2200: "yes", moving: "yes", foreign_income: "yes" }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 29900 + 79900 + 2 * 24900 + 24900 + 2 * 14900 + 14900 + 14900 + 14900);
});

test("every out-of-scope exit gives no quote", () => {
  const exits: [object, object][] = [
    [{ lived_in_canada: "no" }, {}], [{ us_citizen: "yes" }, {}], [{ deceased_or_trust: "yes" }, {}], [{ earlier_year: "yes" }, {}],
    [{ cra_review: "yes" }, {}],
    [{ self_employed: "yes", business_count: 1, business_totals: "no", vehicle_count: 0, home_office_count: 0, gst_registered: "no" }, {}],
    [{ sold_property: "yes", sold_home: "no", property_sale_count: 1, assignment: "yes", assignment_gst: "not_sure" }, {}],
    [{}, { crypto: "yes", crypto_report: "no" }],
    [{}, { foreign_return: "yes", foreign_return_country: "other" }],
  ];
  for (const [h, p] of exits) {
    const r = run({ filing_type: "single", ...h }, [p]);
    assert.deepEqual(r.errors, [], JSON.stringify(h));
    assert.equal(r.outOfScope.length, 1, JSON.stringify([h, p]));
    assert.equal(r.lines.length, 0);
  }
});

test("checks: home offices above businesses, and a sale with nothing sold", () => {
  assert.ok(run({ filing_type: "single", self_employed: "yes", business_count: 1, business_totals: "yes", vehicle_count: 0, home_office_count: 2, gst_registered: "no" }, [{}]).errors.length > 0);
  assert.ok(run({ filing_type: "single", sold_property: "yes", sold_home: "no", property_sale_count: 0 }, [{}]).errors.length > 0);
});

test("a couple must give the spouse's name and email", () => {
  const r = run({ filing_type: "couple" }, [{}, {}]);
  assert.deepEqual(r.errors.map((e) => e.key).sort(), ["spouse_email", "spouse_first_name", "spouse_last_name"]);
});

test("rule values come from Settings, never hard-coded in the wording", () => {
  const fp = T1_V2_QUESTIONS.find((x) => x.key === "foreign_property")!;
  assert.equal(fillRuleValues(fp.prompt, { t1135_simple_over: 100000 }).includes("$100,000"), true);
  assert.equal(fillRuleValues("{moving_km} km", { moving_km: 40 }), "40 km");
  for (const x of T1_V2_QUESTIONS) assert.ok(!/100,000|250,000|\b40 km/.test(x.prompt + x.help_text), x.key);
});

test("no repeated 'answer for both of you' hint", () => {
  for (const x of T1_V2_QUESTIONS) assert.ok(!/answer for both of you/i.test(x.help_text), x.key);
});

test("plain wording: no em dashes", () => {
  for (const x of T1_V2_QUESTIONS) assert.ok(!/—/.test(x.prompt + x.help_text + x.options.map((o) => o.label).join("")), x.key);
});

test("an out-of-scope answer is caught before the rest is filled in, so the form can stop there", async () => {
  const { earlyOutOfScope } = await import("../src/lib/screening/engine.ts");
  const partial = { household: { lived_in_canada: "yes", us_citizen: "no", deceased_or_trust: "no", earlier_year: "no", cra_review: "yes" }, people: [] };
  const early = earlyOutOfScope(qn, partial as Answers);
  assert.deepEqual(early.map((e) => e.question), ["cra_review"]);
  // The full check would still ask for the unanswered questions; the server uses the early result instead.
  assert.ok(evaluate(qn, partial as Answers, items).errors.length > 0);
  // A couple where only the spouse lacks a crypto report stops on that person.
  const c = earlyOutOfScope(qn, { household: { ...fit, ...couple }, people: [{ crypto: "yes", crypto_report: "yes" }, { crypto: "yes", crypto_report: "no" }] } as Answers);
  assert.deepEqual(c.map((e) => [e.question, e.person]), [["crypto_report", 1]]);
});
