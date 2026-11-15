// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026). Benchmark: QuickBooks Online "Import bank
// transactions" then "Verify details", plus a running-balance check. One upload is one statement job; the reader
// (Claude API) returns every account found in it. Money is in cents. Amounts are kept positive with a
// direction, as on the verify screen:
// - dir "in" raises the statement balance: a bank deposit, or a card charge;
// - dir "out" lowers it: a bank withdrawal, or a card payment.
// Signed cents for import and the CSV = in ? +amount : -amount. That is the existing upload rule
// (src/lib/closebook/bank-upload.ts): bank money in positive; card charges positive, payments negative.

import type { BankKind } from "@/lib/closebook/bank-upload";

export type StatementStatus = "queued" | "reading" | "ready" | "needs_look" | "failed" | "imported" | "discarded";

export type StatementLine = {
  id: string;               // stable within the statement ("l1", "l2", ... from the reader; "a1"... when added)
  date: string;             // YYYY-MM-DD
  description: string;
  amountCents: number;      // always positive
  dir: "in" | "out";
  balanceCents: number | null; // the running balance printed after this line, when the statement prints one
  page: number;             // 1-based page of the file the line is on
  unsure: boolean;          // the reader could not read it with confidence
  unsureReason: string;     // short reason when unsure, else ""
  source: "read" | "added" | "edited";
};

export type StatementSummary = { inTotal: number; inCount: number | null; outTotal: number; outCount: number | null };

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
};

export const OUT_OF_CREDITS = "The statement reader is out of credits for this month. Upload a CSV instead, or ask Hashim to add credits.";
