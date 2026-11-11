// Run with: npm test
// Matching, opposite balances and lead sheet flags (Phase 3 batch 4.1, 4.5, 5.5), on the real master lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromWorkbook } from "../src/lib/closebook/seed.ts";
import { effectiveLine, flagged, leadSheets, lockedLines, normalSide, suggestLine, typeMismatch, wrongSign, type Line } from "../src/lib/closebook/matching.ts";

const wb = fromWorkbook(readFileSync(new URL("../docs/phase3/Closebook-master-lines-APPROVED.xlsx", import.meta.url)));
const lines: Line[] = wb.lines.map((l) => ({ line_no: l.line, name: l.name, gifi_code: l.gifi, line_type: l.type, lead_sheet: l.leadSheet, statement_line: l.statementLine, default_tax_code: l.taxCode, mappable: l.mappable, pair_line: l.pair, locked: ["1301.00", "2781.00", "3701.00"].includes(l.line) }));
const byNo = new Map(lines.map((l) => [l.line_no, l]));

test("common account names find their line", () => {
  const s = (number: string, name: string) => suggestLine({ number, name }, lines).line;
  assert.equal(s("1000", "RBC business chequing"), "1002.00");
  assert.equal(s("1010", "Visa business card"), null, "numbered as an asset (1xxx): a card line (a liability) is not suggested; the reviewer decides");
  assert.equal(s("2010", "Visa business card"), "2707.00");
  assert.equal(s("2200", "HST payable"), "2680.00");
  assert.equal(s("3000", "Share capital"), "3500.00");
  assert.equal(s("5500", "Telephone and internet"), "9225.00");
  assert.equal(s("", "Brokerage fees"), "8869.00", "name match on the GIFI wording");
  assert.equal(s("", "Office stationery and supplies"), "8811.00");
  assert.equal(s("1510", "Accumulated amortization - computers"), "1775.00", "the asset's own accumulated amortization line");
  assert.equal(s("", "Accum. depreciation on motor vehicles"), "1743.00");
});

test("unclear names go to the reviewer, never guessed", () => {
  assert.equal(suggestLine({ number: "5900", name: "Johnson advance" }, lines).line, null);
  const two = suggestLine({ number: "", name: "Management fees" }, lines);
  assert.equal(two.line, null, two.reason);
  assert.equal(suggestLine({ number: "", name: "Due to shareholder" }, lines).line, null, "which shareholder is the reviewer's call");
});

test("a flipped balance moves to its paired line", () => {
  assert.equal(effectiveLine("1002.00", 500, byNo), "1002.00");
  assert.equal(effectiveLine("1002.00", -500, byNo), "2600.00", "bank in overdraft");
  assert.equal(effectiveLine("8810.00", -20, byNo), "8810.00", "no pair: stays");
});

test("type mismatch from a standard account number", () => {
  assert.equal(typeMismatch("1500", byNo.get("8810.00")), true);
  assert.equal(typeMismatch("5300", byNo.get("8810.00")), false);
  assert.equal(typeMismatch("", byNo.get("8810.00")), false);
});

test("flag rule: more than $5,000 AND more than 20%", () => {
  assert.equal(flagged(10000, 15000, 5000, 20), false, "exactly $5,000 is not more than");
  assert.equal(flagged(10000, 15001, 5000, 20), true);
  assert.equal(flagged(100000, 106000, 5000, 20), false, "6% only");
  assert.equal(flagged(0, 6500, 5000, 20), true, "new and over the amount");
  assert.equal(flagged(0, 4000, 5000, 20), false);
});

test("lead sheets: entries added, final balances, grouping", () => {
  const sheets = leadSheets(
    [{ id: "a", number: "1000", name: "Chequing", line_no: "1002.00", last_year: 31850, this_year: 48210 },
     { id: "b", number: "5300", name: "Office", line_no: "8810.00", last_year: 3000, this_year: 3220 },
     { id: "c", number: "", name: "Unmatched", line_no: null, last_year: 0, this_year: 10 }],
    new Map([["b", -200]]), byNo, wb.leadSheets.map((s) => ({ code: s.code, name: s.name })), { amount: 5000, percent: 20 });
  assert.deepEqual(sheets.map((s) => s.code), ["A", "30"]);
  assert.equal(sheets[1].rows[0].final, 3020);
  assert.equal(sheets[0].rows[0].flagged, true, "48,210 vs 31,850: over $5,000 and 51%");
});

test("wrong-sign flag: normal side by type, contra lines reversed", () => {
  assert.ok(wrongSign(byNo.get("1480.00"), -33516.85).startsWith("This line is normally a debit"));
  assert.equal(wrongSign(byNo.get("1480.00"), 500), "");
  assert.equal(wrongSign(byNo.get("1775.00"), -2880), "", "accumulated amortization is normally a credit");
  assert.ok(wrongSign(byNo.get("1775.00"), 2880), "and flagged as a debit");
  assert.ok(wrongSign(byNo.get("8520.00"), -100), "an expense in credit");
  assert.equal(wrongSign(byNo.get("8121.00"), -312400), "", "revenue is a credit");
  assert.equal(wrongSign(byNo.get("8810.00"), 0.4), "", "rounds to nothing");
});

test("locked lines come from the setting; sides include contra lines", () => {
  const locked = lockedLines(lines);
  assert.ok(locked.has("2781.00") && locked.has("1301.00") && locked.has("3701.00"));
  assert.ok(!locked.has("2781.10") && !locked.has("8523.00"), "meals is a normal line with exception sub-lines");
  assert.equal(normalSide(byNo.get("2781.10")!), "credit");
  assert.equal(normalSide(byNo.get("1775.00")!), "credit", "accumulated amortization");
  assert.equal(normalSide(byNo.get("8810.00")!), "debit");
});
