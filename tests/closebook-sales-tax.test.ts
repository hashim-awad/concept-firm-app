// Run with: npm test
// Sales tax on bank and card lines (Hashim, Nov 13, 2026). Rates here are test data in the shape of
// Settings, as Hashim listed them; the app reads them from the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTaxCode, splitLine, type TaxCode } from "../src/lib/closebook/sales-tax.ts";

const g = (rate: number, recoverable = true) => ({ name: "GST", rate, recoverable, liability: "gst_hst" as const });
const HST_ON: TaxCode = { code: "HST_ON", name: "HST ON", parts: [g(0.13)] };
const MEALS_HST_50: TaxCode = { code: "MEALS_HST_50", name: "Meals HST 50", parts: [{ ...g(0.065), name: "Meals HST ITC" }, { ...g(0.065, false), name: "Meals HST NoITC" }] };
const MEALS_GST_50: TaxCode = { code: "MEALS_GST_50", name: "Meals GST 50", parts: [g(0.025), g(0.025, false)] };
const GST_PST_BC: TaxCode = { code: "GST_PST_BC", name: "GST/PST BC", parts: [g(0.05), { name: "PST BC", rate: 0.07, recoverable: false, liability: "pst" }] };
const reg = { registered: true, quick: false };

test("the worked examples: ITC + expense = the bank line", () => {
  const on = splitLine(11300, MEALS_HST_50, "purchase", reg);
  assert.deepEqual([on.netCents, on.itcCents, on.expenseTaxCents], [10000, 650, 650]);       // expense 106.50
  const bc = splitLine(10500, MEALS_GST_50, "purchase", reg);
  assert.deepEqual([bc.netCents, bc.itcCents, bc.expenseTaxCents], [10000, 250, 250]);       // expense 102.50
  const pst = splitLine(11200, GST_PST_BC, "purchase", reg);
  assert.deepEqual([pst.netCents, pst.itcCents, pst.expenseTaxCents], [10000, 500, 700]);    // expense 107.00
  const hst = splitLine(11300, HST_ON, "purchase", reg);
  assert.deepEqual([hst.netCents, hst.itcCents, hst.expenseTaxCents], [10000, 1300, 0]);
  for (const s of [on, bc, pst, hst]) assert.equal(s.netCents + s.itcCents + s.expenseTaxCents > 0, true);
});

test("rounding: the parts always add up to the line", () => {
  const s = splitLine(4938, MEALS_HST_50, "purchase", reg);
  assert.equal(s.netCents + s.itcCents + s.expenseTaxCents, 4938);
  const r = splitLine(-2533, HST_ON, "purchase", reg); // a refund
  assert.equal(r.netCents + r.itcCents, -2533);
});

test("quick method: no ITC on operating expenses, meals included; capital still claims", () => {
  const q = { registered: true, quick: true };
  assert.equal(splitLine(11300, MEALS_HST_50, "purchase", q).itcCents, 0);
  assert.equal(splitLine(11300, HST_ON, "purchase", q).expenseTaxCents, 1300);
  assert.equal(splitLine(11300, HST_ON, "purchase", q, true).itcCents, 1300);
});

test("not registered: no split; sales split GST and PST to their own accounts", () => {
  assert.deepEqual(splitLine(11300, HST_ON, "purchase", { registered: false, quick: false }).netCents, 11300);
  const sale = splitLine(11200, GST_PST_BC, "sale", reg);
  assert.deepEqual([sale.netCents, sale.gstCollectedCents, sale.pstCollectedCents], [10000, 500, 700]);
});

test("defaults by province: meals to the group code; Check has none", () => {
  assert.equal(defaultTaxCode("GST/HST", "ON", "60200"), "MEALS_HST_50");
  assert.equal(defaultTaxCode("GST/HST", "BC", "60200"), "MEALS_GST_50");
  assert.equal(defaultTaxCode("GST/HST", "ON", "6510"), "HST_ON");
  assert.equal(defaultTaxCode("GST/HST", "AB", "6510"), "GST");
  assert.equal(defaultTaxCode("Check", "ON", "4050"), null);
  assert.equal(defaultTaxCode("None", "ON", "6900"), "OUT_OF_SCOPE");
});
