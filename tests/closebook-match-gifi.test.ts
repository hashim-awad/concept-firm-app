// Run with: node --test tests/
// Piece R1 (Hashim, Nov 19, 2026): step 8's "Match accounts to GIFI": rows per GIFI code, the override, the ties line,
// the papers and the old addresses. Dummy figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRows, tieItems } from "../src/lib/closebook/match-gifi.ts";
import { gifiCodes } from "../src/lib/closebook/gifi.ts";
import { stepFromLegacy, stepPapers } from "../src/lib/closebook/steps.ts";
import type { Line } from "../src/lib/closebook/matching.ts";

const L = (line_no: string, name: string, line_type: string, pair_line: string | null = null): Line =>
  ({ line_no, name, gifi_code: line_no.slice(0, 4), line_type, lead_sheet: "A", statement_line: null, default_tax_code: "FULL", mappable: true, pair_line });
const lines = new Map([L("1002.00", "Deposits in Canadian banks and institutions - Canadian currency", "Asset", "2600.00"), L("2600.00", "Bank overdraft", "Liability", "1002.00"),
  L("1301.10", "Due from shareholder 1", "Asset"), L("1301.00", "Due from individual shareholder(s)", "Asset"), L("8810.00", "Office expenses", "Expense"),
  L("8811.00", "Office stationery and supplies", "Expense"), L("8000.00", "Trade sales of goods and services", "Revenue"), L("3600.00", "Retained earnings/deficit", "Equity")].map((l) => [l.line_no, l]));
const A = (id: string, number: string, name: string, line_no: string | null, this_year: number, gifi_override: string | null = null) => ({ id, number, name, line_no, this_year, gifi_override, needs_reviewer: false });
const accounts = [A("a1", "10000", "Chequing", "1002.00", 12400), A("a2", "10100", "Savings", "1002.00", 5000), A("a3", "13000", "Due from shareholder 1", "1301.10", 27500),
  A("a4", "65100", "Office expenses", "8810.00", 3000, "8811.00"), A("a5", "40100", "Commission income", "8000.00", -50000), A("a6", "30000", "Retained earnings", "3600.00", 2100)];

test("T1: one row per GIFI code with a balance, in GIFI order, sub-lines added in; box accounts left out", () => {
  const rows = matchRows(accounts, new Map(), lines, new Set(["a5"]));
  assert.deepEqual(rows.map((r) => [r.code, r.accounts.length, r.cents]), [["1002", 2, 1740000], ["1301", 1, 2750000], ["3660", 1, 210000], ["8811", 1, 300000]]);
  // Mock M (D8): the line keeps "(n)" and the total; full master line names; 12,400.00 + 5,000.00 = 17,400.00.
  assert.equal(rows[0].name, "Deposits in Canadian banks and institutions - Canadian currency");
  assert.equal(rows[1].name, "Due from individual shareholder(s)");
  assert.equal(rows[2].name, "Retained earnings/deficit – Start");
  assert.equal(rows[3].accounts[0].overridden, true, "the office account sits on its override, 8811");
});

test("T2: the override is the GIFI line; the group stays for the statements", () => {
  const g = gifiCodes(accounts, new Map(), lines);
  assert.deepEqual(g.codes.filter(([c]) => c.startsWith("88")), [["8811", 3000]]);
  const grouped = gifiCodes(accounts.map((a) => ({ ...a, gifi_override: null })), new Map(), lines);
  assert.deepEqual(grouped.codes.filter(([c]) => c.startsWith("88")), [["8810", 3000]]);
  // Same-type override: net income and total assets do not move (D6).
  assert.equal(g.totals["9999"], grouped.totals["9999"]);
  assert.equal(g.totals["2599"], grouped.totals["2599"]);
});

test("T2: an overdrawn account flips to its pair (2600) on both sides", () => {
  const rows = matchRows([A("b1", "10200", "Overdrawn dummy", "1002.00", -500)], new Map(), lines, new Set());
  assert.deepEqual(rows.map((r) => [r.code, r.cents]), [["2600", -50000]]);
});

test("T2: the ties line, to the cent; a failing tie shows the difference", () => {
  const ok = tieItems({ ni_chart: 18250, ni_gifi: 18250, assets_chart: 64310, assets_gifi: 64310 });
  assert.deepEqual(ok.map((t) => [t.label, t.code, t.ok]), [["net income", "9999", true], ["total assets", "2599", true]]);
  const bad = tieItems({ ni_chart: 18760, ni_gifi: 20000, assets_chart: 64310.01, assets_gifi: 64310 });
  assert.deepEqual(bad.map((t) => [t.ok, t.diff]), [[false, -124000], [false, 1]]);
});

test("step 8 papers: Match accounts to GIFI first on bank-statement files only (D7)", () => {
  const base = { full: true, shareholders: false, ownerPaid: false, gst: false };
  assert.deepEqual(stepPapers("t2", { ...base, bank: true }).map((p) => p.name), ["Match accounts to GIFI", "GIFI file", "Tax workpaper", "T2 tie-out"]);
  assert.deepEqual(stepPapers("t2", { ...base, bank: false }).map((p) => p.key), ["gifi", "taxwp", "tie"]);
});

test("T6: the old matching address opens step 8 on a bank file, step 4 on a trial balance file", () => {
  assert.equal(stepFromLegacy("tb", "accounts", "statements"), "t2");
  assert.equal(stepFromLegacy("tb", "accounts", "client_software"), "code");
});
