// Run with: npm test
// Closebook file rules (Phase 3 batch, section 2): deadline, phases in order, the "Next:" line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPhase, fileBy, nextLine, progress, type CbDoc } from "../src/lib/closebook/files.ts";

test("File by: six months after the year-end, month-end to month-end", () => {
  assert.equal(fileBy("2026-12-31"), "2027-06-30");
  assert.equal(fileBy("2026-08-31"), "2027-02-28");
  assert.equal(fileBy("2027-08-31"), "2028-02-29", "leap year");
  assert.equal(fileBy("2026-06-30"), "2026-12-31");
  assert.equal(fileBy("2026-03-15"), "2026-09-15");
});

const doc = (code: string, phase: CbDoc["phase"], sort: number, status: CbDoc["status"] = "open"): CbDoc =>
  ({ code, phase, title: code === "F1" ? "Build the trial balance" : `Doc ${code}`, detail: "", sort_order: sort, status, prepared_by: null, prepared_at: null, reviewed_by: null, reviewed_at: null });

test("phases open in order; the Next line names the action and the person", () => {
  const docs = [doc("P1", "planning", 10, "signed"), doc("P2", "planning", 20, "signed"), doc("F1", "fieldwork", 110), doc("F2", "fieldwork", 120), doc("C1", "conclusion", 210)];
  assert.equal(currentPhase(docs), "fieldwork");
  assert.deepEqual(progress(docs, "planning"), { signed: 2, total: 2 });
  assert.deepEqual(nextLine(docs, { preparer: "Asmaa", reviewer: "Hashim" }), { text: "Next: build the trial balance (Asmaa)", code: "F1" });
  docs[2].status = "prepared";
  assert.equal(nextLine(docs, { preparer: "Asmaa", reviewer: "Hashim" }).text, "Next: reviewer signs \u201cBuild the trial balance\u201d (Hashim)");
  assert.equal(nextLine(docs, { preparer: "Asmaa", reviewer: "Hashim" }, 2).text, "Next: reviewer, 2 review notes open");
  assert.equal(currentPhase(docs.map((d) => ({ ...d, status: "signed" as const }))), "locked");
});
