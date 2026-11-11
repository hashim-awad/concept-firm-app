// The Leads list (front office batch, section 2; mockup 1-Leads): Type, Source, Status and Next in
// plain words. Pure: tests check it.
export type ListLead = {
  route: string; status: string; source: string; answers: Record<string, unknown>;
  assigned: string | null; taken: string | null; hasQuote: boolean;
};

const first = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "";

export function leadType(l: Pick<ListLead, "route" | "answers">): string {
  if (l.route === "personal") return "Personal tax";
  return (l.answers as { need?: string }).need === "monthly" ? "Monthly company" : "Company year-end";
}

export function leadSource(l: Pick<ListLead, "source" | "taken">): string {
  return /^phone/i.test(l.source) ? `Phone${l.taken ? ` (${first(l.taken)})` : ""}` : "Website";
}
export const isPhone = (source: string) => /^phone/i.test(source);

// New, Quote sent, With Hashim, Signed, Lost.
export function leadStatus(status: string): string {
  return ({ new: "New", quoted: "New", sent: "Quote sent", call_needed: "With Hashim", out_of_scope: "With Hashim", signed: "Signed", lost: "Lost" } as Record<string, string>)[status] ?? status;
}
export const STATUS_CLASS: Record<string, string> = {
  New: "bg-navy-50 text-navy-700", "Quote sent": "bg-warning-soft text-warning", "With Hashim": "bg-sand-100 text-ink-2", Signed: "bg-success-soft text-success", Lost: "bg-sand-100 text-ink-3",
};

// The next action and who does it.
export function leadNext(l: ListLead): string {
  const a = l.answers as { partial?: boolean; need?: string; out_of_scope?: { reason: string }[]; call_reasons?: string[] };
  switch (l.status) {
    case "sent": return "Waiting for signature";
    case "signed": case "lost": return "";
    case "out_of_scope": return `Out of scope: ${a.out_of_scope?.[0]?.reason ?? "see the answers"} (Hashim)`;
    case "call_needed":
      if (l.route === "company" && a.need === "monthly") return "Discovery call (Hashim)";
      return `Call: ${a.call_reasons?.[0] ?? "needs a closer look"} (Hashim)`;
    default:
      if (a.partial) return "Waiting for the rest of the form";
      return `Issue quote (${first(l.assigned) || "unassigned"})`;
  }
}
