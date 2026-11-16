// Round 20 (Hashim, Nov 15, 2026): small helpers shared by the statement screens (Closebook step 3, the
// verify screen, the standalone tool and My day). Pure, so client and server components can use them.
import type { StatementStatus } from "@/lib/statements/types";
import { bracketAmount, parseAmount } from "../../../lib/closebook/amount.ts";

// 1234567 cents -> "12,345.67" (no currency sign, like the statement itself). A negative shows in
// brackets, (12,345.67) (Hashim, Nov 15, 2026, item C); screens colour it red with amountTone.
export const money = (cents: number): string => bracketAmount(cents);

// A typed amount: "12,480.15", "-12.5", "(12.50)", "$1,000" -> cents; anything else -> null. A minus sign
// or brackets both mean negative (item C).
export const parseMoney = (v: string): number | null => parseAmount(v);

// "2026-10-01" -> "Oct 1".
export function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The status pill: blue while reading, green when ready or imported, amber for a look, red when failed.
export const STATUS_CLS: Record<StatementStatus, string> = {
  queued: "bg-navy-50 text-navy-700",
  reading: "bg-navy-50 text-navy-700",
  ready: "bg-success-soft text-success",
  needs_look: "bg-warning-soft text-warning",
  failed: "bg-danger-soft text-danger",
  imported: "bg-success-soft text-success",
  discarded: "bg-sand-100 text-ink-3",
  skipped: "bg-sand-100 text-ink-3",
};

// An account as people say it: "Chequing ••• 4821".
export const accountLabel = (name: string, last4: string) => `${name || "Account"}${last4 ? ` ••• ${last4}` : ""}`;

// A statement's account name, short, as in mock 01: "Business Chequing Account" -> "Chequing".
export function shortName(name: string, kind: "bank" | "card"): string {
  const s = name.replace(/\b(business|account|accounts|package|plan)\b/gi, " ").replace(/\s+/g, " ").trim();
  return s || (kind === "card" ? "Card" : "Account");
}

// "Mar 1 to Mar 31" (the year is the file's, so it is left out).
export const periodText = (start: string | null, end: string | null) => (start && end ? `${shortDate(start)} to ${shortDate(end)}` : "");
