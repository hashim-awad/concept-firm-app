// Run with: npm test
// Step 3 "Banking" (round 23, Hashim, Nov 16, 2026): the rules behind 3.1, 3.2 and 3.3. Dummy data only.
// Each test names the case it covers in Hashim's list (H1 to H12); the rest are covered in the database test and
// on the dummy file in the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { band, feedWord, findIt, misread, monthBoxes, roundingOf, tieBoxes, type FindStatement } from "../src/lib/closebook/banking.ts";
import { coverageStrip, yearCut } from "../src/lib/closebook/step3.ts";
import { buildLedger, OPENING, type BuildChart } from "../src/lib/closebook/tb-build.ts";
import type { StatementAccount, StatementLine } from "../src/lib/statements/types.ts";

const Y0 = "2025-09-01", Y1 = "2026-08-31";
const L = (n: number, date: string, cents: number, dir: "in" | "out", balanceCents: number | null = null, postedDate: string | null = null): StatementLine =>
  ({ id: `l${n}`, date, postedDate, description: `LINE ${n}`, amountCents: cents, dir, balanceCents, page: 1, unsure: false, unsureReason: "", source: "read" });

test("H6/H7 3.1: one box per T2 line; under 1.00 is rounding, below the T2 is 'to add', above is 'too much'; an overdraft ties to 2600", () => {
  const acc = (id: string, gifi: string, books: number | null, kind: "bank" | "card" = "bank") => ({ id, label: id, gifi, kind, books });
  const boxes = tieBoxes([acc("10000", "1002", 51240), acc("10010", "1002", 245000), acc("22000", "2707", 132208, "card"), acc("10020", "1002", -2550)],
    new Map([["1002", 296200], ["2707", 252700], ["2600", 2550]]));
  assert.deepEqual(boxes.map((b) => [b.title, b.total, b.t2, b.difference, b.state]), [
    ["Bank accounts", 296240, 296200, 40, "rounding"], ["Bank overdraft", 2550, 2550, 0, "rounding"], ["Credit cards", 132208, 252700, 120492, "add"]]);
  assert.deepEqual(roundingOf(boxes), [{ gifi: "1002", title: "Bank accounts", cents: 40 }], "only a difference under 1.00 posts; 0.00 posts nothing");
  const much = tieBoxes([acc("10000", "1002", 51440)], new Map([["1002", 51200]]));
  assert.deepEqual([much[0].difference, much[0].state], [240, "much"], "H7: 514.40 against 512 is 2.40 too much");
});

test("H6: accounts 512.40 against the T2's 512: 0.40 posts to retained earnings and the opening trial balance is 0.00", () => {
  const chart = new Map<string, BuildChart>([["10000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }], ["31000", { name: "Retained earnings", account_type: "Equity", line_no: "3600.00" }]]);
  const opening = { lines: [{ code: "1002", line_no: "1002.00", name: "Cash", type: "Asset", debitCents: 51200 }], reClosingCents: 51200, reStatedCents: 51200 };
  const r = buildLedger([{ id: "b", name: "10000 Chequing", kind: "bank", chart: "10000", number: "10000", openingCents: 51240, fromBooks: true }], [], chart, new Map(), { registered: true, quick: false }, opening, Y0);
  assert.equal(r.rows.reduce((n, x) => n + x.cents, 0), 0, "the trial balance totals 0.00");
  assert.equal(r.rows.find((x) => x.key === "chart:31000")!.cents, -51240, "retained earnings 512.00 + 0.40 rounding");
  assert.equal(r.rows.find((x) => x.key === OPENING)?.cents ?? 0, 0, "nothing in Opening balances to enter");
  assert.deepEqual(r.postings.filter((p) => p.ref === "rounding:1002").map((p) => [p.cents, p.label]), [[-40, "Opening balance rounding, GIFI 1002"]]);
});

test("3.2: status words and month boxes", () => {
  assert.equal(feedWord({ statements: 0, toFix: 0, missing: 0, waived: false }).word, "Not uploaded");
  assert.equal(feedWord({ statements: 11, toFix: 0, missing: 1, waived: false }).word, "1 missing");
  assert.equal(feedWord({ statements: 11, toFix: 1, missing: 1, waived: false }).word, "1 to fix", "the cause first: a misread statement");
  assert.equal(feedWord({ statements: 12, toFix: 0, missing: 0, waived: false }).word, "Complete");
  const cells = coverageStrip(Y0, Y1, []).cells;
  assert.deepEqual(new Set(monthBoxes(cells, false).map((m) => m.state)), new Set(["none"]), "nothing uploaded: grey");
});

// 14 statements that share a day (Jul 2 2025 to Sep 2 2026), uploaded out of order.
const RBC = (() => {
  const ends = ["2025-07-02", "2025-08-01", "2025-09-02", "2025-10-02", "2025-11-03", "2025-12-02", "2026-01-02", "2026-02-02", "2026-03-02", "2026-04-02", "2026-05-01", "2026-06-02", "2026-07-02", "2026-08-03", "2026-09-02"];
  let bal = 100000;
  return ends.slice(0, -1).map((from, i) => { const o = bal; bal += 1000 * (i + 1); return { period_start: from, period_end: ends[i + 1], opening: o, closing: bal }; });
})();
test("H1: 14 statements with shared days, out of order: one list, no gap, every month green", () => {
  assert.equal(RBC.length, 14);
  const shuffled = [RBC[9], RBC[2], RBC[13], RBC[0], RBC[6], RBC[11], RBC[4], RBC[1], RBC[12], RBC[7], RBC[3], RBC[10], RBC[5], RBC[8]];
  const c = coverageStrip(Y0, Y1, shuffled);
  assert.deepEqual([c.gaps.length, c.cells.length, c.cells.every((x) => x.state === "in")], [0, 12, true]);
  const missing = coverageStrip(Y0, Y1, shuffled.filter((s) => s !== RBC[6]));
  assert.deepEqual(missing.gaps.map((g) => [g.from, g.to]), [["2026-01-03", "2026-02-01"]], "H3: one month missing: its period named");
});

test("H5: a card on 16th-to-15th cycles: a purchase on Aug 30 posted Sep 2 is in the year; the balance at the year end is right", () => {
  const card: StatementAccount = { key: "a1", last4: "4405", name: "Visa", kind: "card", periodStart: "2026-08-16", periodEnd: "2026-09-15", opening: 184620, closing: 0, summary: null,
    lines: [L(1, "2026-08-18", 8640, "in"), L(2, "2026-08-22", 184620, "out"), L(3, "2026-08-30", 12990, "in", null, "2026-09-02"), L(4, "2026-09-03", 30115, "in")] };
  card.closing = 184620 + 8640 - 184620 + 12990 + 30115;
  const cut = yearCut(card, Y0, Y1);
  assert.deepEqual(cut.inYear.map((l) => l.id), ["l1", "l2", "l3"], "by the purchase date");
  assert.equal(cut.atEnd, 184620 + 8640 - 184620 + 12990, "owing on Aug 31, 2026: 216.30");
});

test("H4: one amount misread: the line is named with the bank's balance and the amount off", () => {
  const acc: StatementAccount = { key: "a1", last4: "5678", name: "Savings", kind: "bank", periodStart: "2026-03-02", periodEnd: "2026-04-02", opening: 100000, closing: 82888, summary: null,
    lines: [L(1, "2026-03-03", 600, "out", 99400), L(2, "2026-03-05", 50000, "in", 149400), L(3, "2026-03-09", 32750, "out", 116850), L(4, "2026-03-16", 8962, "out", 107888),
      L(5, "2026-03-24", 75000, "in", 182888), L(6, "2026-04-01", 100000, "out", 82888)] };
  const m = misread(acc)!;
  assert.deepEqual([m.lineId, m.printed, m.computed, m.off], ["l3", 116850, 116650, 200]);
  assert.equal(m.sentence, "On Mar 9 the bank's balance is 1,168.50, but the lines give 1,166.50 (2.00 off).");
  acc.lines[2].amountCents = 32550;
  assert.equal(misread(acc), null, "fixed: nothing to point to");
});

test("3.3: the band; the start band shows at 1.00 or more and is explained by outstanding items (H10)", () => {
  // Opening 512.40 in the books; the bank had 1,262.40 (a cheque of 750.00 outstanding, cleared Sep 9: it posts nothing).
  const lines = [{ cents: 85000, outstanding: false }, { cents: -75000, outstanding: true }, { cents: -20000, outstanding: false }];
  // Before the item is added, the Sep 9 line still posts.
  const unexplained = band({ opening: 51240, lines: lines.map((l) => ({ ...l, outstanding: false })), bankStart: 126240, bankEnd: 126240 + 85000 - 75000 - 20000, startItems: 0, endItems: 0, waiting: false });
  assert.deepEqual([unexplained.start?.show, unexplained.start?.explained, unexplained.closing, unexplained.difference], [true, false, 51240 + 85000 - 75000 - 20000, 0],
    "the start band holds the 750.00; the year itself adds up, so DIFFERENCE is 0.00");
  const explained = band({ opening: 51240, lines, bankStart: 126240, bankEnd: 116240, startItems: -75000, endItems: 0, waiting: false });
  assert.deepEqual([explained.start?.explained, explained.difference, explained.inCount, explained.outCount], [true, 0, 1, 1], "the cleared line is not counted");
  const rounding = band({ opening: 51200, lines: [], bankStart: 51240, bankEnd: 51240, startItems: 0, endItems: 0, waiting: false });
  assert.deepEqual([rounding.start?.show, rounding.difference], [false, 0], "under 1.00 is rounding: no band, DIFFERENCE 0.00");
  const waiting = band({ opening: 51240, lines, bankStart: 126240, bankEnd: 116240, startItems: -75000, endItems: 0, waiting: true });
  assert.equal(waiting.difference, null, "a missing period: the difference waits");
});

test("H12: Find it: a 2.00 difference in one month (no printed summary) is the month highlighted", () => {
  const st = (from: string, to: string, opening: number, lines: [string, number][]): FindStatement => ({ periodStart: from, periodEnd: to, opening, lines: lines.map(([date, cents]) => ({ date, cents })) });
  const sts = [st("2025-08-01", "2025-09-02", 100000, [["2025-08-20", 5000], ["2025-09-01", 2000]]), st("2025-09-02", "2025-10-02", 107000, [["2025-09-15", -3000], ["2025-10-01", 1000]]),
    st("2025-10-02", "2025-11-03", 105000, [["2025-10-10", 4000]])];
  const ours = [{ date: "2025-09-01", cents: 2000 }, { date: "2025-09-15", cents: -3200 }, { date: "2025-10-01", cents: 1000 }, { date: "2025-10-10", cents: 4000 }];
  const m = findIt(Y0, "2025-10-31", sts, ours);
  assert.deepEqual(m.map((x) => [x.label, x.bankStart, x.bankEnd, x.ours, x.difference, x.first]), [
    ["September 2025", 105000, 104000, -1200, 200, true], ["October 2025", 104000, 109000, 5000, 0, false]]);
});
test("Find it: a calendar month's statement gives the bank at the start of the month from its opening", () => {
  const m = findIt(Y0, "2025-09-30", [{ periodStart: "2025-09-01", periodEnd: "2025-09-30", opening: 511000, lines: [{ date: "2025-09-20", cents: 1000 }] }], [{ date: "2025-09-20", cents: 1000 }]);
  assert.deepEqual([m[0].bankStart, m[0].bankEnd, m[0].difference], [511000, 512000, 0]);
});
