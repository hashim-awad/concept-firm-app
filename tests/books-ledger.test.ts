// Run with: npm test
// CB2-1 (Hashim, Nov 21, 2026): a client's books, continuous like a QuickBooks Online company. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Posting } from "../src/lib/closebook/tb-build.ts";
import { statements, trialBalance, type LineInfo, type RepAccount } from "../src/lib/closebook/reports.ts";
import { buildBooks, fiscalStart, identOf, rangeInput, type AcctType, type YearIn } from "../src/lib/books/ledger.ts";

const acct = (key: string, number: string, name: string, line_no: string, lastCents = 0): RepAccount => ({ key, number, name, line_no, lastCents });
const types: Record<string, AcctType> = { "10000": "Asset", "21000": "Liability", "30000": "Equity", "31000": "Equity", "40200": "Revenue", "65100": "Expense" };
const typeOf = (i: string) => types[i];
const lineType: Record<string, string> = { "1002.00": "Asset", "2620.00": "Liability", "3500.00": "Equity", "3600.00": "Equity", "8120.00": "Revenue", "8810.00": "Expense" };
const info = (l: string | null): LineInfo | null => (l && lineType[l] ? { type: lineType[l], sheet: lineType[l], sheetName: lineType[l] } : null);
const accounts = [acct("chart:10000", "10000", "Chequing", "1002.00"), acct("chart:21000", "21000", "Accounts payable", "2620.00"),
  acct("chart:30000", "30000", "Share capital", "3500.00"), acct("chart:31000", "31000", "Retained earnings", "3600.00"),
  acct("chart:40200", "40200", "Commission income", "8120.00"), acct("chart:65100", "65100", "Office expenses", "8810.00")];
const p = (key: string, cents: number, date: string, kind: Posting["kind"] = "bank", ref = "x"): Posting => ({ key, cents, date, kind, ref, label: "" });
const chart = new Map(accounts.map((a) => [identOf(a), { number: a.number, name: a.name, line_no: a.line_no }]));

// Year 1 opens with 100 of share capital in the bank; earns 1,000 and spends 300. Year 2 opens from the stored figures
// (the bank 800, capital 100, retained earnings 700, last year's T2) and earns 500.
const y1: YearIn = { fileId: "f1", yearStart: "2025-01-01", yearEnd: "2025-12-31", bankFile: true, accounts, entries: [], postings: [
  p("chart:10000", 10000, "2025-01-01", "opening"), p("chart:30000", -10000, "2025-01-01", "opening"),
  p("chart:10000", 100000, "2025-03-01"), p("chart:40200", -100000, "2025-03-01"),
  p("chart:65100", 30000, "2025-06-01"), p("chart:10000", -30000, "2025-06-01"),
] };
const y2 = (bankOpen: number): YearIn => ({ fileId: "f2", yearStart: "2026-01-01", yearEnd: "2026-12-31", bankFile: true, accounts, entries: [], postings: [
  p("chart:10000", bankOpen, "2026-01-01", "opening"), p("chart:30000", -10000, "2026-01-01", "opening"), p("chart:31000", -(bankOpen - 10000), "2026-01-01", "opening"),
  p("chart:10000", 50000, "2026-02-01"), p("chart:40200", -50000, "2026-02-01"),
] });

test("Part 4.2: last year's net income is in retained earnings at the start of this year, with no closing entry", () => {
  const books = buildBooks([y1, y2(80000)], typeOf, "31000");
  // No difference: year 2's stored opening equals year 1's closing, so only year 1 has an opening entry.
  assert.deepEqual(books.generated.map((g) => g.origin), ["opening_balances"]);
  assert.equal(books.generated[0].date, "2024-12-31");
  // No entry closes income: the only postings are the opening, the bank lines and nothing else.
  assert.ok(!books.postings.some((x) => x.label.toLowerCase().includes("clos")));
  const r = rangeInput(books, "2026-01-01", "2026-12-31", typeOf, "31000", chart);
  const tb = new Map(trialBalance(r.accounts, r.postings).map((t) => [t.key, t]));
  assert.equal(tb.get("31000")?.opening, -70000);   // last year's net income: 1,000 less 300
  assert.equal(tb.get("40200")?.opening, 0);        // revenue starts the year at nil
  assert.equal(tb.get("40200")?.final, -50000);
  assert.equal(tb.get("10000")?.final, 130000);
  // Prior column: last year's figures from the books.
  assert.equal(tb.get("40200")?.last, -100000);
  assert.equal(tb.get("31000")?.last, 0);
  const s = statements(trialBalance(r.accounts, r.postings), info);
  assert.equal(s.pl.net.now, 50000);
  assert.equal(s.bs.assets.now, s.bs.totalLE.now);
});

test("a later year whose stored opening differs from last year's closing gets one difference entry on its first day", () => {
  const books = buildBooks([y1, y2(85000)], typeOf, "31000");
  const diff = books.generated.find((g) => g.origin === "opening_difference");
  assert.ok(diff);
  assert.equal(diff.date, "2026-01-01");
  assert.equal(diff.memo, "Opening difference to last year's closing balances");
  assert.deepEqual(Object.fromEntries(diff.lines.map((l) => [l.ident, l.cents])), { "10000": 5000, "31000": -5000 });
  // Last year's closing figures are untouched; this year's equal the stored ones.
  const last = rangeInput(books, "2025-01-01", "2025-12-31", typeOf, "31000", chart);
  assert.equal(trialBalance(last.accounts, last.postings).find((t) => t.key === "10000")?.final, 80000);
  const now = rangeInput(books, "2026-01-01", "2026-12-31", typeOf, "31000", chart);
  const bank = trialBalance(now.accounts, now.postings).find((t) => t.key === "10000")!;
  assert.equal(bank.final, 135000);
  // The difference counts in Prelim, like the opening entry, never in Adj's or Reclass (Hashim, Nov 21, 2026).
  assert.equal(bank.prelim, 135000);
  assert.equal(bank.adjust, 0);
  assert.equal(bank.reclass, 0);
});

test("a trial balance import is one entry at the year end, in Prelim, less the opening", () => {
  const tbAccounts = [acct("1000", "1000", "Bank", "1002.00", 20000), acct("3200", "3200", "Retained earnings", "3600.00", -15000),
    acct("4000", "4000", "Sales", "8120.00", -8000), acct("6000", "6000", "Rent", "8810.00", 3000)];
  const t: Record<string, AcctType> = { "1000": "Asset", "3200": "Equity", "4000": "Revenue", "6000": "Expense" };
  const y: YearIn = { fileId: "t1", yearStart: "2026-01-01", yearEnd: "2026-12-31", bankFile: false, accounts: tbAccounts, entries: [], postings: [
    p("1000", 31000, "2026-12-31", "import"), p("3200", -20000, "2026-12-31", "import"), p("4000", -16000, "2026-12-31", "import"), p("6000", 5000, "2026-12-31", "import"),
  ] };
  const books = buildBooks([y], (i) => t[i], "3200");
  const open = books.generated.find((g) => g.origin === "opening_balances")!;
  // Last year's income closes to retained earnings: 15,000 + 8,000 − 3,000 = 20,000.
  assert.deepEqual(Object.fromEntries(open.lines.map((l) => [l.ident, l.cents])), { "1000": 20000, "3200": -20000 });
  const imp = books.generated.find((g) => g.origin === "tb_import")!;
  assert.equal(imp.date, "2026-12-31");
  assert.equal(imp.memo, "Trial balance imported");
  const ch = new Map(tbAccounts.map((a) => [a.number, { number: a.number, name: a.name, line_no: a.line_no }]));
  const r = rangeInput(books, "2026-01-01", "2026-12-31", (i) => t[i], "3200", ch);
  const tb = new Map(trialBalance(r.accounts, r.postings).map((x) => [x.key, x]));
  assert.equal(tb.get("1000")?.final, 31000);
  assert.equal(tb.get("1000")?.prelim, 31000);
  assert.equal(tb.get("1000")?.adjust, 0);
  assert.equal(tb.get("4000")?.final, -16000);
});

test("a bank line dated outside its year posts in that year, as today's reports count it", () => {
  const y: YearIn = { ...y1, postings: [...y1.postings, p("chart:10000", 500, "2026-02-01"), p("chart:65100", -500, "2026-02-01")] };
  const books = buildBooks([y], typeOf, "31000");
  assert.ok(books.postings.filter((x) => x.cents === 500 || x.cents === -500).every((x) => x.date === "2025-12-31"));
});

test("the fiscal year of a date", () => {
  const books = buildBooks([y1, y2(80000)], typeOf, "31000");
  assert.equal(fiscalStart(books, "2026-05-01"), "2026-01-01");
  assert.equal(fiscalStart(books, "2027-03-01"), "2027-01-01");
});
