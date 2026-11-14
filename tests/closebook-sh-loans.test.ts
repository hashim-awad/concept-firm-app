// Run with: npm test
// Step 5's shareholder loan schedule (round 14): CaseWare's continuity working paper per account, and the
// s.15(2) test on each shareholder's accounts together, the debit split by when it arose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addYear, buildGroups, buildSchedules, flagText, kindOf, lateRepayment, priorDueOn, type ShEntryInfo, type ShInput } from "../src/lib/closebook/sh-loans.ts";
import type { Posting } from "../src/lib/closebook/tb-build.ts";

const P = (key: string, cents: number, date: string, kind: Posting["kind"], ref = ""): Posting => ({ key, cents, date, kind, ref: ref || `${key}:${date}:${cents}`, label: `${kind} ${date}` });
const A = (key: string, number: string, line_no: string, tbCents: number, lastCents = 0) => ({ key, number, name: number, line_no, tbCents, lastCents });
const entries = new Map<string, ShEntryInfo>([
  ["e-exp", { origin: "expenses_personal", gifis: ["8810", "2781"] }],
  ["e-div", { origin: null, gifis: ["3701", "2781"] }],
  ["e-bonus", { origin: null, gifis: ["9063", "2781"] }],
  ["e-other", { origin: null, gifis: ["1062", "2781"] }],
  ["e-move", { origin: null, gifis: ["1301", "3261", "2781"] }],
]);
const YE = "2026-12-31", YS = "2026-01-01";
const owners1 = (keys: string[]) => new Map(keys.map((k) => [k, 1]));
const run = (inp: Omit<ShInput, "entries" | "own" | "yearEnd"> & { own?: boolean }, owners?: Map<string, number | null>) => {
  const s = buildSchedules({ entries, own: false, yearEnd: YE, ...inp });
  return { s, g: buildGroups(s, owners ?? owners1(s.map((x) => x.key)), { yearStart: YS, yearEnd: YE, windowDays: 30, own: inp.own ?? false }) };
};

test("s.15(2) dates: one year after year end; February 29 falls to February 28", () => {
  assert.equal(addYear("2026-12-31"), "2027-12-31");
  assert.equal(addYear("2028-02-29"), "2029-02-28");
  assert.equal(priorDueOn("2027-01-01"), "2027-12-31");
});

test("kinds: bank lines by direction, entries by origin, dividend line, salary line, else other", () => {
  assert.equal(kindOf(P("k", 500, "2026-03-01", "bank"), entries), "paid");
  assert.equal(kindOf(P("k", -500, "2026-03-01", "bank"), entries), "repaid");
  assert.equal(kindOf(P("k", -500, YE, "entry", "e-exp"), entries), "expenses");
  assert.equal(kindOf(P("k", -500, YE, "entry", "e-div"), entries), "dividends");
  assert.equal(kindOf(P("k", -500, YE, "entry", "e-bonus"), entries), "salary");
  assert.equal(kindOf(P("k", -500, YE, "entry", "e-other"), entries), "other");
});

test("continuity (Birch 23000): opening, kinds with postings, closing tied", () => {
  const k = "chart:23000";
  const { s: [s] } = run({ accounts: [A(k, "23000", "2781.10", -2_644_050)], postings: [
    P(k, -1_340_000, YS, "opening"), P(k, 200_000, "2026-06-30", "bank"), P(k, -20_000, "2026-02-20", "bank"), P(k, -50_000, "2026-12-15", "bank"),
    P(k, -146_050, YE, "entry", "e-exp"), P(k, -500_000, YE, "entry", "e-div"), P(k, -200_000, YE, "entry", "e-bonus"), P(k, -588_000, YE, "entry", "e-other")] });
  assert.deepEqual(s.movements.map((m) => [m.kind, m.cents]), [["paid", 200_000], ["repaid", -70_000], ["expenses", -146_050], ["dividends", -500_000], ["salary", -200_000], ["other", -588_000]]);
  assert.equal(s.closingCents, -2_644_050);
  assert.equal(s.tied, true);
});

test("Birch: the shareholder's accounts together. 13000 owes 1,000.00, 23000 and 25400 owe the shareholder 29,440.50: net 28,440.50 to the shareholder, no s.15(2) date", () => {
  const { g } = run({ accounts: [A("chart:13000", "13000", "1301.10", 100_000), A("chart:23000", "23000", "2781.10", -2_644_050), A("chart:25400", "25400", "3261.00", -300_000)], postings: [
    P("chart:23000", -1_340_000, YS, "opening"), P("chart:23000", -1_304_050, YE, "entry", "e-other"),
    P("chart:13000", 100_000, YE, "entry", "e-move"), P("chart:25400", -300_000, YE, "entry", "e-move")] });
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].keys, ["chart:13000", "chart:23000", "chart:25400"]);
  assert.equal(g[0].closingCents, -2_844_050);
  assert.equal(g[0].dueOn, null);
  assert.equal(g[0].lastPartCents + g[0].thisPartCents, 0);
  assert.deepEqual(g[0].flags, []);
  // An entry between the shareholder's own accounts nets: 1,000 debit on 13000 against 3,000 credit on 25400 is one 2,000 reduction.
  assert.ok(g[0].reductions.some((r) => r.ref === "e-move" && r.cents === -200_000));
});

test("Poplar: opening 5,000.00, reductions 2,000.00, closing 3,000.00. All last year's part; its date (this year end) has passed; no next-year date", () => {
  const k = "chart:23000";
  const { g: [g] } = run({ accounts: [A(k, "23000", "2781.10", 300_000)], postings: [P(k, 500_000, YS, "opening"), P(k, -200_000, "2026-05-15", "bank")] });
  assert.equal(g.lastPartCents, 300_000);
  assert.equal(g.thisPartCents, 0);
  assert.equal(g.dueOn, null);
  assert.deepEqual(g.flags, ["earlier_debit"]);
  assert.equal(flagText("earlier_debit", g.lastPartCents, YE), "3,000.00 of last year's balance was not repaid by December 31, 2026. s.15(2) may include it in the shareholder's income for the year the loan was made.");
  // The start-of-year balance, answered from the postings: 2,000.00 repaid by December 31, 2026, 3,000.00 not.
  assert.deepEqual(g.prior, { dueOn: "2026-12-31", openingCents: 500_000, repaidCents: 200_000, unpaidCents: 300_000 });
});

test("Maple: a debit arising this year is all this year's part, dated next year end", () => {
  const k = "chart:23000";
  const { g: [g] } = run({ accounts: [A(k, "23000", "2781.10", 850_000)], postings: [P(k, 800_000, "2026-04-10", "bank"), P(k, 200_000, "2026-09-30", "bank"), P(k, -150_000, "2026-11-05", "bank")] });
  assert.equal(g.lastPartCents, 0);
  assert.equal(g.thisPartCents, 850_000);
  assert.equal(g.dueOn, "2027-12-31");
  assert.equal(g.prior, null);
  assert.deepEqual(g.flags, []);
});

test("mixed: repayments go against the oldest balance first; the rest of the closing debit is this year's", () => {
  const k = "chart:23000";
  // Opening 5,000 owed; 1,000 repaid; 4,000 new advances: closing 8,000 = 4,000 last year's + 4,000 this year's.
  const { g: [g] } = run({ accounts: [A(k, "23000", "2781.10", 800_000)], postings: [P(k, 500_000, YS, "opening"), P(k, -100_000, "2026-03-01", "bank"), P(k, 400_000, "2026-08-01", "bank")] });
  assert.equal(g.lastPartCents, 400_000);
  assert.equal(g.thisPartCents, 400_000);
  assert.equal(g.dueOn, "2027-12-31");
  // Repaid more than owed at the start: last year's part is nil, never below zero.
  const { g: [h] } = run({ accounts: [A(k, "23000", "2781.10", 300_000)], postings: [P(k, 200_000, YS, "opening"), P(k, -500_000, "2026-03-01", "bank"), P(k, 600_000, "2026-08-01", "bank")] });
  assert.equal(h.lastPartCents, 0);
  assert.equal(h.thisPartCents, 300_000);
  assert.deepEqual(h.prior, { dueOn: "2026-12-31", openingCents: 200_000, repaidCents: 200_000, unpaidCents: 0 });
});

test("Maple 2027: the start-of-year balance answered from that year's postings", () => {
  const k = "chart:13000";
  const s = buildSchedules({ accounts: [A(k, "13000", "1301.10", 0)], postings: [P(k, 850_000, "2027-01-01", "opening"), P(k, -850_000, "2027-03-20", "bank")], entries, own: false, yearEnd: "2027-12-31" });
  const [g] = buildGroups(s, owners1([k]), { yearStart: "2027-01-01", yearEnd: "2027-12-31", windowDays: 30, own: false });
  assert.deepEqual(g.prior, { dueOn: "2027-12-31", openingCents: 850_000, repaidCents: 850_000, unpaidCents: 0 });
  assert.deepEqual(g.flags, []);
});

test("the 30-day flag on the shareholder's net balance, and a window setting", () => {
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-12-20", cents: -400_000 }], YE, 30), true);
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-11-15", cents: -400_000 }], YE, 30), false);
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-12-01", cents: -400_000 }], YE, 30), false);
  assert.equal(lateRepayment(0, [{ date: "2026-06-01", cents: 400_000 }, { date: "2026-11-15", cents: -400_000 }], YE, 60), true);
  const k = "chart:23000";
  const { g: [g] } = run({ accounts: [A(k, "23000", "2781.10", 0)], postings: [P(k, 600_000, "2026-07-10", "bank"), P(k, -600_000, "2026-12-20", "bank")] });
  assert.deepEqual(g.flags, ["late_repayment"]);
  // Owed to the shareholder on another account all year: the net was never a debit, no flag.
  const { g: [h] } = run({ accounts: [A(k, "23000", "2781.10", 0), A("chart:25400", "25400", "3261.00", -1_000_000)], postings: [
    P("chart:25400", -1_000_000, YS, "opening"), P(k, 600_000, "2026-07-10", "bank"), P(k, -600_000, "2026-12-20", "bank")] });
  assert.deepEqual(h.flags, []);
});

test("own books: the books' movement is one line; an account not picked has no s.15(2) test", () => {
  const { s, g } = run({ own: true, accounts: [A("acct:x", "2600", "2781.00", -1_700_000, -1_000_000), A("acct:y", "1350", "1301.00", 50_000, 0)],
    postings: [P("acct:x", -1_200_000, YE, "import"), P("acct:x", -500_000, YE, "entry", "e-div"), P("acct:y", 50_000, YE, "import")] },
  new Map([["acct:x", 2], ["acct:y", null]]));
  assert.deepEqual(s.find((x) => x.key === "acct:x")!.movements.map((m) => [m.kind, m.cents]), [["dividends", -500_000], ["books", -200_000]]);
  const picked = g.find((x) => x.shareholder === 2)!, none = g.find((x) => x.shareholder === null)!;
  assert.equal(picked.datesKnown, false);
  assert.deepEqual(none.keys, ["acct:y"]);
  assert.equal(none.dueOn, null);
  assert.equal(none.thisPartCents, 0);
});

test("two shareholders are tested apart", () => {
  const { g } = run({ accounts: [A("chart:23000", "23000", "2781.10", 100_000), A("chart:23050", "23050", "2781.20", -900_000)],
    postings: [P("chart:23000", 100_000, "2026-05-01", "bank"), P("chart:23050", -900_000, "2026-05-01", "bank")] }, new Map([["chart:23000", 1], ["chart:23050", 2]]));
  assert.equal(g.find((x) => x.shareholder === 1)!.thisPartCents, 100_000);
  assert.equal(g.find((x) => x.shareholder === 2)!.dueOn, null);
});
