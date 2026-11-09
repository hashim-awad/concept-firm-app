import { test } from "node:test";
import assert from "node:assert/strict";
import { t2FilingDeadline, t2BalanceDue, daysBetween, lastYearEnd, t2Deadlines } from "../src/lib/deadlines.ts";

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

test("balance due: two or three months after year end, month-end to month-end", () => {
  assert.equal(t2BalanceDue("2025-12-31", 2), "2026-02-28");
  assert.equal(t2BalanceDue("2027-12-31", 2), "2028-02-29", "leap year");
  assert.equal(t2BalanceDue("2025-12-31", 3), "2026-03-31");
  assert.equal(t2BalanceDue("2026-03-15", 2), "2026-05-15");
});

test("latest year end on or before today", () => {
  assert.equal(lastYearEnd("12-31", "2026-11-09"), "2025-12-31");
  assert.equal(lastYearEnd("10-31", "2026-11-09"), "2026-10-31");
  assert.equal(lastYearEnd("11-09", "2026-11-09"), "2026-11-09");
});

test("T2 deadlines on My day: overdue or within 90 days, oldest first, done items left out", () => {
  const clients = [
    { id: "a", legal_name: "Alpha Inc.", year_end_md: "08-31", t2_balance_due_months: 3 },
    { id: "b", legal_name: "Beta Ltd.", year_end_md: "12-31", t2_balance_due_months: 2 },
    { id: "c", legal_name: "No YE Corp", year_end_md: "", t2_balance_due_months: 2 },
  ];
  const items = t2Deadlines(clients, "2026-11-09", new Set());
  assert.deepEqual(items.map((i) => `${i.client}|${i.kind}|${i.due}|${i.days}`), [
    "Beta Ltd.|balance|2026-02-28|-254",
    "Beta Ltd.|filing|2026-06-30|-132",
    "Alpha Inc.|balance|2026-11-30|21",
  ], "Alpha filing (Feb 28, 2027) and Beta's next balance due (Feb 28, 2027) are 111 days away: not shown; no year-end: not shown here");
  const done = t2Deadlines(clients, "2026-11-09", new Set(["b|2025-12-31|balance", "b|2025-12-31|filing"]));
  assert.deepEqual(done.map((i) => i.client + "|" + i.kind), ["Alpha Inc.|balance"]);
});
