// Run with: npm test
// Round 21 (Hashim, Nov 15, 2026), step 2: the retained earnings tie message (item 10), the 3660 flag
// (item 9), one sign rule for both tabs (item 12) and the account rule (item 13). Dummy figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockOf, needsAccount, RE_BLOCK, reTieMessage, scheduleTotals, toGifi } from "../src/lib/closebook/schedule.ts";
import { openingFrom, type CodeInfo } from "../src/lib/closebook/opening.ts";
import { parseAmount } from "../src/lib/closebook/amount.ts";

const TYPE: Record<string, string> = { 1002: "Asset", 1774: "Asset", 1775: "Asset", 2620: "Liability", 3500: "Equity", 3660: "Equity", 3700: "Equity", 3720: "Equity", 3740: "Equity", 8120: "Revenue", 8299: "Revenue", 8810: "Expense", 8620: "Expense" };
const typeOf = (c: string) => TYPE[c];
// What a preparer types, as printed on the T2: the contra asset and the negative adjustment in brackets,
// dividends as the positive figure printed.
const typed: [string, string][] = [["1002", "49,830.00"], ["1774", "10,000.00"], ["1775", "(2,000.00)"], ["2620", "5,000.00"], ["3500", "100.00"],
  ["3660", "41,930.00"], ["3700", "8,000.00"], ["3720", "(1,200.00)"]];
const stored = (rows: [string, string][]) => rows.map(([c, t]) => [c, toGifi(c, parseAmount(t)!)] as [string, number]);
const NI = 2000000, RE_END = 5273000;   // 3680 20,000.00; 3849 52,730.00 = 41,930 + 20,000 − 8,000 − 1,200

test("the retained earnings block is fixed, labelled and in the T2's order", () => {
  assert.deepEqual(RE_BLOCK.map(([c]) => c), ["3660", "3680", "3700", "3720", "3740", "3849"]);
  assert.equal(RE_BLOCK[0][1], "Retained earnings/deficit, start of last year");
  assert.equal(RE_BLOCK[5][1], "Retained earnings/deficit, end of last year (from the T2)");
});

test("3660 left blank: flagged, and the plain message with the difference in brackets", () => {
  const { totals, flags } = scheduleTotals(stored(typed.filter(([c]) => c !== "3660")), typeOf, RE_END, NI);
  assert.equal(totals.reDifference, -4193000);
  // 3640 still ties: the balance sheet takes 3849 as typed.
  assert.deepEqual(flags.map((f) => f.code), ["3660", "3849"]);
  assert.equal(flags.find((f) => f.code === "3660")!.text, "Line 3660 is blank. Type it from last year's T2, or 0.00 if the T2 shows none.");
  assert.equal(flags.find((f) => f.code === "3849")!.text,
    "Retained earnings do not tie. Start (3660) + net income (3680) − dividends (3700) + adjustments (3720, 3740) should equal 3849. Difference: (41,930.00). Check line 3660 on last year's T2.");
  // No em dash; the minus is U+2212.
  assert.ok(!reTieMessage(1).includes("—") && reTieMessage(1).includes("−"));
});

test("3660 typed: everything ties", () => {
  const { totals, flags } = scheduleTotals(stored(typed), typeOf, RE_END, NI);
  assert.equal(totals.t3849calc, RE_END);
  assert.equal(totals.reDifference, 0);
  assert.equal(totals.t2599, 5783000);
  assert.equal(totals.t3640, 5783000);
  assert.deepEqual(flags, []);
});

test("3680 from the Schedule 125 tab when it has lines; 3660 not flagged while 3849 is blank", () => {
  const withIs = [...stored(typed), ...stored([["8120", "30,000.00"], ["8810", "10,500.00"], ["8620", "(500.00)"]])];
  const { totals, flags } = scheduleTotals(withIs, typeOf, null, null);
  assert.equal(totals.ni9999From125, true);
  assert.equal(totals.t9999, 2000000);   // 30,000 − (10,500 − 500)
  assert.deepEqual(flags.map((f) => f.code), ["3849"]);
  assert.equal(scheduleTotals(stored(typed.filter(([c]) => c !== "3660")), typeOf, null, NI).flags.some((f) => f.code === "3660"), false);
});

test("one sign rule: typed as printed, stored as typed (dividends negative), turned into debits and credits that balance", () => {
  // "(62,679.00)" and "-62,679.00" are the same negative amount.
  assert.equal(parseAmount("(62,679.00)"), -6267900);
  assert.equal(parseAmount("-62,679.00"), -6267900);
  const s = new Map(stored(typed));
  assert.equal(s.get("1775"), -200000);    // contra asset: printed negative, stored negative
  assert.equal(s.get("3700"), -800000);    // dividends: printed positive, stored negative
  assert.equal(s.get("3720"), -120000);    // a negative adjustment keeps its sign
  assert.equal(toGifi("3720", 120000), 120000);   // a positive one too
  const info = new Map<string, CodeInfo>(Object.entries(TYPE).map(([c, type]) => [c, { line_no: `${c}.00`, name: c, type }]));
  const { opening, errors } = openingFrom(stored(typed), info, NI);
  assert.deepEqual(errors, []);
  const d = Object.fromEntries(opening.lines.map((l) => [l.code, l.debitCents]));
  // Assets debit, contra asset credit, liabilities and equity credit, dividends and a negative adjustment debit.
  assert.deepEqual(d, { 1002: 4983000, 1774: 1000000, 1775: -200000, 2620: -500000, 3500: -10000, 3660: -4193000, 3700: 800000, 3720: 120000 });
  assert.equal(opening.reClosingCents, RE_END);
  // The opening trial balance: balance sheet lines plus retained earnings at the start of this year net to nil.
  const bs = opening.lines.filter((l) => l.type !== "Revenue" && l.type !== "Expense" && !(Number(l.code) >= 3660 && Number(l.code) <= 3848));
  assert.equal(bs.reduce((n, l) => n + l.debitCents, 0) - opening.reClosingCents, 0);
  // Schedule 125: revenue and expenses typed positive; revenue a credit, an expense a debit, a contra expense a credit.
  const p = openingFrom(stored([["8120", "30,000.00"], ["8810", "10,500.00"], ["8620", "(500.00)"]]), info).opening;
  assert.deepEqual(Object.fromEntries(p.lines.map((l) => [l.code, l.debitCents])), { 8120: -3000000, 8620: -50000, 8810: 1050000 });
  assert.equal(p.netIncomeCents, 2000000);
});

test("accounts: every Schedule 100 line with an amount needs one; Schedule 125 lines do not", () => {
  assert.equal(needsAccount(blockOf("1744", "Asset"), 150000), true);
  assert.equal(needsAccount(blockOf("3260", "Liability"), 6267900), true);
  assert.equal(needsAccount(blockOf("3700", "Equity"), -800000), true);
  assert.equal(needsAccount(blockOf("1744", "Asset"), 0), false);
  assert.equal(needsAccount(blockOf("1744", "Asset"), null), false);
  assert.equal(needsAccount(blockOf("8120", "Revenue"), 100), false);
});
