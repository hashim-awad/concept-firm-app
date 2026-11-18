// Run with: node --test tests/
// Piece 6 (Hashim, Nov 18, 2026, version 2): lead sheet flags leave out this year's tax entries (TJE) and never apply to
// INCTAX or AMORT accounts. The final balance shown still includes the TJE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadSheets, type Line } from "../src/lib/closebook/matching.ts";

const L = (line_no: string, lead_sheet: string, default_tax_code: string, line_type = "Expense"): Line =>
  ({ line_no, name: line_no, gifi_code: line_no.slice(0, 4), line_type, lead_sheet, statement_line: null, default_tax_code, mappable: true, pair_line: null });
const byNo = new Map([L("9990.00", "50", "INCTAX"), L("2680.00", "BB", "BS", "Liability"), L("1788.00", "F", "BS", "Asset"), L("8670.00", "30", "AMORT"),
  L("8862.00", "30", "FULL")].map((l) => [l.line_no, l]));
const sheets = [{ code: "50", name: "Income taxes" }, { code: "BB", name: "Payables" }, { code: "F", name: "Capital assets" }, { code: "30", name: "Expenses" }];
const flag = { amount: 5000, percent: 20 };
const accts = [
  { id: "itx", number: "90000", name: "Income tax expense", line_no: "9990.00", last_year: 9000, this_year: 0 },
  { id: "itp", number: "26800", name: "Income taxes payable", line_no: "2680.00", last_year: 0, this_year: 0 },
  { id: "acc", number: "17880", name: "Accumulated amortization", line_no: "1788.00", last_year: -14400, this_year: -14400 },
  { id: "amo", number: "86700", name: "Amortization", line_no: "8670.00", last_year: 6400, this_year: 0 },
  { id: "fee", number: "64250", name: "Accounting fees", line_no: "8862.00", last_year: 8000, this_year: 8000 },
];
const rowsOf = (entries: Map<string, number>, tje: Map<string, number>) => new Map(leadSheets(accts, entries, byNo, sheets, flag, tje).flatMap((s) => s.rows).map((r) => [r.id, r]));

test("T5/T6b: a TJE never raises a flag; INCTAX and AMORT accounts are never flagged; final balances include the TJE", () => {
  const tje = new Map([["itx", 12000], ["itp", -12000], ["amo", 6400], ["acc", -6400]]);
  const before = rowsOf(new Map(), new Map()), after = rowsOf(tje, tje);
  assert.deepEqual([...before.values()].map((r) => [r.id, r.flagged]), [["itx", false], ["itp", false], ["acc", false], ["amo", false], ["fee", false]]);
  assert.deepEqual([...after.values()].map((r) => [r.id, r.flagged]), [["itx", false], ["itp", false], ["acc", false], ["amo", false], ["fee", false]]);
  assert.deepEqual([after.get("itx")!.final, after.get("itp")!.final, after.get("acc")!.final, after.get("amo")!.final], [12000, -12000, -20800, 6400]);
});

test("T6: an AJE over both thresholds is flagged as before", () => {
  const aje = new Map([["fee", 6000]]);
  assert.equal(rowsOf(aje, new Map()).get("fee")!.flagged, true);
});

test("without TJE totals (the old call), the rule is as before", () => {
  const tje = new Map([["itp", -12000]]);
  assert.equal(new Map(leadSheets(accts, tje, byNo, sheets, flag).flatMap((s) => s.rows).map((r) => [r.id, r])).get("itp")!.flagged, true);
});
