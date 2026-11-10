// Run with: npm test
// Monthly company leads (batch section 12, decision 41): package suggestion and the proposal prefill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guessKind, matchOffer, proposalPrefill, suggestPackage } from "../src/lib/corporate/suggest.ts";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { Proposal } from "../src/lib/studio/controllers.ts";

const OFFERS = [
  { Offer: "Agent: year-end T2 only", Segment: "Agent", Package: "__YES__", Services: '["comp","gst","t2"]' },
  { Offer: "Agent: monthly bookkeeping plus year-end T2", Segment: "Agent", Package: "__YES__", Services: '["books","gst","comp","t2"]' },
  { Offer: "Team: Essential", Segment: "Team or brokerage", Package: "__YES__", Services: '["books"]' },
  { Offer: "Team: Core", Segment: "Team or brokerage", Package: "__YES__", Services: '["books"]' },
  { Offer: "Team: Finance Office", Segment: "Team or brokerage", Package: "__YES__", Services: '["books","pay"]' },
];

test("the package follows the revenue band (corrected Nov 9)", () => {
  assert.equal(suggestPackage("under_1m", "agent")?.label, "Agent");
  assert.equal(suggestPackage("under_1m", "team")?.label, "Team: Essential");
  assert.equal(suggestPackage("1m_3m", "agent")?.label, "Core");
  assert.equal(suggestPackage("3m_5m", "team")?.label, "Finance Office");
  assert.equal(suggestPackage("over_5m", "team")?.label, "Custom (priced by Hashim)");
  assert.equal(suggestPackage("1m_3m", "other"), null, "other industries: no suggestion");
});

test("a guess at the client type from the business answer", () => {
  assert.equal(guessKind("Real estate"), "agent");
  assert.equal(guessKind("real estate team"), "team");
  assert.equal(guessKind("Brokerage"), "team");
  assert.equal(guessKind("PREC for a realtor"), "agent");
  assert.equal(guessKind("dental office"), "other");
  assert.equal(guessKind("IT consulting"), "other");
});

test("the price book offer, only when exactly one fits", () => {
  assert.equal(matchOffer(suggestPackage("under_1m", "agent"), OFFERS), "Agent: monthly bookkeeping plus year-end T2");
  assert.equal(matchOffer(suggestPackage("under_1m", "team"), OFFERS), "Team: Essential");
  assert.equal(matchOffer(suggestPackage("1m_3m", "team"), OFFERS), "Team: Core");
  assert.equal(matchOffer(suggestPackage("3m_5m", "team"), OFFERS), "Team: Finance Office");
  assert.equal(matchOffer(suggestPackage("over_5m", "team"), OFFERS), "");
  assert.equal(matchOffer(suggestPackage("1m_3m", "team"), [...OFFERS, { Offer: "Brokerage: Core", Segment: "Team or brokerage" }]), "", "two fit: staff choose");
});

const lead = (business: string, revenue: string, kind: "agent" | "team" | "other" | null = null) => ({
  first_name: "Taylor", last_name: "Dummy", email: "taylor@example.test", province: "ON", company_name: null, client_kind: kind,
  answers: { business, books: "software" as const, need: "monthly" as const, monthly: { revenue, people: "1_5", uptodate: "few_months" } as never },
});

test("the proposal draft: details, answers, client type and offer", () => {
  const p = proposalPrefill(lead("Real estate team", "1m_3m"), OFFERS);
  assert.equal(p.f.name, "Taylor Dummy");
  assert.equal(p.f.salutation, "Taylor");
  assert.equal(p.f.segment, "Team or brokerage");
  assert.equal(p.offer, "Team: Core");
  assert.equal(p.f.h0, "Business: Real estate team. Yearly revenue: $1 million to $3 million.");
  assert.ok(p.f.h1.startsWith("People paid: 1 to 5. Books:"));
  assert.equal(p.f.h2, "Books up to date: A few months behind.");
  // Staff's choice on the lead wins over the guess.
  assert.equal(proposalPrefill(lead("Real estate team", "under_1m", "agent"), OFFERS).f.segment, "Agent");
  const other = proposalPrefill(lead("Dental office", "1m_3m"), OFFERS);
  assert.equal(other.f.segment, "Other");
  assert.equal(other.offer, "");
  assert.equal(other.suggestion, null);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
test("the prefill lands in the proposal builder like a person typed it", () => {
  const p = proposalPrefill(lead("Real estate", "under_1m"), OFFERS);
  const c = new Proposal(createStudioEngine({} as any) as any, "2026-11-10");
  c.set("segment", p.f.segment);
  for (const [k, v] of Object.entries(p.f)) if (k !== "segment") c.set(k, v);
  c.setOption(0, "offer", p.offer);
  assert.equal(c.f.format, "single", "an agent gets one price");
  assert.equal(c.opts[0].offer, "Agent: monthly bookkeeping plus year-end T2");
  assert.equal(c.f.contact, "Taylor Dummy");
});
