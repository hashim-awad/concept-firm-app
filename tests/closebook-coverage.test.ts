// Run with: npm test
// Statement periods and month coverage for bank and card accounts (Hashim, Nov 13, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountCoverage, missingText, yearMonths } from "../src/lib/closebook/coverage.ts";

const st = (s: string, e: string, opening = 0, closing = 0) => ({ account_id: "a", period_start: s, period_end: e, opening, closing });

test("the file's year as 12 months, clipped to the year", () => {
  const m = yearMonths("2025-11-01", "2026-10-31");
  assert.equal(m.length, 12);
  assert.equal(m[0].label, "Nov");
  assert.equal(m[11].key, "2026-10");
  assert.equal(yearMonths("2026-05-15", "2026-12-31").length, 8);
});

test("one file for the whole year turns all 12 months green", () => {
  const c = accountCoverage("2025-11-01", "2026-10-31", [st("2025-11-01", "2026-10-31")]);
  assert.equal(c.complete, true);
  assert.equal(c.inCount, 12);
});

test("statements cut mid-month cover the months between them; a half month is part", () => {
  const c = accountCoverage("2026-01-01", "2026-12-31", [st("2026-01-01", "2026-01-14", 1000, 2554.56), st("2026-01-15", "2026-02-14", 2554.56, 2700)]);
  assert.equal(c.months[0].state, "in");
  assert.equal(c.months[1].state, "part");
  assert.equal(c.months[2].state, "missing");
  assert.equal(c.latestClosing, 2700);
  assert.deepEqual(c.gaps.slice(0, 2), ["Feb (part)", "Mar"]);
});

test("a covered month with no transactions, and an opening that does not follow, need a look", () => {
  const c = accountCoverage("2026-01-01", "2026-03-31", [st("2026-01-01", "2026-01-31", 0, 100), st("2026-02-01", "2026-02-28", 100, 150), st("2026-03-01", "2026-03-31", 140, 200)],
    new Set(["2026-01", "2026-03"]));
  assert.deepEqual(c.months.map((m) => m.state), ["in", "empty", "check"]);
  assert.equal(c.complete, false);
});

test("the next-job line lists each account's missing months", () => {
  assert.equal(missingText([{ name: "Chequing", gaps: ["Mar"] }, { name: "Visa", gaps: ["Feb", "Mar", "Apr", "May", "Jun"] }, { name: "Savings", gaps: [] }]),
    "Chequing: Mar. Visa: Feb, Mar, Apr and 2 more");
});
