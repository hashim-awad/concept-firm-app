// One quote record for every offer (front office batch, section 3): names and colours shown on screen.
export type QuoteKind = "t1" | "corporate" | "proposal";
export type QuoteStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "expired" | "withdrawn";

// Round 19 (Hashim): one word for offers inside Studio. The client's monthly document stays titled "Proposal".
export const QUOTE_KIND: Record<QuoteKind, string> = { t1: "T1 quote", corporate: "Year-end quote", proposal: "Monthly quote" };
export const QUOTE_STATUS: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", viewed: "Viewed", signed: "Signed", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn" };
// Fixed status colours (brief, Screen standard): waiting on the client navy, done green, closed grey or red.
// UI1 colour rule (Q9): green = done (signed), blue = in progress (sent, viewed), amber = needs someone's attention
// (expired: follow up or close), grey = not started or closed (draft, declined, withdrawn).
export const QUOTE_STATUS_CLASS: Record<QuoteStatus, string> = {
  draft: "bg-sand-100 text-[#3F4246]", sent: "bg-info-soft text-info", viewed: "bg-info-soft text-info",
  signed: "bg-success-soft text-success", declined: "bg-sand-100 text-[#3F4246]", expired: "bg-warning-soft text-warning", withdrawn: "bg-sand-100 text-[#3F4246]",
};
export const WAITING: QuoteStatus[] = ["sent", "viewed"];

// Piece UI1 (front office item 8): one way to write a fee before tax on staff screens: "$2,450.00 plus GST/HST", always
// with cents. Staff with Pricing only. Client documents keep their own wording.
export const plusTax = (cents: number) => `${(cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 })} plus GST/HST`;
export const quoteTotal = (cents: number | null) => (cents === null ? "" : plusTax(cents));
