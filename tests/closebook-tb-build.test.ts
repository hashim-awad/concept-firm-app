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
  ["1000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }], ["2200", { name: "Credit card", account_type: "Liability", line_no: "2707.00" }],
  ["2150", { name: "GST/HST payable", account_type: "Liability", line_no: "2680.00" }], ["4020", { name: "Commission income", account_type: "Revenue", line_no: "8120.00" }],
  ["6020", { name: "Meals and entertainment", account_type: "Expense", line_no: "8523.00" }], ["6510", { name: "Office expenses", account_type: "Expense", line_no: "8810.00" }],
]);
const ctx = { registered: true, quick: false };
const sum = (rows: { cents: number }[]) => rows.reduce((n, r) => n + r.cents, 0);
const get = (rows: { key: string; cents: number }[], key: string) => rows.find((r) => r.key === key)?.cents ?? 0;

test("a bank account: commission in, meals out, all balanced", () => {
  const rows = buildTrialBalance([{ id: "b", name: "TD chequing", kind: "bank", chart: "1000", openingCents: 500000 }], [
    { account_id: "b", cents: 113000, status: "done", chart_account: "4020", tax_code: "HST_ON" },     // a commission deposit
    { account_id: "b", cents: -11300, status: "done", chart_account: "6020", tax_code: "MEALS_HST_50" },
  ], chart, codes, ctx);
  assert.equal(sum(rows), 0);
  assert.equal(get(rows, "chart:1000"), 500000 + 113000 - 11300);
  assert.equal(get(rows, "chart:4020"), -100000);
  assert.equal(get(rows, "chart:6020"), 10650);                // net 100.00 + half the HST 6.50
  assert.equal(get(rows, "chart:2150"), -13000 + 650);         // HST collected less the meals ITC
  assert.equal(get(rows, OPENING), -500000);
});

test("a card: a charge is a credit; a payment from chequing nets on the card line", () => {
  const rows = buildTrialBalance([
    { id: "c", name: "Visa", kind: "card", chart: "2200", openingCents: 100000 },
    { id: "b", name: "Chequing", kind: "bank", chart: "1000", openingCents: 0 },
  ], [
    { account_id: "c", cents: 11300, status: "done", chart_account: "6510", tax_code: "HST_ON" },     // a charge
    { account_id: "b", cents: -50000, status: "done", chart_account: "2200", tax_code: "OUT_OF_SCOPE" }, // paying the card
  ], chart, codes, ctx);
  assert.equal(sum(rows), 0);
  assert.equal(get(rows, "chart:2200"), -100000 - 11300 + 50000);
  assert.equal(get(rows, "chart:6510"), 10000);
  assert.equal(get(rows, "chart:2150"), 1300);
});

test("lines not yet coded, for the reviewer or the client sit in one holding account", () => {
  const rows = buildTrialBalance([{ id: "b", name: "Chequing", kind: "bank", chart: "1000", openingCents: 0 }], [
    { account_id: "b", cents: -2000, status: "new", chart_account: null, tax_code: null },
    { account_id: "b", cents: -3000, status: "reviewer", chart_account: "6020", tax_code: "HST_ON" },
    { account_id: "b", cents: -500, status: "ask_client", chart_account: null, tax_code: null },
  ], chart, codes, ctx);
  assert.equal(sum(rows), 0);
  assert.equal(get(rows, UNCODED), 5500);
  assert.equal(rows.find((r) => r.key === UNCODED)!.line_no, null);
});

test("two cards on the same chart account stay apart", () => {
  const rows = buildTrialBalance([
    { id: "v", name: "Visa 1234", kind: "card", chart: "2200", openingCents: 0 }, { id: "m", name: "Mastercard 9", kind: "card", chart: "2200", openingCents: 0 },
  ], [{ account_id: "v", cents: 1000, status: "new", chart_account: null, tax_code: null }], chart, codes, ctx);
  assert.deepEqual(rows.filter((r) => r.key.startsWith("bank:")).map((r) => r.name).sort(), ["Mastercard 9", "Visa 1234"]);
  assert.equal(sum(rows), 0);
});
