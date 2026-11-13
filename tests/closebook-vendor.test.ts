// Run with: npm test
// Coding suggestions: vendor rules, then the client's own coding, then firm rules; never a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { codingHistory, suggest, suggestionLabel, vendorKey } from "../src/lib/closebook/vendor.ts";

test("the vendor key drops the foreign amount, numbers and card masks", () => {
  assert.equal(vendorKey("SAMPLE PRINT SHOP GUELPH ON AMT 589.82 USD"), "SAMPLE PRINT SHOP GUELPH ON");
  assert.equal(vendorKey("Sample Pizza Waterloo ON"), "SAMPLE PIZZA WATERLOO ON");
  assert.equal(vendorKey("PAYMENT FROM - *****00*0000"), "PAYMENT FROM -");
  assert.equal(vendorKey("POS 1234 SAMPLE GAS #552"), "POS SAMPLE GAS");
});

test("order: the client's vendor rule, then the client's own coding (most used, with a count), then a firm rule; no match, no suggestion", () => {
  const rules = new Map([["SAMPLE PIZZA WATERLOO ON", { account: "60200", tax: "MEALS_HST_50" }]]);
  const history = codingHistory([
    { description: "SAMPLE PIZZA WATERLOO ON", chart_account: "65100", tax_code: "HST_ON", coded_at: "2026-02-01" },
    { description: "SAMPLE RENT 04", chart_account: "67000", tax_code: "HST_ON", coded_at: "2026-04-01" },
    { description: "SAMPLE RENT 05", chart_account: "67000", tax_code: "HST_ON", coded_at: "2026-05-01" },
    { description: "SAMPLE RENT 06", chart_account: "67100", tax_code: "HST_ON", coded_at: "2026-06-01" },
  ]);
  const firm = new Map([["SAMPLE PRINT SHOP GUELPH", { account: "65000", tax: "HST_ON" }], ["SAMPLE RENT", { account: "99999", tax: null }]]);
  assert.deepEqual(suggest("SAMPLE PIZZA WATERLOO ON", rules, history, firm), { account: "60200", tax: "MEALS_HST_50", source: "rule" });
  // Rent: coded 67000 twice and 67100 once; the client's own history beats the firm rule.
  const rent = suggest("Sample rent 07", rules, history, firm)!;
  assert.deepEqual(rent, { account: "67000", tax: "HST_ON", source: "history", count: 2 });
  assert.equal(suggestionLabel(rent), "Coded this way 2 times");
  const shop = suggest("SAMPLE PRINT SHOP GUELPH", rules, history, firm)!;
  assert.deepEqual(shop, { account: "65000", tax: "HST_ON", source: "firm" });
  assert.equal(suggestionLabel(shop), "Firm rule");
  // Nothing known about the vendor: no suggestion, whatever its name sounds like.
  assert.equal(suggest("SAMPLE BISTRO RESTAURANT", rules, history, firm), null);
  assert.equal(suggest("SAMPLE PRINT SHOP KITCHENER", rules, history, firm), null, "a similar name is not a match");
});
