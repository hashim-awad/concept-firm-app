// Run with: npm test
// CB2-1 PR C: the Overview reads accounts by GIFI line, never by account number. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewFigures } from "../src/lib/books/overview.ts";

test("cash is every account on GIFI lines 1000 to 1007 (petty cash too); receivables are not cash", () => {
  const bal = new Map([["a", 4140], ["b", 100000], ["c", 5000], ["d", -2000]]);
  const line: Record<string, string> = { a: "1002.00", b: "1001.00", c: "1060.00", d: "2600.00" };
  const f = overviewFigures(bal, (k) => line[k]);
  assert.equal(f.cash, 104140);
  assert.deepEqual(f.cashKeys.sort(), ["a", "b"]);
});

test("due to (from) shareholder nets due-from and due-to lines, short and long term, sub-lines included, any account number", () => {
  const bal = new Map([["x", -1064380], ["y", 250000], ["z", -10000], ["w", 30000], ["r", -99999]]);
  const line: Record<string, string> = { x: "3261.00", y: "1301.10", z: "2781.20", w: "2181.00", r: "2860.00" };
  const f = overviewFigures(bal, (k) => line[k]);
  assert.equal(f.shareholder, 1064380 - 250000 + 10000 - 30000);   // positive: owed to the shareholder; related parties (2860) left out
  assert.deepEqual(f.shareholderKeys.sort(), ["w", "x", "y", "z"]);
});
