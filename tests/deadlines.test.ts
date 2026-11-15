import { test } from "node:test";
import assert from "node:assert/strict";
import { t2FilingDeadline, t2BalanceDue, daysBetween, lastYearEnd, t2Deadlines, t2DeadlinesAll, t2DeadlinesDone, t2DeadlinesDueBefore, dueBefore, cleanReason, labelInSentence, doneBeforeSummary } from "../src/lib/deadlines.ts";

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

const sample = [
  { id: "a", legal_name: "Alpha Inc.", year_end_md: "08-31", t2_balance_due_months: 3 },
  { id: "b", legal_name: "Beta Ltd.", year_end_md: "12-31", t2_balance_due_months: 2 },
  { id: "c", legal_name: "No YE Corp", year_end_md: "", t2_balance_due_months: 2 },
];

test("all T2 deadlines: latest and next year end, done or not, no day limit", () => {
  const all = t2DeadlinesAll(sample, "2026-11-09");
  assert.equal(all.length, 8, "two clients with a year end, two year ends, two kinds");
  assert.deepEqual(all.slice(-1).map((i) => `${i.client}|${i.kind}|${i.due}`), ["Alpha Inc.|filing|2028-02-29"], "next year end Aug 31, 2027: filing six months later");
});

test("Show done: done items in the same window only", () => {
  const done = new Set(["b|2025-12-31|filing", "b|2026-12-31|filing"]);
  assert.deepEqual(t2DeadlinesDone(sample, "2026-11-09", done).map((i) => `${i.client}|${i.kind}|${i.yearEnd}`), ["Beta Ltd.|filing|2025-12-31"],
    "next year's filing (Jun 30, 2027) is outside the 90 days");
});

test("mark done before a date: open deadlines due strictly before it, no 90-day limit", () => {
  const done = new Set(["b|2025-12-31|balance"]);
  const items = t2DeadlinesDueBefore(sample, "2026-11-09", done, "2027-03-01");
  assert.deepEqual(items.map((i) => `${i.client}|${i.kind}|${i.due}`), [
    "Beta Ltd.|filing|2026-06-30",
    "Alpha Inc.|balance|2026-11-30",
    "Alpha Inc.|filing|2027-02-28",
    "Beta Ltd.|balance|2027-02-28",
  ]);
  assert.equal(t2DeadlinesDueBefore(sample, "2026-11-09", done, "2026-11-30").length, 1, "due on the date itself is not before it");
  assert.deepEqual(t2DeadlinesDueBefore(sample, "2026-11-09", done, ""), [], "no date, no list");
  assert.deepEqual(dueBefore([{ due: "2026-01-01" }], "nonsense"), []);
});

test("reason for a batch: 2 to 200 characters, spaces tidied", () => {
  assert.equal(cleanReason("  Filed   before Studio "), "Filed before Studio");
  assert.equal(cleanReason("x"), null);
  assert.equal(cleanReason("x".repeat(201)), null);
  assert.equal(cleanReason("x".repeat(200))?.length, 200);
});

test("summary of a batch, with kind labels in a sentence", () => {
  assert.equal(labelInSentence("Balance due"), "balance due");
  assert.equal(labelInSentence("T2 filing"), "T2 filing");
  assert.equal(labelInSentence("GST/HST return"), "GST/HST return");
  const labels = { balance: "Balance due", filing: "T2 filing" };
  assert.equal(doneBeforeSummary([{ clientId: "a", kind: "filing" }, { clientId: "a", kind: "balance" }, { clientId: "b", kind: "filing" }], labels, "Jan 1, 2026"),
    "3 deadlines due before Jan 1, 2026 will be marked done: 2 T2 filing, 1 balance due, for 2 clients.");
  assert.equal(doneBeforeSummary([{ clientId: "a", kind: "balance" }], labels, "Jan 1, 2026"),
    "1 deadline due before Jan 1, 2026 will be marked done: 1 balance due, for 1 client.");
});
