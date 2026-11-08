import { test } from "node:test";
import assert from "node:assert/strict";
import { t2FilingDeadline, daysBetween } from "../src/lib/deadlines.ts";

test("T2 filing deadline: six months after year end, month-end to month-end", () => {
  assert.equal(t2FilingDeadline("2025-12-31"), "2026-06-30");
  assert.equal(t2FilingDeadline("2026-02-28"), "2026-08-31");
  assert.equal(t2FilingDeadline("2026-06-30"), "2026-12-31");
  assert.equal(t2FilingDeadline("2026-08-31"), "2027-02-28");
  assert.equal(t2FilingDeadline("2027-08-31"), "2028-02-29", "leap year");
  assert.equal(t2FilingDeadline("2026-03-15"), "2026-09-15", "mid-month year end keeps the day");
});

test("days between dates", () => {
  assert.equal(daysBetween("2026-11-08", "2026-11-18"), 10);
  assert.equal(daysBetween("2026-11-08", "2026-11-01"), -7);
});
