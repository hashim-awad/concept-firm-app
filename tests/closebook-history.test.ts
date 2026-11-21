// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

// CB2-0 step 2 (rule 14): History > "Changed after sign-off" lists each change under the steps it affects, only after
// that step's latest sign-off; sign-off rows are not changes.
test("CB2-0: changed after sign-off, grouped by the steps a change affects", async () => {
  const { affectedSteps, changedAfterSignoff } = await import("../src/lib/closebook/history.ts");
  assert.deepEqual(affectedSteps("entries"), ["entries", "compare", "t2", "statements"]);
  assert.deepEqual(affectedSteps("t2"), ["t2", "statements"]);
  assert.deepEqual(affectedSteps("setup"), ["setup"]);
  const row = (at: string, step: string, action = "entry_created", detail = "Entry 2026-017 added") =>
    ({ at, who: "Dummy Staff", action, step, detail, ref: "", reason: "", old: "", new: "", erased: false });
  const rows = [row("2026-11-03T10:00:00Z", "entries"), row("2026-11-01T09:00:00Z", "entries", "entry_created", "Entry 2026-001 added"),
    row("2026-11-03T11:00:00Z", "setup", "changed", "Setup saved"), row("2026-11-03T12:00:00Z", "entries", "reviewed", "")];
  const signs = { entries: { prepared_at: "2026-11-01T12:00:00Z", reviewed_at: "2026-11-02T12:00:00Z" }, compare: { prepared_at: "2026-11-02T12:00:00Z" },
    t2: { prepared_at: "2026-11-04T12:00:00Z" }, setup: undefined };
  const g = changedAfterSignoff(rows, signs, ["setup", "opening", "records", "code", "entries", "compare", "review", "t2", "statements", "lock"]);
  // The new entry is after step 5's and step 6's sign-offs; step 8 was signed later; step 9 and step 1 are not signed.
  assert.deepEqual(g.map((x) => [x.step, x.rows.map((r) => r.detail)]), [["entries", ["Entry 2026-017 added"]], ["compare", ["Entry 2026-017 added"]]]);
});
