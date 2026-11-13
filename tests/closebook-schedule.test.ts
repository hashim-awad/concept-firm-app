// Run with: npm test
// Step 2, Opening balances: the Schedule 101 totals and checks, with the figures from Hashim's board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockOf, fromGifi, scheduleTotals, toGifi } from "../src/lib/closebook/schedule.ts";

const TYPE: Record<string, string> = { 1002: "Asset", 1062: "Asset", 1774: "Asset", 1775: "Asset", 2620: "Liability", 2680: "Liability", 2781: "Liability", 3500: "Equity", 3700: "Equity", 8120: "Revenue", 8810: "Expense" };
const typeOf = (c: string) => TYPE[c];
// The board, typed as on the T2 (dividends negative), stored in GIFI sign.
const board: [string, number][] = [["1002", 4821000], ["1062", 650000], ["1774", 980000], ["1775", -392000], ["2620", 375000], ["2680", 211000], ["2781", 1240000],
  ["3500", 10000], ["3660", 2948000], ["3700", toGifi("3700", -800000)]];

test("the board's totals, with 500.00 out on 3640", () => {
  const { totals, flags } = scheduleTotals(board, typeOf, 4173000, 2025000);
  assert.equal(totals.t2599, 6059000);
  assert.equal(totals.t3499, 1826000);
  assert.equal(totals.t3849calc, 4173000);             // 29,480 + 20,250 − 8,000
  assert.equal(totals.t3600, 4173000);
  assert.equal(totals.t3620, 4183000);
  assert.equal(totals.t3640, 6009000);
  assert.deepEqual(flags.map((f) => f.code), ["3640"]);
  assert.equal(flags[0].text, "500.00 less than total assets (2599, 60,590.00). Check the liabilities and equity lines.");
});

test("everything ties once the missing 500.00 is in", () => {
  const fixed = board.map(([c, v]) => [c, c === "2620" ? 425000 : v] as [string, number]);   // 3,750.00 was 4,250.00
  const { flags } = scheduleTotals(fixed, typeOf, 4173000, 2025000);
  assert.deepEqual(flags, []);
});

test("3849 typed differently from 3660 + 9999 + dividends is flagged; 9999 comes from Schedule 125 when entered", () => {
  const withIs: [string, number][] = [...board, ["8120", 3000000], ["8810", 975000]];
  const { totals, flags } = scheduleTotals(withIs, typeOf, 4100000, null);
  assert.equal(totals.t9999, 2025000);
  assert.equal(totals.ni9999From125, true);
  const f = flags.find((x) => x.code === "3849")!;
  assert.equal(f.text, "730.00 less than 3660 + 9999 + dividends and adjustments (41,730.00).");
});

test("blocks and signs", () => {
  assert.equal(blockOf("3660", "Equity"), "re");
  assert.equal(blockOf("3701", "Equity"), "re");
  assert.equal(blockOf("3500", "Equity"), "equity");
  assert.equal(blockOf("1775", "Asset"), "assets");
  assert.equal(toGifi("3700", -800000), 800000);
  assert.equal(fromGifi("3700", 800000), -800000);
  assert.equal(toGifi("1002", 100), 100);
});
