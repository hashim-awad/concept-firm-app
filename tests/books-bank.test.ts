// Run with: npm test
// CB2-1 PR B: Bank transactions rules and suggestions. Dummy data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyOf, ruleApplies, splitByPercent, suggest, type BooksRule } from "../src/lib/books/bank.ts";

const rule = (p: Partial<BooksRule>): BooksRule => ({ id: "r", name: "R", priority: 0, direction: "any", accounts: [], match_all: true, conditions: [], chart_account: "60200",
  splits: null, tax_code: "HST_ON", memo: "", auto_confirm: false, active: true, ...p });

test("a rule applies by description, amount equal or between, money in or out, and account", () => {
  const coffee = { id: "1", description: "DUMMY COFFEE KITCHENER", cents: -1130 };
  assert.ok(ruleApplies(rule({ conditions: [{ field: "description", op: "contains", value: "coffee" }] }), coffee, "10000", "bank"));
  assert.ok(ruleApplies(rule({ conditions: [{ field: "amount", op: "eq", value: "11.30" }] }), coffee, "10000", "bank"));
  assert.ok(ruleApplies(rule({ conditions: [{ field: "amount", op: "between", value: "10", value2: "20" }] }), coffee, "10000", "bank"));
  assert.ok(!ruleApplies(rule({ direction: "in", conditions: [{ field: "description", op: "contains", value: "COFFEE" }] }), coffee, "10000", "bank"));
  assert.ok(!ruleApplies(rule({ accounts: ["22000"], conditions: [{ field: "description", op: "contains", value: "COFFEE" }] }), coffee, "10000", "bank"));
  // On a card a charge (positive) is money out.
  assert.ok(ruleApplies(rule({ direction: "out", conditions: [{ field: "description", op: "contains", value: "COFFEE" }] }), { ...coffee, cents: 1130 }, "22000", "card"));
});

test("a split by percentage adds up to the line to the cent", () => {
  const s = splitByPercent(-10001, [{ account: "65100", tax: "HST_ON", percent: 33.33 }, { account: "65000", tax: "HST_ON", percent: 33.33 }, { account: "69000", tax: "HST_ON", percent: 33.34 }]);
  assert.equal(s.reduce((n, r) => n + r.cents, 0), 10001);
});

test("the suggestion: the first rule by priority, else the last similar line confirmed", () => {
  const rules = [rule({ id: "b", priority: 2, chart_account: "65100", conditions: [{ field: "description", op: "contains", value: "SOFT" }] }),
    rule({ id: "a", priority: 1, chart_account: "65000", auto_confirm: true, conditions: [{ field: "description", op: "contains", value: "SOFT" }] })];
  const s = suggest({ id: "1", description: "DUMMY SOFTWARE 1234", cents: -11300 }, "10000", "bank", rules, new Map());
  assert.equal(s?.ruleId, "a"); assert.equal(s?.account, "65000"); assert.equal(s?.auto, true);
  const h = historyOf([{ description: "DUMMY PRINT SHOP 0457", account: "65100", tax: "HST_ON" }, { description: "DUMMY PRINT SHOP 0999", account: "69000", tax: null }]);
  const t = suggest({ id: "2", description: "DUMMY PRINT SHOP 1111", cents: -500 }, "10000", "bank", [], h);
  assert.deepEqual(t, { source: "history", account: "65100", tax: "HST_ON" });
  assert.equal(suggest({ id: "3", description: "UNKNOWN", cents: -1 }, "10000", "bank", [], h), null);
});
