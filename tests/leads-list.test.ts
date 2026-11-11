// Run with: npm test
// The Leads list's Type, Source, Status and Next (front office batch, section 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadNext, leadSource, leadStatus, leadType } from "../src/lib/leads/list.ts";

const L = (x: Partial<Parameters<typeof leadNext>[0]>) => ({ route: "personal", status: "new", source: "Website", answers: {}, assigned: "Sample Staffer", taken: null, hasQuote: true, ...x });

test("type", () => {
  assert.equal(leadType(L({})), "Personal tax");
  assert.equal(leadType(L({ route: "company", answers: { need: "year_end" } })), "Company year-end");
  assert.equal(leadType(L({ route: "company", answers: { need: "monthly" } })), "Monthly company");
});
test("source: website, or phone with who took the call", () => {
  assert.equal(leadSource(L({})), "Website");
  assert.equal(leadSource(L({ source: "Phone", taken: "Sample Staffer" })), "Phone (Sample)");
});
test("status: five words", () => {
  assert.deepEqual(["new", "quoted", "sent", "call_needed", "out_of_scope", "signed", "lost"].map(leadStatus), ["New", "New", "Quote sent", "With Hashim", "With Hashim", "Signed", "Lost"]);
});
test("next: the action and who does it", () => {
  assert.equal(leadNext(L({})), "Issue quote (Sample)");
  assert.equal(leadNext(L({ assigned: null })), "Issue quote (unassigned)");
  assert.equal(leadNext(L({ status: "sent" })), "Waiting for signature");
  assert.equal(leadNext(L({ route: "company", status: "call_needed", answers: { need: "monthly" } })), "Discovery call (Hashim)");
  assert.equal(leadNext(L({ status: "out_of_scope", answers: { out_of_scope: [{ reason: "US person" }] } })), "Out of scope: US person (Hashim)");
  assert.equal(leadNext(L({ status: "signed" })), "");
});
