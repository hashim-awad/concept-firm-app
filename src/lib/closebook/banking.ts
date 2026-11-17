// Step 3 "Banking" (round 23, Hashim, Nov 16, 2026): the rules behind its three sub-steps. Pure and tested.
// Benchmarks: QuickBooks Online (Banking, "Upload from file", Reconcile and its discrepancy report).
//   3.1 Bank accounts & T2 tie-out: one box per T2 line; Difference under 1.00 is rounding.
//   3.2 Bank feeds: one row per account, 12 month boxes, one status word.
//   3.3 Reconcile: OPENING + MONEY IN − MONEY OUT = CLOSING against the BANK at the year end; the start band;
//       "Find it" for any other difference, month by month.
// Amounts in cents, in each account's own terms: what is in a bank account, what is owed on a card.
import { cardKindCheck, checkAccount, kindSentence } from "../statements/checks.ts";
import { signedCents, type StatementAccount } from "../statements/types.ts";
import type { Cell } from "./step3.ts";

// ---------- 3.1: one box per T2 line
// Short fixed names per T2 line (Hashim, Nov 17, 2026); any other line takes its GIFI name.
export const BOX_TITLE: Record<string, string> = {
  "1002": "Bank accounts", "2600": "Bank overdraft", "2707": "Credit card loans", "2701": "Bank loans", "3149": "Line of credit, long-term", "3143": "Bank loan, long-term",
};
export type BoxState = "rounding" | "add" | "much";
export type TieBox = { gifi: string; title: string; rows: { id: string; label: string; cents: number | null }[]; total: number; t2: number; difference: number; state: BoxState };
export type BoxAccount = { id: string; label: string; gifi: string; kind: "bank" | "card"; books: number | null; t2?: string | null };
// An account overdrawn at last year end sits in "Bank overdraft" (2600), as on the T2, as an amount owing.
export const usualT2 = (a: BoxAccount) => (a.kind === "bank" && a.books !== null && a.books < 0 ? "2600" : a.gifi);
// Round 25 (Hashim, Nov 17, 2026): each account carries "Last year's T2 line" (empty: the type's usual line). 3.1
// compares each of last year's T2 lines with the accounts that were on it (a prior accountant may have put a line
// of credit on 2707 with the cards). This year's GIFI line does not follow.
export const boxOf = (a: BoxAccount) => a.t2 || usualT2(a);
// The usual lines of the account types: one with a T2 amount and no account shows too (an account to add).
export const USUAL_LINES = ["1002", "2600", "2707", "2701", "3149", "3143"];
export function tieBoxes(accounts: BoxAccount[], t2: Map<string, number>, names: Map<string, string> = new Map()): TieBox[] {
  const by = new Map<string, BoxAccount[]>();
  for (const a of accounts) by.set(boxOf(a), [...(by.get(boxOf(a)) ?? []), a]);
  for (const code of USUAL_LINES) if ((t2.get(code) ?? 0) !== 0 && !by.has(code)) by.set(code, []);
  return [...by.entries()].sort(([a], [b]) => (USUAL_LINES.indexOf(a) + 1 || 99) - (USUAL_LINES.indexOf(b) + 1 || 99) || a.localeCompare(b)).map(([gifi, as]) => {
    const rows = as.map((a) => ({ id: a.id, label: a.label, cents: a.books === null ? null : gifi === "2600" && a.kind === "bank" ? -a.books : a.books }));
    const total = rows.reduce((n, r) => n + (r.cents ?? 0), 0), t = t2.get(gifi) ?? 0, difference = total - t;
    return { gifi, title: BOX_TITLE[gifi] ?? names.get(gifi) ?? `GIFI ${gifi}`, rows, total, t2: t, difference: Math.abs(difference), state: Math.abs(difference) < 100 ? "rounding" : difference < 0 ? "add" : "much" };
  });
}
// The rounding that posts by itself to retained earnings at the start of the year: one per T2 line.
export const roundingOf = (boxes: TieBox[]) => boxes.filter((b) => b.state === "rounding" && b.total !== b.t2).map((b) => ({ gifi: b.gifi, title: b.title, cents: b.total - b.t2 }));

// ---------- 3.2: the month boxes and one status word per account
export type MonthState = "in" | "missing" | "none";
// Green covered, red missing, grey nothing uploaded (or outside the year, before it opened, after it closed).
export const monthBoxes = (cells: Cell[], uploaded: boolean): { label: string; from: string; to: string; state: MonthState }[] =>
  cells.map((c) => ({ label: c.label, from: c.from, to: c.to, state: !uploaded || c.state === "na" ? "none" : c.state === "in" ? "in" : "missing" }));
// The file's year as 12 calendar months, whatever the statements' cycle (a card on the 16th still shows 12 boxes). A
// month is red when a gap touches it; grey before the account opened or after it closed.
export function calendarMonths(yearStart: string, yearEnd: string, gaps: { kind: "missing" | "break"; from: string; to: string }[], uploaded: boolean,
  window: { opened?: string | null; closed?: string | null } = {}): { label: string; from: string; to: string; state: MonthState }[] {
  const out: { label: string; from: string; to: string; state: MonthState }[] = [];
  let from = yearStart;
  while (from <= yearEnd) {
    const y = +from.slice(0, 4), m = +from.slice(5, 7);
    let to = fromDay(Date.UTC(y, m, 1) / DAY - 1);
    if (to > yearEnd) to = yearEnd;
    const outsideWindow = (window.opened && to < window.opened) || (window.closed && from > window.closed);
    const hit = gaps.some((g) => (g.kind === "missing" ? g.from <= to && g.to >= from : g.from >= from && g.from <= to));
    out.push({ label: "JFMAMJJASOND"[m - 1], from, to, state: !uploaded || outsideWindow ? "none" : hit ? "missing" : "in" });
    from = fromDay(toDay(to) + 1);
  }
  return out;
}
export type FeedWord = { word: string; tone: "ok" | "bad" | "" };
export function feedWord(a: { statements: number; toFix: number; missing: number; waived: boolean }): FeedWord {
  if (a.toFix) return { word: `${a.toFix} to fix`, tone: "bad" };
  if (a.waived) return { word: "Complete", tone: "ok" };
  if (!a.statements) return { word: "Not uploaded", tone: "" };
  if (a.missing) return { word: `${a.missing} missing`, tone: "bad" };
  return { word: "Complete", tone: "ok" };
}

// ---------- 3.3: the reconcile bands
export type BandLine = { cents: number; outstanding: boolean };   // outstanding: cleared a start-of-year item, posts nothing
export type Band = {
  opening: number | null; inCount: number; inCents: number; outCount: number; outCents: number; closing: number | null;
  bank: number | null; endItems: number; difference: number | null;
  start: { bank: number; opening: number; items: number; left: number; show: boolean; explained: boolean } | null;
};
// opening: the 3.1 balance. bankStart/bankEnd: the bank's own balance on the day before the year and on its last
// day (from the statements covering them). Items: outstanding items (in − out) at each edge.
export function band(a: { opening: number | null; lines: BandLine[]; bankStart: number | null; bankEnd: number | null; startItems: number; endItems: number; waiting: boolean }): Band {
  const posting = a.lines.filter((l) => !l.outstanding);
  const ins = posting.filter((l) => l.cents > 0), outs = posting.filter((l) => l.cents < 0);
  const inCents = ins.reduce((n, l) => n + l.cents, 0), outCents = -outs.reduce((n, l) => n + l.cents, 0);
  const closing = a.opening === null ? null : a.opening + inCents - outCents;
  let start: Band["start"] = null;
  if (a.opening !== null && a.bankStart !== null) {
    const left = a.opening - a.bankStart - a.startItems;
    // Under 1.00 is rounding: no band. 1.00 or more: the band shows until the items explain it.
    start = { bank: a.bankStart, opening: a.opening, items: a.startItems, left, show: Math.abs(a.opening - a.bankStart) >= 100, explained: Math.abs(left) < 100 };
  }
  const difference = closing === null || a.bankEnd === null || a.waiting ? null : closing - a.bankEnd - a.endItems - (start?.left ?? 0);
  return { opening: a.opening, inCount: ins.length, inCents, outCount: outs.length, outCents, closing, bank: a.waiting ? null : a.bankEnd, endItems: a.endItems, difference, start };
}

// ---------- The fix screen (image 5). Round 26 (Hashim, Nov 17, 2026): say what is wrong, never guess.
// - A running balance that breaks points to a line: "One line looks misread", that line highlighted.
// - A card with a summary box: each kind off, in plain words; any kind short means "Lines missing". No line
//   is highlighted.
// - Otherwise: the statement and the lines differ by an amount, with no line highlighted.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
export const amt = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
export type Misread = { title: string; lineId: string | null; date: string; printed: number | null; computed: number | null; off: number; sentence: string; rows: string[] };
export function misread(acc: StatementAccount): Misread | null {
  const c = checkAccount(acc);
  if (c.ok && c.differenceCents === 0) return null;
  if (c.runningBreak) {
    const l = acc.lines.find((x) => x.id === c.runningBreak!.lineId)!;
    const off = c.runningBreak.printed - c.runningBreak.expected;
    return { title: "One line looks misread.", lineId: l.id, date: l.date, printed: c.runningBreak.printed, computed: c.runningBreak.expected, off, rows: [],
      sentence: `On ${day(l.date)} the bank's balance is ${amt(c.runningBreak.printed)}, but the lines give ${amt(c.runningBreak.expected)} (${amt(Math.abs(off))} off).` };
  }
  const lines = acc.closing - c.differenceCents;
  const off = cardKindCheck(acc).filter((r) => r.off !== 0);
  if (off.length) {
    return { title: off.some((r) => r.off > 0) ? "Lines missing." : "Lines do not match the statement.", lineId: null, date: acc.periodEnd, printed: acc.closing, computed: lines,
      off: c.differenceCents, rows: off.map(kindSentence), sentence: c.differenceCents === 0 ? "" : `The statement closes at ${amt(acc.closing)}, but the lines give ${amt(lines)}.` };
  }
  if (c.differenceCents !== 0) {
    return { title: "The lines do not add up to the statement.", lineId: null, date: acc.periodEnd, printed: acc.closing, computed: lines, off: c.differenceCents, rows: [],
      sentence: `The statement closes at ${amt(acc.closing)}, but the lines give ${amt(lines)} (${amt(Math.abs(c.differenceCents))} off).` };
  }
  return null;
}

// ---------- "Find it" (QuickBooks Online's reconciliation discrepancy report): the year month by month
// bankStart and bankEnd: the bank's own balance at the end of the day before the month and of its last day, from
// the statements as read; ours: the lines in the file dated in the month. The first month where they part is marked.
export type FindStatement = { periodStart: string; periodEnd: string; opening: number; lines: { date: string; cents: number; description?: string }[] };
export type FindMonth = { from: string; to: string; label: string; bankStart: number | null; bankEnd: number | null; ours: number; difference: number | null; first: boolean };
const DAY = 86400000;
const toDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// The bank's balance at the end of a day: the statement covering it that starts latest (a shared day belongs to
// both; the later one's opening is the earlier one's closing).
export function bankAt(sts: FindStatement[], date: string): number | null {
  const s = sts.filter((x) => x.periodStart <= date && x.periodEnd >= date).sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  // The day before a statement that starts the next day: its opening balance (a calendar month's statement).
  if (!s) return sts.find((x) => x.periodStart === fromDay(toDay(date) + 1))?.opening ?? null;
  return s.opening + s.lines.filter((l) => l.date <= date).reduce((n, l) => n + l.cents, 0);
}
export function findIt(yearStart: string, yearEnd: string, sts: FindStatement[], ours: { date: string; cents: number }[]): FindMonth[] {
  const out: FindMonth[] = [];
  let from = yearStart;
  while (from <= yearEnd) {
    const y = +from.slice(0, 4), m = +from.slice(5, 7);
    let to = fromDay(Date.UTC(y, m, 1) / DAY - 1);
    if (to > yearEnd) to = yearEnd;
    const bankStart = bankAt(sts, fromDay(toDay(from) - 1)), bankEnd = bankAt(sts, to);
    const mine = ours.filter((l) => l.date >= from && l.date <= to).reduce((n, l) => n + l.cents, 0);
    out.push({ from, to, label: `${LONG[m - 1]} ${y}`, bankStart, bankEnd, ours: mine, difference: bankStart === null || bankEnd === null ? null : bankEnd - bankStart - mine, first: false });
    from = fromDay(toDay(to) + 1);
  }
  const first = out.find((r) => r.difference !== null && r.difference !== 0);
  if (first) first.first = true;
  return out;
}
// A statement as read, for "Find it": its lines in the account's own terms.
export const findStatement = (acc: StatementAccount): FindStatement => ({ periodStart: acc.periodStart, periodEnd: acc.periodEnd, opening: acc.opening,
  lines: acc.lines.map((l) => ({ date: l.date, cents: signedCents(l), description: l.description })) });
