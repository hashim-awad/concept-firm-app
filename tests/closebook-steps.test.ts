// Run with: npm test
// The Closebook file page's 10 steps (Hashim, Nov 13 and 14, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileSteps, stepFromLegacy, stepPapers, type StepFacts } from "../src/lib/closebook/steps.ts";
import type { CbDoc } from "../src/lib/closebook/files.ts";

const doc = (code: string, phase: CbDoc["phase"], status: CbDoc["status"] = "open"): CbDoc =>
  ({ code, phase, title: code, detail: "", sort_order: 1, status, prepared_by: null, prepared_at: null, reviewed_by: null, reviewed_at: null });
const planning = (st: CbDoc["status"]) => ["P1", "P2", "P3", "P4", "P5"].map((c) => doc(c, "planning", st));
const facts = (x: Partial<StepFacts>): StepFacts => ({ books: "statements", docs: planning("open"), statements: 0, imported: false, accounts: 0, unmatched: 0, waiting: 0, entries: 0,
  people: { preparer: "Pat", reviewer: "Sam" }, ...x });
const signed = { opening: { signed: true, entered: true } };

test("a new file opens on step 1; ten steps in order", () => {
  const r = fileSteps(facts({}));
  assert.equal(r.current, "setup");
  assert.deepEqual(r.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(r.steps.map((x) => x.name), ["Set up", "Opening balances", "Banking", "Code transactions", "Adjustments", "GIFI mapping", "Review", "Tax returns", "Statements", "Deliver and lock"]);
});

test("bank files: step 2 waits for the preparer's sign-off on last year's balance sheet", () => {
  const a = fileSteps(facts({ statements: 2, bankGaps: "" }));
  assert.equal(a.current, "opening");
  assert.match(a.next, /^Enter last year's closing balance sheet/);
  const b = fileSteps(facts({ statements: 2, bankGaps: "", opening: { signed: false, entered: true } }));
  assert.match(b.next, /sign as preparer when no total is highlighted/);
  // Round 8b: the sub-line says what the step is; its state is the sign-off (Prepared by), not a word here.
  assert.equal(b.steps[1].note, "Last year's balance sheet");
});

test("statements in and step 2 signed before the setup is signed: the file moves on to coding", () => {
  const r = fileSteps(facts({ statements: 2, ...signed }));
  assert.equal(r.current, "code");
  assert.equal(r.steps[2].state, "done");
  assert.equal(r.steps[0].state, "open");
});

test("imported trial balance: step 4 is Match accounts to GIFI, done when every account is matched", () => {
  const tb = { books: "concept_qbo", imported: true, accounts: 10 };
  const a = fileSteps(facts({ ...tb, unmatched: 2, waiting: 1 }));
  assert.equal(a.steps[3].name, "Match accounts to GIFI");
  assert.equal(a.current, "code");
  assert.match(a.next, /Match 3 accounts/);
  const b = fileSteps(facts({ ...tb, docs: planning("signed") }));
  assert.equal(b.current, "entries");
  assert.equal(b.steps[0].state, "done");
});

test("bank files: step 3 stays current while months are missing; the banner gives the count only", () => {
  const r = fileSteps(facts({ statements: 3, bankGaps: "1 month missing", ...signed }));
  assert.equal(r.current, "records");
  assert.match(r.next, /^1 month missing: they show on each account below/);
  assert.equal(r.steps[2].note, "Months still missing");
});

test("bank files: step 4 counts the Pending lines, then the reviewer's and the client's", () => {
  const a = fileSteps(facts({ statements: 1, bankGaps: "", ...signed, coding: { lines: 36, open: 30, reviewer: 2, ask: 1 } }));
  assert.equal(a.current, "code");
  assert.match(a.next, /Post 30 pending lines: each needs an account and a sales tax code \(1 asked of the client\)/);
  const b = fileSteps(facts({ statements: 1, bankGaps: "", ...signed, coding: { lines: 36, open: 0, reviewer: 2, ask: 0 } }));
  assert.match(b.next, /2 lines waiting for the reviewer/);
  const c = fileSteps(facts({ statements: 1, bankGaps: "", ...signed, coding: { lines: 36, open: 0, reviewer: 0, ask: 0 } }));
  assert.equal(c.current, "entries");
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

// Round 5 (Hashim, Nov 21, 2026): an account whose type differs from its GIFI line holds step 4 open and
// shows on step 7 until the reviewer decides.
test("open type flags hold the matching step and show on step 7", () => {
  const r = fileSteps(facts({ books: "client_software", docs: planning("signed"), imported: true, accounts: 5, typeFlags: 2 }));
  assert.equal(r.current, "code");
  assert.equal(r.steps.find((s) => s.key === "code")!.note, "2 checks for the reviewer");
  assert.equal(r.steps.find((s) => s.key === "mapping")!.note, "2 checks for the reviewer");
  assert.match(r.next, /^2 accounts on a GIFI line of another type, or with a balance on the wrong side of it: for the reviewer/);
  const ok = fileSteps(facts({ books: "client_software", docs: planning("signed"), imported: true, accounts: 5, typeFlags: 0 }));
  assert.equal(ok.steps.find((s) => s.key === "code")!.state, "done");
});

// Round 15b (Hashim): each step's working papers; a paper shows only when it applies.
test("step papers show only when they apply", () => {
  const base = { full: true, shareholders: false, ownerPaid: false, gst: false };
  assert.deepEqual(stepPapers("entries", base).map((p) => p.key), ["revenue"]);
  // Piece 4b (approved change): the Expenses paid personally paper is retired; the setup answer adds nothing.
  assert.deepEqual(stepPapers("entries", { ...base, shareholders: true, ownerPaid: true }).map((p) => p.name), ["Revenue check", "Shareholder loans"]);
  assert.deepEqual(stepPapers("entries", { ...base, full: false, shareholders: true }).map((p) => p.key), ["sh"]);
  assert.deepEqual(stepPapers("t2", base).map((p) => p.name), ["GIFI file", "Tax workpaper", "T2 tie-out"]);
  assert.deepEqual(stepPapers("t2", { ...base, gst: true }).map((p) => p.key), ["gifi", "taxwp", "tie", "gst"]);
  assert.deepEqual(stepPapers("statements", base).map((p) => p.name), ["Package", "MAL signing"]);
  assert.deepEqual(stepPapers("lock", base).map((p) => p.name), ["Checklist", "Client email", "Documents", "Filing and lock"]);
  assert.deepEqual(stepPapers("setup", base).map((p) => p.name), ["Setup questions", "Acceptance"]);
  assert.deepEqual(stepPapers("review", base), []);
});
