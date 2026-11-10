// Monthly company leads (Phase 2 batch, section 12; decision 41). Real estate only: a package
// suggestion from the revenue band. Every other industry: no suggestion, the price is left for Hashim.
// The form does not ask agent or team, so staff mark it on the lead; Studio pre-fills a guess from
// the business-type answer.
import { BOOKS, PEOPLE, REVENUE, UPTODATE, type CorpAnswers } from "./quote.ts";

export type ClientKind = "agent" | "team" | "other";
export const CLIENT_KINDS: [ClientKind, string][] = [["agent", "Real estate: single agent"], ["team", "Real estate: team or brokerage"], ["other", "Not real estate"]];

const RE = /real\s*estate|realt(?:or|y)|brokerage|\bprec\b|\bagent\b|\bre\s*team\b|\bmortgage\s+agent\b/i;
// A guess only; staff confirm it on the lead.
export function guessKind(business: string): ClientKind {
  if (!RE.test(business)) return "other";
  return /\bteam\b|brokerage/i.test(business) ? "team" : "agent";
}

export type Suggestion = { label: string; why: string } | null;
export function suggestPackage(revenue: string | undefined, kind: ClientKind): Suggestion {
  if (kind === "other" || !revenue || !(revenue in REVENUE)) return null;
  const band = REVENUE[revenue as keyof typeof REVENUE];
  const label = revenue === "under_1m" ? (kind === "agent" ? "Agent" : "Team: Essential")
    : revenue === "1m_3m" ? "Core" : revenue === "3m_5m" ? "Finance Office" : "Custom (priced by Hashim)";
  return { label, why: `Revenue ${band.charAt(0).toLowerCase() + band.slice(1)}${revenue === "under_1m" ? (kind === "agent" ? ", single agent" : ", team or brokerage") : ""}` };
}

// The price book offer the proposal starts with, when exactly one active offer fits. Otherwise none.
type Offer = { Offer: string; Segment: string; Package?: string; Services?: string };
export function matchOffer(s: Suggestion, offers: Offer[]): string {
  if (!s) return "";
  const has = (o: Offer, svc: string) => { try { return (JSON.parse(o.Services ?? "[]") as string[]).includes(svc); } catch { return false; } };
  const pick = (f: (o: Offer) => boolean) => { const m = offers.filter(f); return m.length === 1 ? m[0].Offer : ""; };
  if (s.label === "Agent") return pick((o) => o.Segment === "Agent" && o.Package === "__YES__" && has(o, "books"));
  if (s.label === "Team: Essential") return pick((o) => o.Offer === "Team: Essential");
  if (s.label === "Core") return pick((o) => /(^|: )Core$/.test(o.Offer));
  if (s.label === "Finance Office") return pick((o) => /Finance Office$/.test(o.Offer));
  return "";
}

// The proposal draft from the lead: client details, the answers as "What we heard" lines (staff
// rewrite them after the call), and the client type and offer from the suggestion.
export type LeadForProposal = { first_name: string; last_name: string; email: string; province: string; company_name: string | null; client_kind: ClientKind | null; answers: Partial<CorpAnswers> };
export function proposalPrefill(l: LeadForProposal, offers: Offer[]) {
  const a = l.answers;
  const kind = l.client_kind ?? guessKind(a.business ?? "");
  const m = a.monthly;
  const s = suggestPackage(m?.revenue, kind);
  const segment = kind === "other" ? "Other" : kind === "agent" && m?.revenue === "under_1m" ? "Agent" : "Team or brokerage";
  const contact = `${l.first_name} ${l.last_name}`.trim();
  const f: Record<string, string> = {
    name: l.company_name?.trim() || contact, contact, salutation: l.first_name,
    ...(["ON", "AB", "BC"].includes(l.province) ? { province: l.province } : {}),
    segment,
    h0: [a.business && `Business: ${a.business}.`, m && `Yearly revenue: ${REVENUE[m.revenue]}.`].filter(Boolean).join(" "),
    h1: [m && `People paid: ${PEOPLE[m.people]}.`, a.books && `Books: ${BOOKS[a.books]}.`].filter(Boolean).join(" "),
    h2: m ? `Books up to date: ${UPTODATE[m.uptodate]}.` : "",
  };
  return { f, offer: segment === "Other" ? "" : matchOffer(s, offers), suggestion: s, kind, email: l.email };
}
