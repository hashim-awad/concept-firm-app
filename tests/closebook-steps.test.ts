// Run with: npm test
// The Closebook file page's 9 steps (Hashim, Nov 13, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileSteps, stepFromLegacy, type StepFacts } from "../src/lib/closebook/steps.ts";
import type { CbDoc } from "../src/lib/closebook/files.ts";

const doc = (code: string, phase: CbDoc["phase"], status: CbDoc["status"] = "open"): CbDoc =>
  ({ code, phase, title: code, detail: "", sort_order: 1, status, prepared_by: null, prepared_at: null, reviewed_by: null, reviewed_at: null });
const planning = (st: CbDoc["status"]) => ["P1", "P2", "P3", "P4", "P5"].map((c) => doc(c, "planning", st));
const facts = (x: Partial<StepFacts>): StepFacts => ({ books: "statements", docs: planning("open"), statements: 0, imported: false, accounts: 0, unmatched: 0, waiting: 0, entries: 0,
  people: { preparer: "Pat", reviewer: "Sam" }, ...x });

test("a new file opens on step 1; nine steps in order", () => {
  const r = fileSteps(facts({}));
  assert.equal(r.current, "setup");
  assert.deepEqual(r.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(r.next, /start getting the records now/);
});

test("statements in before the setup is signed: the file moves on to coding", () => {
  const r = fileSteps(facts({ statements: 2 }));
  assert.equal(r.current, "code");
  assert.equal(r.steps[1].state, "done");
  assert.equal(r.steps[0].state, "open");
  assert.equal(r.steps[2].name, "Code the transactions");
});

test("imported trial balance: step 3 is Match accounts to GIFI, done when every account is matched", () => {
  const tb = { books: "concept_qbo", imported: true, accounts: 10 };
  const a = fileSteps(facts({ ...tb, unmatched: 2, waiting: 1 }));
  assert.equal(a.steps[2].name, "Match accounts to GIFI");
  assert.equal(a.current, "code");
  assert.match(a.next, /Match 3 accounts/);
  const b = fileSteps(facts({ ...tb, docs: planning("signed") }));
  assert.equal(b.current, "entries");
  assert.equal(b.steps[0].state, "done");
});

test("bank files: step 2 stays current while months are missing, and says which", () => {
  const r = fileSteps(facts({ statements: 3, bankGaps: "Chequing: Mar" }));
  assert.equal(r.current, "records");
  assert.match(r.next, /Still missing: Chequing: Mar/);
  assert.equal(r.steps[1].note, "Months still missing");
});

test("bank files: step 3 counts the lines to code, then the reviewer's and the client's", () => {
  const a = fileSteps(facts({ statements: 1, bankGaps: "", coding: { lines: 36, open: 30, reviewer: 2, ask: 1 } }));
  assert.equal(a.current, "code");
  assert.match(a.next, /Code 30 lines/);
  const b = fileSteps(facts({ statements: 1, bankGaps: "", coding: { lines: 36, open: 0, reviewer: 2, ask: 0 } }));
  assert.match(b.next, /2 lines waiting for the reviewer/);
  const c = fileSteps(facts({ statements: 1, bankGaps: "", coding: { lines: 36, open: 0, reviewer: 0, ask: 0 } }));
  assert.equal(c.current, "entries");
});

test("bank files: step 2 waits for the opening balances to clear", () => {
  const r = fileSteps(facts({ statements: 2, bankGaps: "", openingIssue: "enter last year's balances." }));
  assert.equal(r.current, "records");
  assert.match(r.next, /^Opening balances: enter last year/);
});

test("old links land on the right step", () => {
  assert.equal(stepFromLegacy("tb", "transactions", "statements"), "records");
  assert.equal(stepFromLegacy("tb", "gifi", "statements"), "t2");
  assert.equal(stepFromLegacy("tb", "lead", "concept_qbo"), "review");
  assert.equal(stepFromLegacy("tb", "accounts", "concept_qbo"), "code");
  assert.equal(stepFromLegacy("tb", "attention", "statements"), "mapping");
  assert.equal(stepFromLegacy("entries", undefined, "statements"), "entries");
  assert.equal(stepFromLegacy(undefined, undefined, "statements"), null);
});
