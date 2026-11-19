// Run with: npm test
// Round 21 (Hashim, Nov 15, 2026): step progress in the step list (ProFile, TurboTax): grey number not
// started, blue ring started, green tick signed by the preparer; "2 of 10 steps done".
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_PROGRESS, paperProgress, stepProgress, stepStarted, stepsDone, type ProgressFacts } from "../src/lib/closebook/step-progress.ts";
import { STEP_KEYS } from "../src/lib/closebook/steps.ts";

const f = (x: Partial<ProgressFacts>): ProgressFacts => ({ ...NO_PROGRESS, bank: true, ...x });

test("a new file: every step not started, none done", () => {
  for (const k of STEP_KEYS) assert.equal(stepProgress(k, f({})), "not_started", k);
  assert.equal(stepsDone(STEP_KEYS, f({})), 0);
});

test("step 1 starts with a setup answer or an acceptance record", () => {
  assert.equal(stepProgress("setup", f({ setupAnswers: 1 })), "started");
  assert.equal(stepProgress("setup", f({ acceptance: true })), "started");
  assert.equal(paperProgress("setup", "questions", f({ acceptance: true })), "not_started");
  assert.equal(paperProgress("setup", "acceptance", f({ acceptance: true })), "started");
});

test("step 2: typed lines or figures; a trial balance file starts with its import", () => {
  assert.equal(stepStarted("opening", f({ openingRows: 3 })), true);
  assert.equal(stepStarted("opening", f({ openingTyped: true })), true);
  assert.equal(stepStarted("opening", f({ imported: true })), false, "a bank file's import is not step 2");
  assert.equal(stepStarted("opening", f({ bank: false, imported: true })), true);
});

test("steps 3 and 4 follow how the books are kept", () => {
  assert.equal(stepStarted("records", f({ statements: 1 })), true);
  assert.equal(stepStarted("records", f({ bank: false, imported: true })), true);
  assert.equal(stepStarted("code", f({ coded: 0, matched: 5 })), false, "a bank file codes lines");
  assert.equal(stepStarted("code", f({ coded: 2 })), true);
  assert.equal(stepStarted("code", f({ bank: false, matched: 1 })), true);
});

test("steps 5 to 10 start from their own data", () => {
  assert.equal(stepStarted("entries", f({ entries: 1 })), true);
  assert.equal(stepStarted("entries", f({ revenueCheck: true })), true);
  assert.equal(stepStarted("entries", f({ shNotes: 1 })), true);
  assert.equal(stepStarted("compare", f({ compareWork: 1 })), true);
  assert.equal(stepStarted("review", f({ reviewNotes: 1 })), true);
  assert.equal(stepStarted("review", f({ reviewedSteps: 1 })), true);
  assert.equal(stepStarted("t2", f({ gifiExports: 1 })), true);
  assert.equal(stepStarted("t2", f({ t2Tieout: true })), true);
  assert.equal(stepStarted("statements", f({ malSent: true })), true);
  assert.equal(stepStarted("lock", f({ checklistAnswers: 2 })), true);
  assert.equal(stepStarted("lock", f({ closeTyped: true })), true);
});

test("signed by the preparer: green, with or without data; the reviewer alone does not make it green", () => {
  assert.equal(stepProgress("setup", f({ signs: { setup: { prepared: true, reviewed: false } } })), "signed");
  assert.equal(paperProgress("setup", "acceptance", f({ signs: { setup: { prepared: true, reviewed: false } } })), "signed");
  assert.equal(stepProgress("code", f({ coded: 4, signs: { code: { prepared: false, reviewed: false } } })), "started");
  // Step 7 has no preparer: it is done when the reviewer signs it.
  assert.equal(stepProgress("review", f({ signs: { review: { prepared: false, reviewed: true } } })), "signed");
});

test("the header counts steps signed by the preparer", () => {
  const signs = { setup: { prepared: true, reviewed: true }, opening: { prepared: true, reviewed: false }, records: { prepared: false, reviewed: false } };
  assert.equal(stepsDone(STEP_KEYS, f({ signs, statements: 3 })), 2);
});
