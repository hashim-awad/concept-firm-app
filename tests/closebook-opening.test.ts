// Run with: npm test
// Opening balances by GIFI code (Hashim, Nov 13, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openingFrom, parseGifiFile, type CodeInfo } from "../src/lib/closebook/opening.ts";

const info = new Map<string, CodeInfo>([
  ["1002", { line_no: "1002.00", name: "Deposits", type: "Asset" }], ["2707", { line_no: "2707.00", name: "Credit card loans", type: "Liability" }],
  ["3500", { line_no: "3500.00", name: "Common shares", type: "Equity" }], ["3660", { line_no: "3600.00", name: "Retained earnings", type: "Equity" }],
  ["3701", { line_no: "3701.10", name: "Dividends", type: "Equity" }], ["8120", { line_no: "8120.00", name: "Commission revenue", type: "Revenue" }],
  ["8810", { line_no: "8810.00", name: "Office expenses", type: "Expense" }],
]);

test("the Closebook GIFI layout: header skipped, quoted codes, CRLF", () => {
  const r = parseGifiFile(readFileSync(new URL("../docs/phase3/Sample-GIFI-TestCo.gfi", import.meta.url), "utf8"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.codes.length, 42);
  assert.deepEqual(r.codes[0], ["1002", 20795744]);
  assert.deepEqual(r.codes.find(([c]) => c === "3660"), ["3660", -8053459]);
});

test("plain code,amount lines work; bad lines and repeats are named", () => {
  const r = parseGifiFile("1002,500\n8810, 120.5\nabc\n1002,1");
  assert.deepEqual(r.codes, [["1002", 50000], ["8810", 12050]]);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[1], /1002 appears twice/);
});

test("closing retained earnings: 3660 + net income − dividends", () => {
  // Shares 100, RE start 1,000, revenue 5,000, office 1,500, dividends 2,000: closing RE 2,500; bank 2,700.
  const { opening, errors } = openingFrom([["1002", 270000], ["2707", 10000], ["3500", 10000], ["3660", 100000], ["3701", 200000], ["8120", 500000], ["8810", 150000]], info);
  assert.deepEqual(errors, []);
  assert.equal(opening.netIncomeCents, 350000);
  assert.equal(opening.reClosingCents, 100000 + 350000 - 200000);
  const d = Object.fromEntries(opening.lines.map((l) => [l.code, l.debitCents]));
  assert.deepEqual(d, { 1002: 270000, 2707: -10000, 3500: -10000, 3660: -100000, 3701: 200000, 8120: -500000, 8810: 150000 });
  // Last year's trial balance balances.
  assert.equal(Object.values(d).reduce((a, b) => a + b, 0), 0);
});

test("3849 and unknown codes are refused with the reason", () => {
  const { errors } = openingFrom([["3849", 100], ["9999", 5]], info);
  assert.match(errors[0], /Leave 3849 out/);
  assert.match(errors[1], /9999 is not a line/);
});
