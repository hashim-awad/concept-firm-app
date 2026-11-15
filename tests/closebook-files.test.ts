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

// New year-end file (Hashim, Nov 15, 2026): the year line and the data source.
import { DATA_SOURCE, MONTHLY_READY, addMonths, dataSourceLabel, dataSourceOf, fullYearStart, yearPeriod } from "../src/lib/closebook/files.ts";

test("year: a full year starts the day after the same date last year", () => {
  assert.equal(fullYearStart("2026-08-31"), "2025-09-01");
  assert.equal(fullYearStart("2026-12-31"), "2026-01-01");
  assert.equal(fullYearStart("2026-02-28"), "2025-03-01");
  assert.equal(fullYearStart("2028-02-29"), "2027-03-01");
  assert.equal(fullYearStart("2026-06-15"), "2025-06-16");
});

test("year: 12 months, a short first year, and months with days", () => {
  assert.deepEqual(yearPeriod("2025-09-01", "2026-08-31"), { months: 12, days: 0, full: true, text: "12 months" });
  assert.equal(yearPeriod("2026-01-01", "2026-12-31").text, "12 months");
  assert.deepEqual(yearPeriod("2026-05-15", "2026-12-31"), { months: 7, days: 17, full: false, text: "7 months 17 days" });
  assert.equal(yearPeriod("2026-06-01", "2026-12-31").text, "7 months");
  assert.equal(yearPeriod("2026-12-01", "2026-12-01").text, "1 day");
  assert.equal(yearPeriod("2027-01-01", "2026-12-31").text, "check the dates");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
});

test("data source: three choices, mapped to how the file works; Full and Monthly never shown", () => {
  assert.equal(DATA_SOURCE.client.file_type, "full");
  assert.equal(DATA_SOURCE.client.books, "client_software");
  assert.equal(DATA_SOURCE.statements.books, "statements");
  assert.equal(DATA_SOURCE.ours.file_type, "monthly");
  assert.equal(dataSourceOf({ file_type: "full", books: "bookkeeper" }), "client");
  assert.equal(dataSourceOf({ file_type: "full", books: "paper" }), "statements");
  assert.equal(dataSourceLabel({ file_type: "monthly", books: "concept_qbo" }), "Our QuickBooks file (monthly client)");
  for (const v of Object.values(DATA_SOURCE)) assert.ok(!/\b(Full|Monthly)\b/.test(v.label + v.line));
  assert.equal(MONTHLY_READY, false, "the monthly route stays hidden until it works end to end");
});
