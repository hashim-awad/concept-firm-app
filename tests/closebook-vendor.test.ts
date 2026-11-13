// Run with: npm test
// Coding suggestions: vendor rules, then the client's earlier files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest, vendorKey } from "../src/lib/closebook/vendor.ts";

test("the vendor key drops the foreign amount, numbers and card masks", () => {
  assert.equal(vendorKey("SAMPLE PRINT SHOP GUELPH ON AMT 589.82 USD"), "SAMPLE PRINT SHOP GUELPH ON");
  assert.equal(vendorKey("Sample Pizza Waterloo ON"), "SAMPLE PIZZA WATERLOO ON");
  assert.equal(vendorKey("PAYMENT FROM - *****00*0000"), "PAYMENT FROM -");
  assert.equal(vendorKey("POS 1234 SAMPLE GAS #552"), "POS SAMPLE GAS");
});

test("a vendor rule beats the earlier files; nothing known means no suggestion", () => {
  const rules = new Map([["SAMPLE PIZZA WATERLOO ON", { account: "6020", tax: "MEALS_HST_50" }]]);
  const history = new Map([["SAMPLE PIZZA WATERLOO ON", { account: "6510", tax: "HST_ON" }], ["SAMPLE RENT", { account: "6700", tax: "HST_ON" }]]);
  assert.deepEqual(suggest("SAMPLE PIZZA WATERLOO ON", rules, history), { account: "6020", tax: "MEALS_HST_50", source: "rule" });
  assert.deepEqual(suggest("Sample rent 04", rules, history), { account: "6700", tax: "HST_ON", source: "last_year" });
  assert.equal(suggest("SAMPLE MUSIC STOCKHOLM", rules, history), null);
});
