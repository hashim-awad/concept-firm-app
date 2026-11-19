// Run with: node --test tests/
// Piece 8 (Hashim, Nov 18, 2026, version 5): Reporting > Shareholder loans, from the postings. Dummy figures (T1, T9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShReport, resultLine, atYearEnd, shown, cardTitle } from "../src/lib/closebook/sh-report.ts";
import { shReportXlsx } from "../src/lib/closebook/sh-xlsx.ts";
import type { Posting } from "../src/lib/closebook/tb-build.ts";

const P = (key: string, cents: number, kind: Posting["kind"], ref = "", date = "2026-03-01"): Posting => ({ key, cents, kind, ref, date, label: "" });
const entries = new Map([["e2", { no: "2026-002 AJE", kind: "AJE", wpRef: "Expenses paid personally schedule" }], ["e4", { no: "2026-004 AJE", kind: "AJE", wpRef: "Vehicle schedule" }],
  ["e5", { no: "2026-005 AJE", kind: "AJE", wpRef: "Home office schedule" }]]);
// Shareholder 1 (T1): opening 5,000.00 owed to the shareholder (a credit), the company paid 62,000.00 for the shareholder,
// entries credited 489.00, 8,300.00 and 1,338.60.
const sh1: Posting[] = [P("chart:23000", -500000, "opening"), P("chart:23000", 6200000, "bank", "b1"), P("chart:23000", -48900, "entry", "e2"),
  P("chart:23000", -830000, "entry", "e4"), P("chart:23000", -133860, "entry", "e5")];
const tb1 = 500000 * -1 + 6200000 - 48900 - 830000 - 133860;   // 4,687,240 debit
const acct = (key: string, number: string, name: string, tbCents: number) => ({ key, number, name, line_no: "2781.00", lastCents: 0, tbCents });

test("T1: one shareholder: credited 10,127.60 (489.00 + 8,300.00 + 1,338.60; the spec says 9,639.60, which does not add up), closing (46,872.40), ties, repay by Aug 31, 2027", () => {
  const r = buildShReport({ accounts: [acct("chart:23000", "23000", "Due to shareholder 1", tb1)], postings: sh1, entries, own: false, yearEnd: "2026-08-31", holders: new Map() });
  assert.equal(r.cards.length, 1);
  const c = r.cards[0];
  assert.equal(shown(c.openingCents), "5,000.00");
  assert.equal(shown(c.paidToCents), "(62,000.00)");
  assert.equal(shown(c.creditedCents), "10,127.60");
  assert.deepEqual(c.credited.map((e) => [e.no, shown(e.cents)]), [["2026-002 AJE", "489.00"], ["2026-004 AJE", "8,300.00"], ["2026-005 AJE", "1,338.60"]]);
  assert.equal(shown(c.closingCents), "(46,872.40)");
  assert.equal(c.tied, true);
  assert.deepEqual(resultLine(c), ["Owed by the shareholder at year-end: 46,872.40.", "Repay by Aug 31, 2027. Ties to the trial balance."]);
});

test("T9: two shareholders: Summary figures; T5: owed to the shareholder", () => {
  const sh2 = [P("chart:23050", -500000, "opening"), P("chart:23050", -320000, "bank", "b2")];
  const r = buildShReport({ accounts: [acct("chart:23000", "23000", "Due to shareholder 1", tb1), acct("chart:23050", "23050", "Due to shareholder 2", -820000)],
    postings: [...sh1, ...sh2], entries, own: false, yearEnd: "2026-08-31", holders: new Map([["chart:23000", "Pat Dummy"], ["chart:23050", "Sam Dummy"]]) });
  assert.deepEqual(r.cards.map((c) => [cardTitle(c), shown(c.openingCents), shown(c.movementCents), shown(c.closingCents), atYearEnd(c)]), [
    ["23000 Due to shareholder 1 · Pat Dummy", "5,000.00", "(51,872.40)", "(46,872.40)", "Owed by the shareholder · repay by Aug 31, 2027"],
    ["23050 Due to shareholder 2 · Sam Dummy", "5,000.00", "3,200.00", "8,200.00", "Owed to the shareholder"]]);
  assert.deepEqual([shown(r.total.openingCents), shown(r.total.movementCents), shown(r.total.closingCents)], ["10,000.00", "(48,672.40)", "(38,672.40)"]);
  assert.deepEqual(resultLine(r.cards[1]), ["Owed to the shareholder at year-end: 8,200.00.", "Ties to the trial balance."]);
  // The Excel file: the closing balances and Summary totals are formulas.
  const x = shReportXlsx(r, { client: "Example Client Inc.", yearEnd: "2026-08-31", preparedBy: "Preparer", reviewedBy: "", stamp: "Working paper: not for the client" });
  assert.ok(x.length > 500);
});

test("T8: own books: the year's movement in the client's books has its own line and the card ties", () => {
  const r = buildShReport({ accounts: [{ key: "26000", number: "26000", name: "Shareholder loan", line_no: "2781.00", lastCents: -300000, tbCents: -450000 }],
    postings: [P("26000", -450000, "import")], entries, own: true, yearEnd: "2026-12-31", holders: new Map() });
  const c = r.cards[0];
  assert.deepEqual([shown(c.openingCents), shown(c.booksCents!), shown(c.closingCents), c.tied], ["3,000.00", "1,500.00", "4,500.00", true]);
});
