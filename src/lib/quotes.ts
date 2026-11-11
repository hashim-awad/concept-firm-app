// One quote record for every offer (front office batch, section 3): names and colours shown on screen.
export type QuoteKind = "t1" | "corporate" | "proposal";
export type QuoteStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "expired";

export const QUOTE_KIND: Record<QuoteKind, string> = { t1: "Personal tax", corporate: "Company year-end", proposal: "Monthly proposal" };
export const QUOTE_STATUS: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", viewed: "Viewed", signed: "Signed", declined: "Declined", expired: "Expired" };
// Fixed status colours (brief, Screen standard): waiting on the client navy, done green, closed grey or red.
export const QUOTE_STATUS_CLASS: Record<QuoteStatus, string> = {
  draft: "bg-sand-100 text-ink-3", sent: "bg-navy-50 text-navy-700", viewed: "bg-navy-50 text-navy-700",
  signed: "bg-success-soft text-success", declined: "bg-danger/10 text-danger", expired: "bg-sand-100 text-ink-3",
};
export const WAITING: QuoteStatus[] = ["sent", "viewed"];

// "$448 + HST": the one total, before tax. Staff with Pricing only.
export const quoteTotal = (cents: number | null) => (cents === null ? "" : `${(cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: cents % 100 ? 2 : 0 })} + HST`);
