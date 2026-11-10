// Run with: npm test
// The step layout (Hashim, Nov 10) gives the same answers, prices and routing as batch section 4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { earlyOutOfScope, evaluate, type PricedItem, type Questionnaire } from "../src/lib/screening/engine.ts";
import { T1_V2_COUPLE, T1_V2_PRICES, T1_V2_QUESTIONS, T1_V2_RULES } from "../src/lib/screening/t1-v2.ts";
import { QUICK, T1_STEP_KEYS, TILES, buildT1Answers, type StepState, type Who } from "../src/lib/screening/t1-steps.ts";

const qn: Questionnaire = { couple_question_key: T1_V2_COUPLE.key, couple_value: T1_V2_COUPLE.value, questions: T1_V2_QUESTIONS, rules: T1_V2_RULES };
const items: PricedItem[] = Object.entries(T1_V2_PRICES).map(([code, amount_cents]) => ({ code, name: code, unit_label: "each", amount_cents }));
const perPerson = (k: string) => T1_V2_QUESTIONS.find((q) => q.key === k)?.per_person ?? false;
const spouse = { spouse_first_name: "Sam", spouse_last_name: "Dummy", spouse_email: "sam@example.test" };
const state = (x: Partial<StepState>): StepState => ({ filing: "single", spouse, quick: "none", tiles: "none", details: {}, personDetails: [{}, {}], note: "", ...x });
const tiles = (...t: [string, Who | "yes"][]) => new Map(t);
const price = (s: StepState) => evaluate(qn, buildT1Answers(s, perPerson), items);

test("every key the steps use is a published question; 5 quick checks and 11 tiles", () => {
  for (const k of T1_STEP_KEYS) assert.ok(T1_V2_QUESTIONS.some((q) => q.key === k), k);
  assert.equal(QUICK.length, 5);
  assert.equal(TILES.length, 11);
});

test("single, None of these twice: $299", () => {
  const r = price(state({}));
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 29900);
});

test("batch example through the steps: couple, rental (1), stocks for me = $697", () => {
  const r = price(state({ filing: "couple", tiles: tiles(["rental", "me"], ["investment_sales", "me"]), details: { rental_count: 1 } }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.subtotal_cents, 69700);
});

test("Both on a per-return tile charges each spouse; per-household tiles once", () => {
  const r = price(state({ filing: "couple", tiles: tiles(["investment_sales", "both"], ["t5013", "me"]), details: { t5013_count: 2 } }));
  assert.equal(r.subtotal_cents, 34900 + 2 * 9900 + 2 * 14900);
});

test("Spouse only on a follow-up tile asks the follow-up for the spouse only", () => {
  const a = buildT1Answers(state({ filing: "couple", tiles: tiles(["foreign_property", "spouse"]), personDetails: [{}, { foreign_property_high: "yes" }] }), perPerson);
  assert.equal(a.people[0].foreign_property, "no");
  assert.equal(a.people[1].foreign_property, "yes");
  assert.equal(evaluate(qn, a, items).subtotal_cents, 34900 + 29900);
});

test("each quick-check box routes out of scope, as the 5 questions did", () => {
  for (const q of QUICK) {
    const early = earlyOutOfScope(qn, buildT1Answers(state({ quick: new Set([q.key]), tiles: null }), perPerson));
    assert.deepEqual(early.map((e) => e.question), [q.key]);
  }
  assert.equal(earlyOutOfScope(qn, buildT1Answers(state({ quick: "none" }), perPerson)).length, 0);
});

test("follow-up out-of-scope answers still route out (business totals, crypto report)", () => {
  const a = buildT1Answers(state({ filing: "couple", tiles: tiles(["crypto", "both"]), personDetails: [{ crypto_report: "yes" }, { crypto_report: "no" }] }), perPerson);
  assert.deepEqual(earlyOutOfScope(qn, a).map((e) => [e.question, e.person]), [["crypto_report", 1]]);
  const b = buildT1Answers(state({ tiles: tiles(["self_employed", "me"]), details: { business_count: 1, business_totals: "no" } }), perPerson);
  assert.deepEqual(earlyOutOfScope(qn, b).map((e) => e.question), ["business_totals"]);
});

test("unticked tiles leave no stale follow-up answers", () => {
  const r = price(state({ tiles: "none", details: { rental_count: 3 } }));
  assert.equal(r.subtotal_cents, 29900);
});
