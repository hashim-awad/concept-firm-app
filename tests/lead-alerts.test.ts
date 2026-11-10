// Run with: node --test tests/
// Lead alerts (Phase 2 batch, section 3): business-hours clock and the staff email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { businessMinutes, formatWaiting, isOpen, torontoTime, type BusinessHours } from "../src/lib/business-hours.ts";
import { buildLeadAlert, leadFacts } from "../src/lib/leads/alert-email.ts";

const weekdays: BusinessHours = { mon: ["09:00", "17:00"], tue: ["09:00", "17:00"], wed: ["09:00", "17:00"], thu: ["09:00", "17:00"], fri: ["09:00", "17:00"], sat: null, sun: null };
const at = (y: number, m: number, d: number, h: number, mi = 0) => torontoTime(y, m, d, h, mi);

test("Toronto wall clock: EST and EDT", () => {
  assert.equal(new Date(at(2026, 11, 10, 9)).toISOString(), "2026-11-10T14:00:00.000Z"); // EST, UTC-5
  assert.equal(new Date(at(2026, 7, 10, 9)).toISOString(), "2026-07-10T13:00:00.000Z"); // EDT, UTC-4
});

test("counts only inside business hours", () => {
  // Tuesday Nov 10, 2026, 10:00 to 10:25
  assert.equal(businessMinutes(at(2026, 11, 10, 10), at(2026, 11, 10, 10, 25), weekdays), 25);
  // Lead at 16:50 Tuesday, now 09:35 Wednesday: 10 + 35
  assert.equal(businessMinutes(at(2026, 11, 10, 16, 50), at(2026, 11, 11, 9, 35), weekdays), 45);
  // Lead at 20:00 Friday, now 09:10 Monday: weekend does not count
  assert.equal(businessMinutes(at(2026, 11, 13, 20), at(2026, 11, 16, 9, 10), weekdays), 10);
  // Before opening: nothing yet
  assert.equal(businessMinutes(at(2026, 11, 10, 7), at(2026, 11, 10, 8, 59), weekdays), 0);
});

test("across the daylight saving change (Nov 1, 2026)", () => {
  const every: BusinessHours = { mon: ["09:00", "17:00"], tue: ["09:00", "17:00"], wed: ["09:00", "17:00"], thu: ["09:00", "17:00"], fri: ["09:00", "17:00"], sat: ["09:00", "17:00"], sun: ["09:00", "17:00"] };
  // Saturday Oct 31 16:30 EDT to Sunday Nov 1 09:30 EST: 30 + 30
  assert.equal(businessMinutes(at(2026, 10, 31, 16, 30), at(2026, 11, 1, 9, 30), every), 60);
});

test("hours not set: every minute counts", () => {
  assert.equal(businessMinutes(at(2026, 11, 14, 20), at(2026, 11, 14, 21), {}), 60);
  assert.equal(businessMinutes(at(2026, 11, 14, 20), at(2026, 11, 14, 21), null), 60);
});

test("open now, and the timer text", () => {
  assert.equal(isOpen(at(2026, 11, 10, 12), weekdays), true);
  assert.equal(isOpen(at(2026, 11, 10, 17), weekdays), false);
  assert.equal(isOpen(at(2026, 11, 14, 12), weekdays), false);
  assert.equal(formatWaiting(25), "Waiting 25 min");
  assert.equal(formatWaiting(60), "Waiting 1 h");
  assert.equal(formatWaiting(125), "Waiting 2 h 5 min");
});

test("email shows type, household, province, quote; no client name", () => {
  const lead = { id: "11111111-1111-1111-1111-111111111111", route: "personal", province: "ON", status: "new", answers: { household: { filing_type: "couple" } }, quote_cents: 125000 };
  assert.deepEqual(leadFacts(lead), [["Lead type", "Personal tax (T1)"], ["Household", "Couple"], ["Province", "Ontario"], ["Quote", "$1,250.00 plus GST/HST"]]);
  const e = buildLeadAlert("new", lead, "https://studio.example.test");
  assert.equal(e.subject, "New lead: Personal tax (T1), Ontario");
  assert.ok(e.html.includes("https://studio.example.test/leads/11111111-1111-1111-1111-111111111111"));
  assert.ok(e.html.includes("Open the lead"));
  assert.ok(!/—/.test(e.html + e.subject), "no em dashes");
  const r = buildLeadAlert("reminder", { ...lead, route: "company", province: "BC", status: "call_needed", answers: {} }, "https://s.test");
  assert.equal(r.subject, "Reminder: quote not sent after 45 business minutes (Company, British Columbia)");
  assert.deepEqual(leadFacts({ ...lead, route: "company", status: "call_needed", answers: {} }).map((f) => f[1]), ["Company", "Does not apply", "Ontario", "Call needed"]);
  assert.equal(leadFacts({ ...lead, answers: {}, quote_cents: null })[3][1], "Not worked out yet");
  assert.equal(leadFacts({ ...lead, status: "out_of_scope", quote_cents: null })[3][1], "Out of scope, no quote");
});
