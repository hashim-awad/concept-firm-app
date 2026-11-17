// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026). Benchmark: QuickBooks Online "Import bank
// transactions" then "Verify details", plus a running-balance check. One upload is one statement job; the reader
// (Claude API) returns every account found in it. Money is in cents. Amounts are kept positive with a
// direction, as on the verify screen:
// - dir "in" raises the statement balance: a bank deposit, or a card charge;
// - dir "out" lowers it: a bank withdrawal, or a card payment.
// Signed cents for import and the CSV = in ? +amount : -amount. That is the existing upload rule
// (src/lib/closebook/bank-upload.ts): bank money in positive; card charges positive, payments negative.

import type { BankKind } from "@/lib/closebook/bank-upload";

export type StatementStatus = "queued" | "reading" | "ready" | "needs_look" | "failed" | "imported" | "discarded" | "skipped";

export type StatementLine = {
  id: string;               // stable within the statement ("l1", "l2", ... from the reader; "a1"... when added)
  date: string;             // YYYY-MM-DD; a card's transaction (purchase) date
  postedDate?: string | null; // round 22: a card's posting date, when printed beside the transaction date
  description: string;
  amountCents: number;      // always positive
  dir: "in" | "out";
  balanceCents: number | null; // the running balance printed after this line, when the statement prints one
  page: number;             // 1-based page of the file the line is on
  unsure: boolean;          // the reader could not read it with confidence
  unsureReason: string;     // short reason when unsure, else ""
  source: "read" | "added" | "edited";
  // Round 26 (Hashim, Nov 17, 2026): a card line's kind as the statement's summary box groups it, and the last digits
  // of the cardholder's card it is printed under (a business card lists each cardholder in its own section; all
  // belong to the statement's account). Information only. Absent on older reads, CSVs and bank statements.
  cardKind?: CardKind | null;
  holder?: string | null;
};
export type CardKind = "purchase" | "payment" | "cash_advance" | "interest" | "fee";
export const CARD_KINDS: CardKind[] = ["purchase", "payment", "cash_advance", "interest", "fee"];

// Round 22 (decision 1): a card's interest and fees as printed, each on its own (part of inTotal).
// Round 26: a card's purchases and debits, and its cash advances, as printed in the summary box (also part of inTotal).
export type StatementSummary = { inTotal: number; inCount: number | null; outTotal: number; outCount: number | null; interest?: number | null; fees?: number | null;
  purchases?: number | null; cashAdvances?: number | null };

export type StatementAccount = {
  key: string;              // "a1", "a2", ... stable within the statement
  last4: string;            // last digits of the account or card number as printed ("" when not printed)
  name: string;             // the account name as printed, e.g. "Business chequing"
  kind: BankKind;           // "bank" or "card" (cards and lines of credit)
  periodStart: string;      // YYYY-MM-DD
  periodEnd: string;
  opening: number;          // cents, signed as printed (a card owing is positive)
  closing: number;
  summary: StatementSummary | null; // the printed totals of money in and money out, when printed
  lines: StatementLine[];
};

export type ReadResult = { accounts: StatementAccount[]; pages: number; bank: string };

export function signedCents(l: Pick<StatementLine, "amountCents" | "dir">): number {
  return l.dir === "in" ? l.amountCents : -l.amountCents;
}

export function typeLabel(kind: BankKind, dir: "in" | "out"): string {
  if (kind === "card") return dir === "in" ? "Charge" : "Payment";
  return dir === "in" ? "Money in" : "Money out";
}

export const STATUS_LABEL: Record<StatementStatus, string> = {
  queued: "Reading",
  reading: "Reading",
  ready: "Ready to check",
  needs_look: "Needs a look",
  failed: "Failed",
  imported: "Imported",
  discarded: "Discarded",
  skipped: "Skipped",
};

export const OUT_OF_CREDITS = "The statement reader is out of credits for this month. Upload a CSV instead, or ask Hashim to add credits.";
