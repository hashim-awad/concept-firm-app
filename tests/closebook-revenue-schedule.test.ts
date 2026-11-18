// Run with: node --test tests/
// Piece 7 (Hashim, Nov 18, 2026, version 2): the revenue check is in step 5's list only once added; step 8 keeps the
// GST/HST return paper for every full file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepPapers } from "../src/lib/closebook/steps.ts";

const facts = { full: true, shareholders: false, ownerPaid: false, gst: false };
const keys = (xs: { key: string }[]) => xs.map((x) => x.key).join(",");

test("a full file with no revenue check added: step 5 does not list it", () => {
  assert.equal(keys(stepPapers("entries", { ...facts, revenue: false })), "");
  assert.equal(keys(stepPapers("entries", { ...facts, shareholders: true, revenue: false })), "sh");
});

test("once added, step 5 lists it first, as before", () => {
  assert.equal(keys(stepPapers("entries", { ...facts, revenue: true })), "revenue");
  assert.equal(keys(stepPapers("entries", { ...facts, shareholders: true, revenue: true })), "revenue,sh");
});

test("a monthly file never lists it", () => {
  assert.equal(keys(stepPapers("entries", { ...facts, full: false, revenue: true })), "");
});
