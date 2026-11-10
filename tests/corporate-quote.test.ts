// Run with: npm test
// Corporate route (Phase 2 batch, sections 10 and 11): routing and the year-end price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswers, priceLines, route, yearEndDate, type CorpAnswers, type PricedItem } from "../src/lib/corporate/quote.ts";

const items: PricedItem[] = [["YE-110", 180000], ["YE-111", 240000], ["YE-112", 290000], ["YE-120", 25000], ["YE-121", 10000], ["GST-110", 19900]]
  .map(([code, amount_cents]) => ({ code: String(code), name: String(code), unit_label: "each", amount_cents: Number(amount_cents) }));
const base: CorpAnswers = {
  form: "corporate-v1", need: "year_end", extras: { gst: false, slips: false }, books: "bookkeeper",
  counts: { bank: 0, cc: 0, loc: 0, loan: 0, car: 0 }, ye: { month: 12, day: 31 }, business: "Real estate",
  flags: { behind: false, multi: false, property: false, cra: false },
};
const total = (a: CorpAnswers) => priceLines(a, items).reduce((n, l) => n + l.total_cents, 0);

test("bases: bookkeeper $1,800, software $2,400, statements $2,900", () => {
  assert.equal(total(base), 180000);
  assert.equal(total({ ...base, books: "software" }), 240000);
  assert.equal(total({ ...base, books: "statements", counts: { bank: 1, cc: 1, loc: 0, loan: 0, car: 0 } }), 290000);
});

test("batch example: statements, 2 bank accounts, 1 credit card, 1 line of credit, 1 car lease, GST/HST = $3,699", () => {
  const a: CorpAnswers = { ...base, books: "statements", counts: { bank: 2, cc: 1, loc: 1, loan: 0, car: 1 }, extras: { gst: true, slips: true } };
  const lines = priceLines(a, items);
  assert.deepEqual(lines.map((l) => `${l.code}x${l.quantity}`), ["YE-112x1", "YE-120x2", "YE-121x1", "GST-110x1"]);
  assert.equal(total(a), 369900);
});

test("tax slips are included, no price; counts only matter for bank statements", () => {
  assert.equal(total({ ...base, extras: { gst: false, slips: true } }), 180000);
  assert.equal(total({ ...base, counts: { bank: 5, cc: 5, loc: 5, loan: 5, car: 5 } }), 180000);
});

test("routing: call for monthly, paper receipts, or any box in question 7; otherwise auto-price", () => {
  assert.equal(route(base).path, "auto");
  assert.equal(route({ ...base, need: "monthly" }).path, "call");
  assert.equal(route({ ...base, books: "paper" }).path, "call");
  for (const k of ["behind", "multi", "property", "cra"] as const) assert.equal(route({ ...base, flags: { ...base.flags, [k]: true } }).path, "call", k);
  assert.deepEqual(priceLines({ ...base, need: "monthly" }, items), []);
});

test("checks the answers: missing pieces are refused, extras cleaned", () => {
  assert.equal(checkAnswers({ ...base, business: " " }).ok, false);
  assert.equal(checkAnswers({ ...base, books: "statements", counts: { bank: 1 } }).ok, false);
  assert.equal(checkAnswers({ ...base, need: "monthly" }).ok, false);
  const ok = checkAnswers({ ...base, books: "software", counts: { bank: 9, cc: 9, loc: 9, loan: 9, car: 9 } });
  assert.ok(ok.ok && ok.a.counts.bank === 0);
  assert.ok(checkAnswers({ ...base, ye: null }).ok, "I'm not sure is allowed");
});

test("year-end date: last day of the month when the day does not exist", () => {
  assert.equal(yearEndDate(2, 30, 2027), "2027-02-28");
  assert.equal(yearEndDate(12, 31, 2026), "2026-12-31");
});
