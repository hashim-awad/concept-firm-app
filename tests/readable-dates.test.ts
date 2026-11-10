// Run with: npm test
// Batch section 13: one readable date format on screen and in the letters' footer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readableDate, wordingEnv } from "../src/lib/studio/wording.ts";

test("the template approval date reads Nov 8, 2026", () => {
  assert.equal(readableDate("2026-11-08"), "Nov 8, 2026");
  assert.equal(readableDate("2026-01-31"), "Jan 31, 2026");
  assert.equal(wordingEnv({ id: "x", label: "EL v3.32", date: "2026-11-08", texts: {} }).EL_VERSION_DATE, "Nov 8, 2026");
  assert.equal(readableDate(""), "");
});
