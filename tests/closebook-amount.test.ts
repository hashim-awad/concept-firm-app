// Run with: npm test
// Amounts typed by staff: thousands separators and two decimals (Hashim, Nov 15, 2026, layout item 11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketAmount, formatAmount, isNegativeText, parseAmount, tidyAmount } from "../src/lib/closebook/amount.ts";

test("reads what people type, with or without commas", () => {
  assert.equal(parseAmount("48210"), 4821000);
  assert.equal(parseAmount("48,210.00"), 4821000);
  assert.equal(parseAmount("-3,920"), -392000);
  assert.equal(parseAmount(" 12 400.5 "), 1240050);
  assert.equal(parseAmount("1.234"), null, "three decimals is a typo");
  assert.equal(parseAmount("abc"), null);
});

test("shows 48,210.00 once typed; leaves an unreadable entry as typed so the check shows", () => {
  assert.equal(formatAmount(4821000), "48,210.00");
  assert.equal(formatAmount(-392000), "-3,920.00", "machine-read output keeps the minus");
  assert.equal(tidyAmount("48210"), "48,210.00");
  assert.equal(tidyAmount("8000"), "8,000.00");
  assert.equal(tidyAmount("12,40x"), "12,40x");
  assert.equal(tidyAmount(""), "");
});

test("negative amounts: a minus sign or brackets both mean negative (item C)", () => {
  assert.equal(parseAmount("(62,679.00)"), -6267900);
  assert.equal(parseAmount("-62,679.00"), -6267900);
  assert.equal(parseAmount("62,679.00-"), -6267900);
  assert.equal(parseAmount("\u221262,679.00"), -6267900, "the typographic minus");
  assert.equal(parseAmount("($1,200)"), -120000);
  assert.equal(parseAmount("(-5)"), null, "brackets and a minus together is a typo");
  assert.equal(parseAmount("(5"), null);
  assert.equal(parseAmount("(0.00)"), 0);
  assert.equal(bracketAmount(-6267900), "(62,679.00)");
  assert.equal(bracketAmount(6267900), "62,679.00");
  assert.equal(tidyAmount("-62679"), "(62,679.00)");
  assert.equal(tidyAmount("(62679)"), "(62,679.00)");
  assert.ok(isNegativeText("(1.00)") && !isNegativeText("1.00") && !isNegativeText("abc"));
});
