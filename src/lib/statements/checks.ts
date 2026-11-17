// Checks on one account of a statement read from a PDF (round 20, Hashim, Nov 15, 2026). Pure, in cents.
// Benchmark: QuickBooks Online "Verify details", plus a running-balance check.
// 1. Opening + lines = closing, to the cent. Difference must be 0.00 to import or download.
// 2. The printed summary: totals and counts of money in and money out match the lines.
// 3. The running balance, line by line: the first line where the printed balance stops matching goes to
//    For review with the reason. Statements printed newest first are read bottom up.
// 4. Unsure lines, and lines dated outside the statement period, go to For review.
// Closebook only (closebookWarnings): last digits against the account chosen, the kind of account, and a
// period outside the file's year. Lines already imported are found in the database (cb_duplicate_lines).

import { signedCents, typeLabel, type CardKind, type StatementAccount, type StatementLine } from "./types.ts";

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

// For people (screen messages and the Excel heading): a negative in brackets, ($1,234.00) (Hashim,
// Nov 15, 2026, item C). The CSV keeps a minus (export.ts).
export const money = (c: number) => { const t = `$${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; return c < 0 ? `(${t})` : t; };

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

// ---------- Round 26 (Hashim, Nov 17, 2026): a card checked by kind against its summary box. Each kind printed
// is compared with the lines read of that kind: "Purchases and debits: statement 250.00, lines read 0.00, 250.00
// missing". A charge line with no kind (an older read, or added by hand) counts as a purchase. Only kinds the
// statement prints are checked; a statement with no summary box has none.
export type KindRow = { kind: CardKind; label: string; printed: number; read: number; off: number };
export const KIND_LABEL: Record<CardKind, string> = { payment: "Payments and credits", purchase: "Purchases and debits", cash_advance: "Cash advances", interest: "Interest", fee: "Fees" };
export const kindOf = (l: StatementLine): CardKind => (l.dir === "out" ? "payment" : l.cardKind && l.cardKind !== "payment" ? l.cardKind : "purchase");
export function cardKindCheck(acc: StatementAccount): KindRow[] {
  const s = acc.summary;
  if (acc.kind !== "card" || !s) return [];
  const printed: [CardKind, number | null | undefined][] = [["payment", s.outTotal], ["purchase", s.purchases], ["cash_advance", s.cashAdvances], ["interest", s.interest], ["fee", s.fees]];
  return printed.filter((p): p is [CardKind, number] => typeof p[1] === "number").map(([kind, p]) => {
    const read = acc.lines.filter((l) => kindOf(l) === kind).reduce((n, l) => n + l.amountCents, 0);
    return { kind, label: KIND_LABEL[kind], printed: p, read, off: p - read };
  });
}
const dollars = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "Purchases and debits: statement 250.00, lines read 0.00, 250.00 missing" (or "12.00 more than the statement").
export const kindSentence = (r: KindRow) =>
  `${r.label}: statement ${dollars(r.printed)}, lines read ${dollars(r.read)}, ${dollars(r.off)} ${r.off > 0 ? "missing" : "more than the statement"}`;

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

// The figures the lists show for a whole statement: the account furthest off sets the difference. The
// period (earliest start, latest end) and each account found (name, last digits, kind) let the upload list
// say what was found, as in mock 01: "Mar 1 to Mar 31 · Chequing ••• 4821".
export type FoundAccount = { name: string; last4: string; kind: StatementAccount["kind"] };
export type StatementSummaryRow = { accounts: number; lines: number; difference_cents: number | null; review: number;
  period_start: string | null; period_end: string | null; found: FoundAccount[] };
export function statementSummary(data: { accounts: StatementAccount[] } | null): StatementSummaryRow {
  if (!data) return { accounts: 0, lines: 0, difference_cents: null, review: 0, period_start: null, period_end: null, found: [] };
  let diff: number | null = null, review = 0, lines = 0, start: string | null = null, end: string | null = null;
  for (const a of data.accounts) {
    const c = checkAccount(a);
    if (diff === null || Math.abs(c.differenceCents) > Math.abs(diff)) diff = c.differenceCents;
    review += c.review.length;
    lines += a.lines.length;
    if (a.periodStart && (start === null || a.periodStart < start)) start = a.periodStart;
    if (a.periodEnd && (end === null || a.periodEnd > end)) end = a.periodEnd;
  }
  return { accounts: data.accounts.length, lines, difference_cents: diff, review, period_start: start, period_end: end,
    found: data.accounts.map((a) => ({ name: a.name, last4: a.last4, kind: a.kind })) };
}

// All good: every account ties and nothing is in For review. A statement with no lines at all needs a look.
export function statementStatus(data: { accounts: StatementAccount[] }): "ready" | "needs_look" {
  if (!data.accounts.length || !data.accounts.some((a) => a.lines.length)) return "needs_look";
  return data.accounts.every((a) => checkAccount(a).ok) ? "ready" : "needs_look";
}

// A working copy sent back from the verify screen: the shape of a ReadResult, with sensible values.
// Returns the problem in plain words, or null.
export function resultProblem(d: unknown): string | null {
  const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const isInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
  const r = d as { accounts?: unknown; pages?: unknown; bank?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.accounts)) return "The statement has no accounts.";
  if (typeof r.bank !== "string" || !isInt(r.pages)) return "The statement details are missing.";
  const keys = new Set<string>();
  let total = 0;
  for (const a of r.accounts as Partial<StatementAccount>[]) {
    const name = a.name || "An account";
    if (typeof a.key !== "string" || !a.key || keys.has(a.key)) return "Each account needs its own key.";
    keys.add(a.key);
    if (typeof a.name !== "string" || typeof a.last4 !== "string" || (a.kind !== "bank" && a.kind !== "card")) return `${name}: the account details are missing.`;
    if (!isDate(a.periodStart) || !isDate(a.periodEnd) || a.periodEnd! < a.periodStart!) return `${name}: enter the statement start and end dates.`;
    if (!isInt(a.opening) || !isInt(a.closing)) return `${name}: enter the opening and closing balances.`;
    if (a.summary !== null && (typeof a.summary !== "object" || !isInt(a.summary?.inTotal) || !isInt(a.summary?.outTotal))) return `${name}: the printed summary is not complete.`;
    if (!Array.isArray(a.lines)) return `${name}: the lines are missing.`;
    const ids = new Set<string>();
    for (const l of a.lines as Partial<StatementLine>[]) {
      if (typeof l.id !== "string" || !l.id || ids.has(l.id)) return `${name}: each line needs its own id.`;
      ids.add(l.id);
      if (!isDate(l.date)) return `${name}: every line needs a date.`;
      if (typeof l.description !== "string" || !l.description.trim() || l.description.length > 500) return `${name}: every line needs a description (up to 500 characters).`;
      if (!isInt(l.amountCents) || l.amountCents! < 0) return `${name}: every amount must be a positive number with up to 2 decimals.`;
      if (l.dir !== "in" && l.dir !== "out") return `${name}: every line needs a type.`;
      if (l.balanceCents !== null && !isInt(l.balanceCents)) return `${name}: a printed balance is not a number.`;
      if (!isInt(l.page) || typeof l.unsure !== "boolean" || typeof l.unsureReason !== "string" || !["read", "added", "edited"].includes(String(l.source))) return `${name}: a line is not complete.`;
    }
    total += a.lines.length;
  }
  if (total > 20000) return "The statement has too many lines.";
  return null;
}
