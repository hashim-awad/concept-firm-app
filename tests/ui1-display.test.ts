// Run with: node --test tests/
// Piece UI1 (Hashim, Nov 20, 2026): screen-only formats. Negative % in brackets, one "plus GST/HST" helper with cents,
// and the trial balance footer that names the column out of balance (approved wording). Dummy figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pctShow } from "../src/lib/closebook/pct-show.ts";
import { plusTax, quoteTotal } from "../src/lib/quotes.ts";
import { outLines } from "../src/lib/closebook/tb-footer.ts";

test("UI1: a negative % reads in brackets; other values pass through", () => {
  assert.equal(pctShow("-25.0%"), "(25.0%)");
  assert.equal(pctShow("76.7%"), "76.7%");
  assert.equal(pctShow("-0.0%"), "0.0%");
  for (const t of ["n/m", "n/a", "–"]) assert.equal(pctShow(t), t);
});

test("UI1: fees before tax read $X.XX plus GST/HST, always with cents", () => {
  assert.equal(plusTax(245000), "$2,450.00 plus GST/HST");
  assert.equal(plusTax(29900), "$299.00 plus GST/HST");
  assert.equal(quoteTotal(null), "");
  assert.equal(quoteTotal(185050), "$1,850.50 plus GST/HST");
});

test("UI1: the footer names each column out of balance and what to do", () => {
  assert.deepEqual(outLines([{ key: "prelim", label: "Prelim 2026", by: 2500 }, { key: "adjust", label: "Adjust", by: 0 }, { key: "final", label: "Final 2026", by: -2500 }]),
    ["Prelim 2026 out by 25.00: check the import", "Final 2026 out by 25.00: find the entry"]);
  assert.deepEqual(outLines([{ key: "final", label: "Final 2026", by: 0 }]), []);
});
