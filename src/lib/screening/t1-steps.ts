// The step layout of the public personal tax form (Hashim, Nov 10; layout only) mapped onto the
// published screening questions' own answer keys (batch section 4), so pricing and routing do not
// change. Pure: used by the form and by tests/t1-steps.test.ts.
//   Quick check: each box ticked = the out-of-scope answer to one of the 5 fit questions.
//   What happened: each tile = the yes/no question that opens its follow-ups. Per-return tiles ask
//   couples Me / Spouse / Both; per-household tiles (business, rental, property sale, T5013) are once
//   per household, so who it was does not change the quote and is not asked.
//   A few details: only the follow-ups of ticked tiles, in tile order.
import type { Answer, Answers } from "./engine.ts";

export type Who = "me" | "spouse" | "both";

// The 5 fit questions and the answer that is out of scope (batch section 4, questions 3 to 7).
export const QUICK: { key: string; bad: string; good: string; label: string }[] = [
  { key: "lived_in_canada", bad: "no", good: "yes", label: "Did not live in Canada for the whole year" },
  { key: "us_citizen", bad: "yes", good: "no", label: "US citizen or green card holder" },
  { key: "deceased_or_trust", bad: "yes", good: "no", label: "The return is for someone who passed away, or for a trust" },
  { key: "earlier_year", bad: "yes", good: "no", label: "Need a return for an earlier year, or a change to one already filed" },
  { key: "cra_review", bad: "yes", good: "no", label: "CRA is reviewing or auditing a return right now" },
];

// The 11 income questions as tiles, with the follow-ups each one opens (batch section 4, questions 9 to 19).
export const TILES: { key: string; label: string; follow: string[] }[] = [
  { key: "self_employed", label: "Self-employed or commission income", follow: ["business_count", "business_totals", "vehicle_count", "home_office_count", "gst_registered", "gst_frequency"] },
  { key: "rental", label: "Rental income", follow: ["rental_count"] },
  { key: "sold_property", label: "Sold a property", follow: ["sold_home", "property_sale_count", "assignment", "assignment_gst"] },
  { key: "investment_sales", label: "Sold stocks or funds", follow: [] },
  { key: "crypto", label: "Crypto or options", follow: ["crypto_report"] },
  { key: "foreign_property", label: "Foreign property over {t1135_simple_over} (cost, not value)", follow: ["foreign_property_high"] },
  { key: "foreign_income", label: "Foreign income with no Canadian slip", follow: [] },
  { key: "foreign_return", label: "Tax return in another country", follow: ["foreign_return_country", "us_state_count"] },
  { key: "t5013", label: "T5013 partnership slip", follow: ["t5013_count"] },
  { key: "t2200", label: "T2200 from employer", follow: [] },
  { key: "moving", label: "Moved {moving_km} km or more for work or school", follow: [] },
];

export const T1_STEP_KEYS = [...QUICK.map((q) => q.key), ...TILES.flatMap((t) => [t.key, ...t.follow]), "filing_type", "spouse_first_name", "spouse_last_name", "spouse_email", "anything_else"];

export type StepState = {
  filing: "" | "single" | "couple";
  spouse: { spouse_first_name: string; spouse_last_name: string; spouse_email: string };
  quick: Set<string> | "none" | null;
  tiles: Map<string, Who | "yes"> | "none" | null; // "yes": ticked, couple has not picked who yet
  details: Record<string, Answer>;
  personDetails: Record<string, Answer>[];
  note: string;
};

export function buildT1Answers(s: StepState, perPerson: (key: string) => boolean): Answers {
  const couple = s.filing === "couple";
  const household: Record<string, Answer> = { filing_type: s.filing || undefined, ...(couple ? s.spouse : {}), ...s.details, anything_else: s.note || undefined };
  const people: Record<string, Answer>[] = [...Array(couple ? 2 : 1).keys()].map((i) => ({ ...(s.personDetails[i] ?? {}) }));
  if (s.quick !== null) for (const q of QUICK) household[q.key] = s.quick !== "none" && s.quick.has(q.key) ? q.bad : q.good;
  if (s.tiles !== null) {
    const ticked = s.tiles instanceof Map ? s.tiles : new Map<string, Who | "yes">();
    for (const tile of TILES) {
      const v = ticked.get(tile.key);
      if (!perPerson(tile.key)) household[tile.key] = v ? "yes" : "no";
      else people.forEach((p, i) => { p[tile.key] = !v ? "no" : !couple || v === "both" || (v === "me" && i === 0) || (v === "spouse" && i === 1) ? "yes" : "no"; });
    }
  }
  return { household, people };
}
