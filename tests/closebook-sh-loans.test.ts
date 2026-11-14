// Run with: npm test
// Step 5's shareholder loan schedule (round 14): CaseWare's continuity working paper, the s.15(2)
// repayment date and the two reviewer flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addYear, buildSchedules, kindOf, lateRepayment, priorDueOn, type ShEntryInfo } from "../src/lib/closebook/sh-loans.ts";
import type { Posting } from "../src/lib/closebook/tb-build.ts";

const P = (key: string, cents: number, date: string, kind: Posting["kind"], ref = ""): Posting => ({ key, cents, date, kind, ref, label: `${kind} ${date}` });
const DUE_TO = { key: "chart:23000", number: "23000", name: "Due to shareholder 1", line_no: "2781.10", lastCents: 0 };
const entries = new Map<string, ShEntryInfo>([
  ["e-exp", { origin: "expenses_personal", gifis: ["8810", "2781"] }],
  ["e-div", { origin: null, gifis: ["3701", "2781"] }],
  ["e-bonus", { origin: null, gifis: ["9063", "2781"] }],
  ["e-other", { origin: null, gifis: ["1062", "2781"] }],
]);

test("s.15(2) date: one year after year end; February 29 falls to February 28", () => {
  assert.equal(addYear("2026-12-31"), "2027-12-31");
  assert.equal(addYear("2028-02-29"), "2029-02-28");
  assert.equal(addYear("2026-06-30"), "2027-06-30");
  assert.equal(priorDueOn("2027-01-01"), "2027-12-31");
});

test("kinds: bank lines by direction, entries by origin, dividend line, salary line, else other", () => {
  assert.equal(kindOf(P("k", 500, "2026-03-01", "bank"), entries), "paid");
  assert.equal(kindOf(P("k", -500, "2026-03-01", "bank"), entries), "repaid");
  assert.equal(kindOf(P("k", -500, "2026-12-31", "entry", "e-exp"), entries), "expenses");
  assert.equal(kindOf(P("k", -500, "2026-12-31", "entry", "e-div"), entries), "dividends");
  assert.equal(kindOf(P("k", -500, "2026-12-31", "entry", "e-bonus"), entries), "salary");
  assert.equal(kindOf(P("k", -500, "2026-12-31", "entry", "e-other"), entries), "other");
  assert.equal(kindOf(P("k", 500, "2026-01-01", "opening"), entries), "opening");
});

test("continuity: opening, movements by kind with their postings, closing tied to the trial balance (credit balance)", () => {
  const ps = [
    P("chart:23000", -1_000_000, "2026-01-01", "opening"),
    P("chart:23000", 250_000, "2026-02-10", "bank"), P("chart:23000", 50_000, "2026-05-10", "bank"),
    P("chart:23000", -100_000, "2026-06-01", "bank"),
    P("chart:23000", -320_000, "2026-12-31", "entry", "e-exp"),
    P("chart:23000", -500_000, "2026-12-31", "entry", "e-div"),
    P("chart:23000", -200_000, "2026-12-31", "entry", "e-bonus"),
    P("chart:23000", 10_000, "2026-12-31", "entry", "e-other"),
    P("chart:10000", 999, "2026-02-10", "bank"),
  ];
  const [s] = buildSchedules({ accounts: [{ ...DUE_TO, tbCents: -1_810_000 }, { key: "chart:10000", number: "10000", name: "Chequing", line_no: "1002.00", tbCents: 0, lastCents: 0 }],
    postings: ps, entries, own: false, yearEnd: "2026-12-31", windowDays: 30 });
  assert.equal(s.openingCents, -1_000_000);
  assert.deepEqual(s.movements.map((m) => [m.kind, m.cents, m.items.length]), [["paid", 300_000, 2], ["repaid", -100_000, 1], ["expenses", -320_000, 1], ["dividends", -500_000, 1], ["salary", -200_000, 1], ["other", 10_000, 1]]);
  assert.equal(s.closingCents, -1_810_000);
  assert.equal(s.tied, true);
  assert.equal(s.debitAtEnd, false);
  assert.equal(s.dueOn, null);
  assert.deepEqual(s.flags, []);
});

test("not tied: the closing balance differs from the trial balance", () => {
  const [s] = buildSchedules({ accounts: [{ ...DUE_TO, tbCents: -5000 }], postings: [P("chart:23000", -4000, "2026-01-01", "opening")], entries, own: false, yearEnd: "2026-12-31", windowDays: 30 });
  assert.equal(s.tied, false);
});

test("debit arising this year: the s.15(2) date, no flag", () => {
  const [s] = buildSchedules({ accounts: [{ ...DUE_TO, tbCents: 800_000 }], postings: [P("chart:23000", 800_000, "2026-04-01", "bank")], entries, own: false, yearEnd: "2026-12-31", windowDays: 30 });
  assert.equal(s.debitAtEnd, true);
  assert.equal(s.dueOn, "2027-12-31");
  assert.deepEqual(s.flags, []);
});

test("flag A: in debit at the start and at the end of the year", () => {
  const [s] = buildSchedules({ accounts: [{ ...DUE_TO, tbCents: 300_000 }], postings: [P("chart:23000", 500_000, "2026-01-01", "opening"), P("chart:23000", -200_000, "2026-08-01", "bank")], entries, own: false, yearEnd: "2026-12-31", windowDays: 30 });
  assert.deepEqual(s.flags, ["earlier_debit"]);
  assert.equal(s.dueOn, "2027-12-31");
});

test("flag B: debit repaid to zero or credit inside the window, not before it", () => {
  const ye = "2026-12-31";
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-12-20", cents: -400_000 }], ye, 30), true);
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-11-15", cents: -400_000 }], ye, 30), false);
  // Repaid on the day the window opens (December 1 for 30 days): the balance at the end of that day is nil.
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-12-01", cents: -400_000 }], ye, 30), false);
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-12-02", cents: -500_000 }], ye, 30), true);
  // A loan made and repaid inside the window.
  assert.equal(lateRepayment(-100, [{ date: "2026-12-10", cents: 50_000 }, { date: "2026-12-12", cents: -50_000 }], ye, 30), true);
  // The window is a setting.
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-11-15", cents: -400_000 }], ye, 60), true);
  const [s] = buildSchedules({ accounts: [{ ...DUE_TO, tbCents: 0 }], postings: [P("chart:23000", 400_000, "2026-06-01", "bank"), P("chart:23000", -400_000, "2026-12-20", "bank")], entries, own: false, yearEnd: ye, windowDays: 30 });
  assert.deepEqual(s.flags, ["late_repayment"]);
  assert.equal(s.repayments.length, 1);
});

test("own books: the year's movement in the client's books is one line, our entries follow by kind", () => {
  const [s] = buildSchedules({ accounts: [{ key: "acct:x", number: "2600", name: "Shareholder loan", line_no: "2781.00", tbCents: -1_700_000, lastCents: -1_000_000 }],
    postings: [P("acct:x", -1_200_000, "2026-12-31", "import"), P("acct:x", -500_000, "2026-12-31", "entry", "e-div")], entries, own: true, yearEnd: "2026-12-31", windowDays: 30 });
  assert.equal(s.openingCents, -1_000_000);
  assert.deepEqual(s.movements.map((m) => [m.kind, m.cents]), [["dividends", -500_000], ["books", -200_000]]);
  assert.equal(s.closingCents, -1_700_000);
  assert.equal(s.tied, true);
  assert.equal(s.datesKnown, false);
});

test("only accounts on the shareholder lines", () => {
  const out = buildSchedules({ accounts: [{ key: "a", number: "13000", name: "Due from", line_no: "1301.10", tbCents: 0, lastCents: 0 }, { key: "b", number: "25400", name: "Loan", line_no: "3261.00", tbCents: 0, lastCents: 0 },
    { key: "c", number: "13500", name: "Other", line_no: "1300.00", tbCents: 0, lastCents: 0 }, { key: "d", number: "21800", name: "x", line_no: null, tbCents: 0, lastCents: 0 }], postings: [], entries, own: false, yearEnd: "2026-12-31", windowDays: 30 });
  assert.deepEqual(out.map((s) => s.number), ["13000", "25400"]);
});
