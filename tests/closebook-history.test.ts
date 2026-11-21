// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

// CB2-0 step 2 (rule 14): History > "Changed after sign-off" lists each change under the steps it affects, only after
// that step's latest sign-off; sign-off rows are not changes.
test("CB2-0: changed after sign-off, grouped by the steps a change affects", async () => {
  const { affectedSteps, changedAfterSignoff } = await import("../src/lib/closebook/history.ts");
  assert.deepEqual(affectedSteps("entries"), ["entries", "compare", "review", "t2", "statements", "lock", "mal"]);
  assert.deepEqual(affectedSteps("t2"), ["t2", "review", "statements", "lock", "mal"]);
  assert.deepEqual(affectedSteps("setup"), ["setup", "mal"]);
  const row = (at: string, step: string, action = "entry_created", detail = "Entry 2026-017 added") =>
    ({ at, who: "Dummy Staff", action, step, detail, ref: "", reason: "", old: "", new: "", erased: false });
  const rows = [row("2026-11-03T10:00:00Z", "entries"), row("2026-11-01T09:00:00Z", "entries", "entry_created", "Entry 2026-001 added"),
    row("2026-11-03T11:00:00Z", "setup", "changed", "Setup saved"), row("2026-11-03T12:00:00Z", "entries", "reviewed", "")];
  const signs = { entries: { prepared_at: "2026-11-01T12:00:00Z", reviewed_at: "2026-11-02T12:00:00Z" }, compare: { prepared_at: "2026-11-02T12:00:00Z" },
    t2: { prepared_at: "2026-11-04T12:00:00Z" }, setup: undefined };
  const g = changedAfterSignoff(rows, signs, ["setup", "opening", "records", "code", "entries", "compare", "review", "t2", "statements", "lock"]);
  // The new entry is after step 5's and step 6's sign-offs; step 8 was signed later; step 9 and step 1 are not signed.
  // It shows once, under step 5, and names step 6 as also affected.
  assert.deepEqual(g.map((x) => [x.step, x.rows.map((r) => [r.detail, r.also])]), [["entries", [["Entry 2026-017 added", ["compare"]]]]]);
  // After the MAL was signed: listed under the first affected signed step, with "mal" in also; alone when no step is signed.
  const m = changedAfterSignoff([row("2026-11-05T10:00:00Z", "setup", "changed", "Setup saved")], { mal: { reviewed_at: "2026-11-04T00:00:00Z" } }, ["setup", "mal"]);
  assert.deepEqual(m.map((x) => [x.step, x.rows.length]), [["mal", 1]]);
});
