// Run with: node --test tests/
// Piece 10 (Hashim, Nov 19, 2026): step 6 "Compare to last year": the four lists, from the accounts and entries. Dummy figures (mock L).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLists, sortEvery, YEAR_QUESTIONS } from "../src/lib/closebook/compare.ts";
import type { Line } from "../src/lib/closebook/matching.ts";

const L = (line_no: string, name: string, line_type: string, lead_sheet: string | null, tax: string | null = null): Line =>
  ({ line_no, name, gifi_code: line_no.slice(0, 4), line_type, lead_sheet, statement_line: null, default_tax_code: tax, mappable: true, pair_line: null });
const lines = [L("8000.00", "Commission income", "Revenue", "10"), L("9281.00", "Vehicle expenses", "Expense", "40"), L("8810.00", "Office expenses", "Expense", "40"),
  L("8915.00", "Motor vehicle rentals", "Expense", "40"), L("8960.00", "Repairs and maintenance", "Expense", "40"), L("8690.00", "Insurance", "Expense", "40"),
  L("9990.00", "Current income taxes", "Expense", "40", "INCTAX"), L("1002.00", "Cash", "Asset", "A")];
const sheets = [{ code: "A", name: "Cash" }, { code: "10", name: "Revenue" }, { code: "40", name: "Expenses" }];
const A = (id: string, number: string, name: string, line_no: string | null, last: number, now: number) =>
  ({ id, account_key: `chart:${number}`, number, name, line_no, last_year: last, this_year: now });
const accounts = [
  A("a1", "40100", "Commission income", "8000.00", -215000, -300000),
  A("a2", "70600", "Vehicle expenses", "9281.00", 1900, 7345.13),
  A("a3", "65100", "Office expenses", "8810.00", 400, 6700),
  A("a4", "67300", "Vehicle lease", "8915.00", 0, 2400),
  A("a5", "68000", "Repairs and maintenance", "8960.00", 0, 0),
  A("a6", "62000", "Insurance", "8690.00", 500, 0),
  A("a7", "10100", "Chequing", "1002.00", 213000, 283554.87),
  A("a8", "90000", "Income taxes", "9990.00", 0, 0),
  { id: "a9", account_key: "chart:10900", number: "10900", name: "Clearing", line_no: null, last_year: 0, this_year: 0 },
  { id: "a10", account_key: "opening", number: "", name: "Opening balances to enter", line_no: null, last_year: 0, this_year: 0 },
];
// An AJE brings repairs to 265.49; a TJE books income tax of 9,000.00.
const entries = [{ kind: "AJE", lines: [{ account_id: "a5", amount: 265.49 }, { account_id: "a7", amount: -265.49 }] },
  { kind: "TJE", lines: [{ account_id: "a8", amount: 9000 }, { account_id: "a7", amount: -9000 }] }];

test("a) every line (CB2-0 step 5, rule 7): every lead sheet account with a balance either year, no flags, lead sheet order", () => {
  const r = compareLists(accounts, entries, lines, sheets);
  // In lead sheet order: Cash (A), Revenue (10), Expenses (40). Chequing after the two entries: 213,000.00 to 274,289.38.
  assert.deepEqual(r.every.map((x) => [x.number, x.lastCents, x.finalCents, x.changeCents]), [["10100", 21300000, 27428938, 6128938],
    ["40100", -21500000, -30000000, -8500000], ["70600", 190000, 734513, 544513], ["65100", 40000, 670000, 630000], ["67300", 0, 240000, 240000],
    ["68000", 0, 26549, 26549], ["62000", 50000, 0, -50000], ["90000", 0, 900000, 900000]]);
  assert.equal(r.every.find((x) => x.number === "40100")!.sheet, "Revenue");
  assert.equal("flagged" in r, false, "no flagged list");
});

test("a) sort by $ change and by % change; a line with nothing last year has no % and goes last", () => {
  const r = compareLists(accounts, entries, lines, sheets);
  assert.deepEqual(sortEvery(r.every, "dollar").map((x) => x.number).slice(0, 3), ["40100", "10100", "90000"]);
  const pct = sortEvery(r.every, "pct").map((x) => x.number);
  assert.deepEqual(pct.slice(0, 3), ["65100", "70600", "62000"], "1,575%, 287%, 100%");
  assert.deepEqual(pct.slice(-3).sort(), ["67300", "68000", "90000"]);
  assert.deepEqual(sortEvery(r.every, "sheet"), r.every, "the existing sort is kept");
});

test("b) new accounts: a balance this year after entries and none last year; c) not used this year", () => {
  const r = compareLists(accounts, entries, lines, sheets);
  assert.deepEqual(r.newAccounts.map((x) => [x.number, x.line, x.finalCents]), [["67300", "8915.00", 240000], ["68000", "8960.00", 26549], ["90000", "9990.00", 900000]]);
  assert.deepEqual(r.unused.map((x) => [x.number, x.line, x.lastCents]), [["62000", "8690.00", 50000]]);
  assert.equal([...r.newAccounts, ...r.unused].some((x) => x.key === "chart:10900" || x.key === "opening"), false, "system rows and Clearing are left out");
});

test("d) six questions, in the mock's order", () => {
  assert.deepEqual(YEAR_QUESTIONS.map(([k]) => k), ["assets", "loans", "shareholders", "related", "revenue", "equity"]);
  assert.equal(YEAR_QUESTIONS[3][1], "Related-party transactions (rent, management fees, loans)");
});
