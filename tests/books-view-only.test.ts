// Run with: npm test
// CB2-1 PR B: opening balances, opening difference and trial balance import entries are view-only in Books until the switch-over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { entryActions, VIEW_ONLY_TEXT } from "../src/lib/books/view-only.ts";

test("the three opening entries (saved or worked out) have no Save, Reverse, Copy or Delete; ordinary entries keep them", () => {
  for (const e of [{ origin: "opening_balances" }, { origin: "opening_difference" }, { origin: "tb_import" }, { generated: true, origin: null }]) {
    const a = entryActions(e, true);
    assert.deepEqual([a.viewOnly, a.readOnly, a.save, a.reverse, a.copy, a.delete], [true, true, false, false, false, false]);
  }
  for (const origin of [null, "", "schedule", "expenses_personal"]) {
    const a = entryActions({ origin }, true);
    assert.deepEqual([a.viewOnly, a.readOnly, a.save, a.reverse, a.copy, a.delete], [false, false, true, true, true, true]);
  }
  assert.equal(entryActions({ origin: null }, false).save, false);   // View right only: nothing changes
  assert.equal(VIEW_ONLY_TEXT, "Change this entry in the old Closebook until the switch-over.");
});
