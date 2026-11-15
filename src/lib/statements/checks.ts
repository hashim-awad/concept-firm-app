// Checks on one account of a statement read from a PDF (round 20, Hashim, Nov 15, 2026). Pure, in cents.
// Benchmark: QuickBooks Online "Verify details", plus a running-balance check.
// 1. Opening + lines = closing, to the cent. Difference must be 0.00 to import or download.
// 2. The printed summary: totals and counts of money in and money out match the lines.
// 3. The running balance, line by line: the first line where the printed balance stops matching goes to
//    For review with the reason. Statements printed newest first are read bottom up.
// 4. Unsure lines, and lines dated outside the statement period, go to For review.
// Closebook only (closebookWarnings): last digits against the account chosen, the kind of account, and a
// period outside the file's year. Lines already imported are found in the database (cb_duplicate_lines).

import { signedCents, typeLabel, type StatementAccount, type StatementLine } from "./types.ts";

export type ReviewItem = { lineId: string; reason: string };
export type RunningBreak = { lineId: string; expected: number; printed: number };
export type AccountCheck = {
  differenceCents: number;      // closing - (opening + lines); 0 when it ties
  inTotal: number; inCount: number;
  outTotal: number; outCount: number;
  summaryOk: { in: boolean | null; out: boolean | null }; // null: no printed summary
  runningBreak: RunningBreak | null;
  review: ReviewItem[];          // one entry per line, in statement order
  ok: boolean;                   // nothing to look at
};

export const money = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Walk the lines from the opening balance; the first printed balance that does not match.
function firstBreak(opening: number, lines: StatementLine[]): RunningBreak | null {
  let bal = opening;
  for (const l of lines) {
    bal += signedCents(l);
    if (l.balanceCents !== null && l.balanceCents !== bal) return { lineId: l.id, expected: bal, printed: l.balanceCents };
  }
  return null;
}

export function checkAccount(acc: StatementAccount): AccountCheck {
  const ins = acc.lines.filter((l) => l.dir === "in"), outs = acc.lines.filter((l) => l.dir === "out");
  const inTotal = ins.reduce((n, l) => n + l.amountCents, 0), outTotal = outs.reduce((n, l) => n + l.amountCents, 0);
  const differenceCents = acc.closing - (acc.opening + inTotal - outTotal);
  const s = acc.summary;
  const summaryOk = {
    in: s ? s.inTotal === inTotal && (s.inCount === null || s.inCount === ins.length) : null,
    out: s ? s.outTotal === outTotal && (s.outCount === null || s.outCount === outs.length) : null,
  };

  let runningBreak = firstBreak(acc.opening, acc.lines);
  // Newest first: the same check bottom up holds, so nothing is wrong.
  if (runningBreak && acc.lines.some((l) => l.balanceCents !== null) && !firstBreak(acc.opening, [...acc.lines].reverse())) runningBreak = null;

  const reasons = new Map<string, string[]>();
  const add = (id: string, why: string) => reasons.set(id, [...(reasons.get(id) ?? []), why]);
  for (const l of acc.lines) {
    if (l.unsure) add(l.id, l.unsureReason ? `The reader was not sure: ${l.unsureReason}` : "The reader was not sure of this line.");
    if (l.date < acc.periodStart || l.date > acc.periodEnd) add(l.id, `The date is outside the statement period (${acc.periodStart} to ${acc.periodEnd}).`);
    if (l.amountCents <= 0) add(l.id, "The amount is zero.");
  }
  if (runningBreak) {
    add(runningBreak.lineId, `The statement shows a balance of ${money(runningBreak.printed)} after this line, but the lines add up to ${money(runningBreak.expected)}. A line above it may be missing or misread, or this amount may be wrong.`);
  }
  const review = acc.lines.filter((l) => reasons.has(l.id)).map((l) => ({ lineId: l.id, reason: reasons.get(l.id)!.join(" ") }));
  const ok = differenceCents === 0 && summaryOk.in !== false && summaryOk.out !== false && !runningBreak && review.length === 0;
  return { differenceCents, inTotal, inCount: ins.length, outTotal, outCount: outs.length, summaryOk, runningBreak, review, ok };
}

// Plain words for the summary check, against the printed totals, e.g. "Total money in (12) $4,210.00 matches the statement."
export function summaryWords(acc: StatementAccount, c: AccountCheck): string[] {
  const out: string[] = [];
  const s = acc.summary;
  if (!s) return out;
  const side = (dir: "in" | "out", total: number, count: number, pTotal: number, pCount: number | null, ok: boolean | null) => {
    const name = `Total ${typeLabel(acc.kind, dir).toLowerCase()}`;
    if (ok) out.push(`${name} (${count}) ${money(total)} matches the statement.`);
    else out.push(`${name} is ${money(total)} on ${count} line${count === 1 ? "" : "s"}, but the statement shows ${money(pTotal)}${pCount === null ? "" : ` on ${pCount} line${pCount === 1 ? "" : "s"}`}.`);
  };
  side("in", c.inTotal, c.inCount, s.inTotal, s.inCount, c.summaryOk.in);
  side("out", c.outTotal, c.outCount, s.outTotal, s.outCount, c.summaryOk.out);
  return out;
}

export type CloseBookContext = {
  yearStart: string; yearEnd: string;              // the file's year
  chosen: { last4: string | null; kind: "bank" | "card"; name: string } | null; // the bank account chosen, if any
};

// Warnings in Closebook. They do not block the import; the preparer decides.
export function closebookWarnings(acc: StatementAccount, ctx: CloseBookContext): string[] {
  const out: string[] = [];
  const digits = (acc.last4 ?? "").replace(/\D/g, "");
  const chosen = ctx.chosen;
  if (chosen && digits && chosen.last4) {
    const a = digits.slice(-4), b = chosen.last4.slice(-4);
    const n = Math.min(a.length, b.length);
    if (a.slice(-n) !== b.slice(-n)) out.push(`The statement is for an account ending in ${digits}, but ${chosen.name} ends in ${chosen.last4}.`);
  }
  if (chosen && chosen.kind !== acc.kind) {
    out.push(acc.kind === "card"
      ? `This looks like a credit card or line of credit statement, but ${chosen.name} is a bank account.`
      : `This looks like a bank account statement, but ${chosen.name} is a credit card or line of credit.`);
  }
  if (acc.periodEnd < ctx.yearStart || acc.periodStart > ctx.yearEnd) {
    out.push(`The statement period (${acc.periodStart} to ${acc.periodEnd}) is outside the file's year (${ctx.yearStart} to ${ctx.yearEnd}).`);
  } else if (acc.periodStart < ctx.yearStart || acc.periodEnd > ctx.yearEnd) {
    out.push(`Part of the statement period (${acc.periodStart} to ${acc.periodEnd}) is outside the file's year (${ctx.yearStart} to ${ctx.yearEnd}).`);
  }
  return out;
}

// The figures the lists show for a whole statement: the account furthest off sets the difference.
export type StatementSummaryRow = { accounts: number; lines: number; difference_cents: number | null; review: number };
export function statementSummary(data: { accounts: StatementAccount[] } | null): StatementSummaryRow {
  if (!data) return { accounts: 0, lines: 0, difference_cents: null, review: 0 };
  let diff: number | null = null, review = 0, lines = 0;
  for (const a of data.accounts) {
    const c = checkAccount(a);
    if (diff === null || Math.abs(c.differenceCents) > Math.abs(diff)) diff = c.differenceCents;
    review += c.review.length;
    lines += a.lines.length;
  }
  return { accounts: data.accounts.length, lines, difference_cents: diff, review };
}

// All good: every account ties and nothing is in For review. A statement with no lines at all needs a look.
export function statementStatus(data: { accounts: StatementAccount[] }): "ready" | "needs_look" {
  if (!data.accounts.length || !data.accounts.some((a) => a.lines.length)) return "needs_look";
  return data.accounts.every((a) => checkAccount(a).ok) ? "ready" : "needs_look";
}
