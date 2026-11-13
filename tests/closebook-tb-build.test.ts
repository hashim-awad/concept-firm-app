// Run with: npm test
// The trial balance built from coded bank and card lines (Hashim, Nov 13, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrialBalance, OPENING, UNCODED, type BuildChart } from "../src/lib/closebook/tb-build.ts";
import type { TaxCode } from "../src/lib/closebook/sales-tax.ts";

const g = (rate: number, recoverable = true) => ({ name: "GST", rate, recoverable, liability: "gst_hst" as const });
const codes = new Map<string, TaxCode>([
  ["HST_ON", { code: "HST_ON", name: "HST ON", parts: [g(0.13)] }],
  ["MEALS_HST_50", { code: "MEALS_HST_50", name: "Meals HST 50", parts: [g(0.065), g(0.065, false)] }],
  ["OUT_OF_SCOPE", { code: "OUT_OF_SCOPE", name: "Out of Scope", parts: [] }],
]);
const chart = new Map<string, BuildChart>([
  ["10000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }], ["22000", { name: "Credit card", account_type: "Liability", line_no: "2707.00" }],
  ["21500", { name: "GST/HST payable", account_type: "Liability", line_no: "2680.00" }], ["40200", { name: "Commission income", account_type: "Revenue", line_no: "8120.00" }],
  ["60200", { name: "Meals and entertainment", account_type: "Expense", line_no: "8523.00" }], ["65100", { name: "Office expenses", account_type: "Expense", line_no: "8810.00" }],
]);
const ctx = { registered: true, quick: false };
const sum = (rows: { cents: number }[]) => rows.reduce((n, r) => n + r.cents, 0);
const get = (rows: { key: string; cents: number }[], key: string) => rows.find((r) => r.key === key)?.cents ?? 0;

test("a bank account: commission in, meals out, all balanced", () => {
  const rows = buildTrialBalance([{ id: "b", name: "TD chequing", kind: "bank", chart: "10000", openingCents: 500000 }], [
    { account_id: "b", cents: 113000, status: "done", chart_account: "40200", tax_code: "HST_ON" },     // a commission deposit
    { account_id: "b", cents: -11300, status: "done", chart_account: "60200", tax_code: "MEALS_HST_50" },
  ], chart, codes, ctx);
  assert.equal(sum(rows), 0);
  assert.equal(get(rows, "chart:10000"), 500000 + 113000 - 11300);
  assert.equal(get(rows, "chart:40200"), -100000);
  assert.equal(get(rows, "chart:60200"), 10650);                // net 100.00 + half the HST 6.50
  assert.equal(get(rows, "chart:21500"), -13000 + 650);         // HST collected less the meals ITC
  assert.equal(get(rows, OPENING), -500000);
});

test("a card: a charge is a credit; a payment from chequing nets on the card line", () => {
  const rows = buildTrialBalance([
    { id: "c", name: "Visa", kind: "card", chart: "22000", openingCents: 100000 },
    { id: "b", name: "Chequing", kind: "bank", chart: "10000", openingCents: 0 },
  ], [
    { account_id: "c", cents: 11300, status: "done", chart_account: "65100", tax_code: "HST_ON" },     // a charge
    { account_id: "b", cents: -50000, status: "done", chart_account: "22000", tax_code: "OUT_OF_SCOPE" }, // paying the card
  ], chart, codes, ctx);
  assert.equal(sum(rows), 0);
  assert.equal(get(rows, "chart:22000"), -100000 - 11300 + 50000);
  assert.equal(get(rows, "chart:65100"), 10000);
  assert.equal(get(rows, "chart:21500"), 1300);
});

test("lines not yet coded, for the reviewer or the client sit in one holding account", () => {
  const rows = buildTrialBalance([{ id: "b", name: "Chequing", kind: "bank", chart: "10000", openingCents: 0 }], [
    { account_id: "b", cents: -2000, status: "new", chart_account: null, tax_code: null },
    { account_id: "b", cents: -3000, status: "reviewer", chart_account: "60200", tax_code: "HST_ON" },
    { account_id: "b", cents: -500, status: "ask_client", chart_account: null, tax_code: null },
  ], chart, codes, ctx);
  assert.equal(sum(rows), 0);
  assert.equal(get(rows, UNCODED), 5500);
  assert.equal(rows.find((r) => r.key === UNCODED)!.line_no, null);
});

test("two cards on the same chart account stay apart", () => {
  const rows = buildTrialBalance([
    { id: "v", name: "Visa 1234", kind: "card", chart: "22000", openingCents: 0 }, { id: "m", name: "Mastercard 9", kind: "card", chart: "22000", openingCents: 0 },
  ], [{ account_id: "v", cents: 1000, status: "new", chart_account: null, tax_code: null }], chart, codes, ctx);
  assert.deepEqual(rows.filter((r) => r.key.startsWith("bank:")).map((r) => r.name).sort(), ["Mastercard 9", "Visa 1234"]);
  assert.equal(sum(rows), 0);
});

test("opening balances by GIFI code: carried, checked, and cleared when both checks pass", () => {
  const ch = new Map(chart); ch.set("31000", { name: "Retained earnings", account_type: "Equity", line_no: "3600.00" });
  const opening = { reClosingCents: 250000, reStatedCents: 250000, lines: [
    { code: "1002", line_no: "1002.00", name: "Deposits", type: "Asset", debitCents: 270000 },
    { code: "2707", line_no: "2707.00", name: "Credit card loans", type: "Liability", debitCents: -10000 },
    { code: "3500", line_no: "3500.00", name: "Common shares", type: "Equity", debitCents: -10000 },
    { code: "3660", line_no: "3600.00", name: "Retained earnings", type: "Equity", debitCents: -100000 },
    { code: "3701", line_no: "3701.10", name: "Dividends", type: "Equity", debitCents: 200000 },
    { code: "8120", line_no: "8120.00", name: "Commission revenue", type: "Revenue", debitCents: -500000 },
    { code: "8810", line_no: "8810.00", name: "Office expenses", type: "Expense", debitCents: 150000 },
  ] };
  const banks = [{ id: "b", name: "Chequing", kind: "bank" as const, chart: "10000", openingCents: 270000 }, { id: "c", name: "Visa", kind: "card" as const, chart: "22000", openingCents: 10000 }];
  const ok = buildTrialBalance(banks, [], ch, codes, ctx, opening);
  assert.equal(sum(ok), 0);
  assert.equal(ok.find((r) => r.key === OPENING), undefined);                    // cleared
  assert.equal(get(ok, "chart:31000"), -250000);                                 // closing RE carried, on the chart account
  assert.equal(get(ok, "chart:40200"), 0);                                       // income statement closes
  assert.equal(ok.find((r) => r.key === "chart:40200")!.lastCents, -500000);     // but shows last year
  assert.equal(get(ok, "gifi:3500"), -10000);                                    // no chart account on 3500 here: keeps its GIFI code
  assert.equal(ok.find((r) => r.key === "chart:10000")!.lastCents, 270000);       // last year on the bank row
  // The statements open $50 off, and last year's 3849 was typed differently: both go to the reviewer.
  const off = buildTrialBalance([{ ...banks[0], openingCents: 275000 }, banks[1]], [], ch, codes, ctx, { ...opening, reStatedCents: 240000 });
  assert.equal(sum(off), 0);
  const o = off.find((r) => r.key === OPENING)!;
  assert.equal(o.cents, -5000);
  assert.match(o.reviewer!, /GIFI 1002: the first statements open at \$2,750\.00, last year closed at \$2,700\.00/);
  assert.match(o.reviewer!, /does not equal last year's 3849/);
});

// Round 2 items 7 and 8 (Hashim, Nov 16, 2026).
import { buildLedger } from "../src/lib/closebook/tb-build.ts";
const chart2 = new Map<string, BuildChart>([...chart, ["31000", { name: "Retained earnings", account_type: "Equity", line_no: "3600.00" }]]);
test("no 3660 line last year: retained earnings still post, so nothing sits unexplained in Opening balances to enter", () => {
  // A second-year company: 3660 blank, last year's 3849 = 345.73 (the net income). Cash 5,000 and a loan 4,654.27.
  const opening = { lines: [
    { code: "1002", line_no: "1002.00", name: "Cash", type: "Asset", debitCents: 500000 },
    { code: "2780", line_no: "2780.00", name: "Due to shareholder", type: "Liability", debitCents: -465427 },
  ], reClosingCents: 34573, reStatedCents: 34573 };
  const r = buildLedger([{ id: "b", name: "Chequing", kind: "bank", chart: "10000", openingCents: 500000 }], [], chart2, codes, ctx, opening, "2026-01-01");
  assert.equal(r.rows.reduce((n, x) => n + x.cents, 0), 0);
  assert.equal(get(r.rows, "chart:31000"), -34573);
  assert.equal(get(r.rows, OPENING), 0);
  assert.deepEqual(r.causes, []);
});
test("Opening balances to enter opens to its causes, which add up to the row", () => {
  const opening = { lines: [
    { code: "1002", line_no: "1002.00", name: "Cash", type: "Asset", debitCents: 500000 },
    { code: "1062", line_no: "1062.00", name: "Trade accounts receivable", type: "Asset", debitCents: 10000 },
    { code: "3660", line_no: "3600.00", name: "Retained earnings", type: "Equity", debitCents: -500000 },
  ], reClosingCents: 500000, reStatedCents: 500000 };
  const r = buildLedger([{ id: "b", name: "Chequing", kind: "bank", chart: "10000", openingCents: 20795744 }, { id: "c", name: "Visa", kind: "card", chart: "22000", openingCents: 100000 }],
    [], chart2, codes, ctx, opening, "2026-01-01");
  const row = get(r.rows, OPENING);
  assert.equal(r.causes.reduce((n, c) => n + c.cents, 0), row);
  assert.equal(r.causes.length, 3);   // GIFI 1002, GIFI 2707 and last year's balances out by 100.00
  assert.match(r.causes[2].text, /do not balance/);
  // GIFI 1062 has no standard chart account here: a 5-digit file account, never the GIFI code.
  const ar = r.rows.find((x) => x.key === "gifi:1062")!;
  assert.equal(ar.number, "19000");
  assert.equal(ar.name, "Trade accounts receivable");
});

import { entryLineTax } from "../src/lib/closebook/sales-tax.ts";
test("sales tax on an entry line: before tax, the ITC on top to GST/HST payable", () => {
  const hst = codes.get("HST_ON")!;
  // Home office 1,000.00 + HST: Dr 65100 1,000.00, Dr 21500 130.00, Cr 23000 1,130.00.
  assert.deepEqual(entryLineTax(100000, hst, "Expense", ctx), { toLine: 0, gstHst: 13000, pst: 0 });
  // Quick method: no ITC on an expense; the tax stays on the expense.
  assert.deepEqual(entryLineTax(100000, hst, "Expense", { registered: true, quick: true }), { toLine: 13000, gstHst: 0, pst: 0 });
  // A credit on revenue: tax collected, credit.
  assert.deepEqual(entryLineTax(-100000, hst, "Revenue", ctx), { toLine: 0, gstHst: -13000, pst: 0 });
  // Not registered: nothing.
  assert.deepEqual(entryLineTax(100000, hst, "Expense", { registered: false, quick: false }), { toLine: 0, gstHst: 0, pst: 0 });
});

import { netOfTax, planEntry } from "../src/lib/closebook/entry-form.ts";
test("a standard entry's amount includes the tax: 1,130.00 with HST gives 1,000.00 and 130.00", () => {
  const hst = codes.get("HST_ON")!;
  assert.equal(netOfTax(113000, hst, "Expense", ctx), 100000);
  for (const g of [1, 99, 5651, 123457, 999999]) { const n = netOfTax(g, hst, "Expense", ctx); assert.equal(n + Math.round(n * 0.13), g); }
  assert.equal(netOfTax(113000, null, "Expense", ctx), 113000);
});
test("entry totals count every amount typed; a missing account is flagged on its line", () => {
  const head = { kind: "AJE", reason: "correction", wpRef: "Home office schedule", memo: "Home office", reverse: false };
  const opts = new Map([["a", { value: "a", label: "26000 Shareholder loan", type: "Liability", line_no: "2781.10", group: "x" }]]);
  const blank = { desc: "", tax: "none", newName: "", newType: "", newLine: "" };
  const p = planEntry(head, [{ ...blank, acct: "", dr: "1,200.00", cr: "" }, { ...blank, acct: "a", dr: "", cr: "1,200.00" }], opts as never, new Map(), ctx);
  assert.equal(p.diff, 0);
  assert.deepEqual(p.problems, ["Line 1 needs an account."]);
});
test("a standard entry set to Choose on the line: the line's sales tax must be chosen (round 4 item 2)", () => {
  const head = { kind: "AJE", reason: "correction", wpRef: "Auto log", memo: "Auto", reverse: false };
  const opts = new Map([["a", { value: "a", label: "70600 Vehicle expenses", type: "Expense", line_no: "9281.00", group: "x" }], ["b", { value: "b", label: "23000 Due to shareholder 1", type: "Liability", line_no: "2781.10", group: "x" }]]);
  const blank = { desc: "", newName: "", newType: "", newLine: "" };
  const p = planEntry(head, [{ ...blank, acct: "a", dr: "500", cr: "", tax: "" }, { ...blank, acct: "b", dr: "", cr: "500", tax: "none" }], opts as never, new Map(), ctx);
  assert.deepEqual(p.problems, ["Line 1: choose the sales tax."]);
});

test("a card payment through Clearing nets to nil; one side alone needs a decision (round 4 item 3)", () => {
  const ch = new Map<string, BuildChart>([...chart, ["10900", { name: "Clearing", account_type: "Asset", line_no: null }]]);
  const banks = [{ id: "b", name: "Chequing", kind: "bank" as const, chart: "10000", openingCents: 0 }, { id: "c", name: "Visa", kind: "card" as const, chart: "22000", openingCents: 0 }];
  const out = { account_id: "b", cents: -50000, status: "done", chart_account: "10900", tax_code: "OUT_OF_SCOPE" };   // paid from the bank
  const pay = { account_id: "c", cents: -50000, status: "done", chart_account: "10900", tax_code: "OUT_OF_SCOPE" };  // the payment on the card
  const both = buildTrialBalance(banks, [out, pay], ch, codes, ctx);
  assert.equal(get(both, "chart:10900"), 0);
  assert.equal(get(both, "chart:10000"), -50000);
  assert.equal(get(both, "chart:22000"), 50000);
  const one = buildTrialBalance(banks, [out], ch, codes, ctx);
  assert.equal(get(one, "chart:10900"), 50000);
  assert.match(one.find((r) => r.key === "chart:10900")!.reviewer ?? "", /Clearing should be nil/);
});
