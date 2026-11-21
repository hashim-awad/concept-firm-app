// CloseBook2 piece CB2-1 (Hashim, Nov 21, 2026): a client's books, continuous like a QuickBooks Online company. A year end
// is a date, not a separate ledger: the client's year files are periods of one ledger. Pure and tested.
//
// Each year file's postings come from today's engine (src/lib/closebook/report-data.ts), so every figure equals today's
// reports. What the books add:
// - The first year opens with one ordinary journal entry, "Opening balances", dated the day before its first day: the
//   stored opening balances, exactly as today's engine posts them.
// - A later year opens from the year before. Where its stored opening balances differ from last year's closing balances
//   in Closebook, one more entry, "Opening difference to last year's closing balances", carries the difference. No entry
//   when there is none. It is dated the year's first day: dated the day before, it would fall in last year and change last
//   year's closing figures.
// - A bank line dated outside its year posts on the year's first or last day, as today's reports count it in that year.
// - A trial balance import (a client who keeps their own books) is one entry, "Trial balance imported", dated the year
//   end: this year's imported balances less the opening. It counts in Prelim, not in Adj's.
// - Income and expense accounts close to retained earnings at every year end, in every report; no closing entry is made.
// Until someone saves a change to one of these entries in Books, it is worked out from the stored figures every time
// (origin opening_balances, opening_difference or tb_import once saved; the saved entry then wins for that year).
import type { Posting, PostingKind } from "../closebook/tb-build.ts";
import type { RepAccount } from "../closebook/reports.ts";

export type AcctType = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
export const isIncome = (t: AcctType | undefined) => t === "Revenue" || t === "Expense";
export type GenOrigin = "opening_balances" | "opening_difference" | "tb_import";
export const GEN_MEMO: Record<GenOrigin, string> = {
  opening_balances: "Opening balances",
  opening_difference: "Opening difference to last year's closing balances",
  tb_import: "Trial balance imported",
};

// An account as the books know it: its identity across years is its number, or its name when it has none.
export const identOf = (a: { number: string; name: string }) => (a.number ? a.number : `name:${a.name.trim().toLowerCase()}`);

export type YearEntry = { id: string; origin: string | null };
export type YearIn = { fileId: string; yearStart: string; yearEnd: string; bankFile: boolean; accounts: RepAccount[]; postings: Posting[]; entries: YearEntry[] };
// A posting in the books: the account by identity; fileId: the year it belongs to.
export type BooksPosting = Posting & { ident: string; fileId: string };
export type GenEntry = { id: string; fileId: string; origin: GenOrigin; date: string; memo: string; lines: { ident: string; cents: number }[] };
export type IdentInfo = { number: string; name: string; line_no: string | null; lastCents: number };
export type Books = { postings: BooksPosting[]; generated: GenEntry[]; info: Map<string, IdentInfo>; firstStart: string | null; firstLast: Map<string, number>; years: { fileId: string; yearStart: string; yearEnd: string }[] };

export const dayBefore = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
export const yearBefore = (d: string) => { const [y, m, day] = d.split("-").map(Number); const t = new Date(Date.UTC(y - 1, m - 1, day)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const add = (m: Map<string, number>, k: string, c: number) => { if (c) m.set(k, (m.get(k) ?? 0) + c); };

// Balances before a date, with income and expenses closed to retained earnings (QBO: they close at every year end).
export function balancesBefore(postings: BooksPosting[], date: string, typeOf: (ident: string) => AcctType | undefined, re: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of postings) if (p.date < date) add(m, isIncome(typeOf(p.ident)) ? re : p.ident, p.cents);
  return m;
}

// typeOf: an account's type by identity; re: the identity of retained earnings (where income and expenses close).
export function buildBooks(yearsIn: YearIn[], typeOf: (ident: string) => AcctType | undefined, re: string): Books {
  const years = [...yearsIn].sort((a, b) => a.yearEnd.localeCompare(b.yearEnd));
  const postings: BooksPosting[] = [];
  const generated: GenEntry[] = [];
  const info = new Map<string, IdentInfo>();
  let firstLast = new Map<string, number>();
  years.forEach((y, i) => {
    const dir = new Map(y.accounts.map((a) => [a.key, a]));
    const ident = (key: string) => { const a = dir.get(key); return a ? identOf(a) : key; };
    // The latest year's number, name and GIFI line win.
    for (const a of y.accounts) info.set(identOf(a), { number: a.number, name: a.name, line_no: a.line_no, lastCents: 0 });
    const origin = new Map(y.entries.map((e) => [e.id, e.origin]));
    const savedOpening = y.entries.some((e) => e.origin === "opening_balances" || e.origin === "opening_difference");
    const savedImport = y.entries.some((e) => e.origin === "tb_import");
    const inYear = (d: string) => (d < y.yearStart ? y.yearStart : d > y.yearEnd ? y.yearEnd : d);
    const push = (p: Posting, kind: PostingKind = p.kind, date = inYear(p.date)) => postings.push({ ...p, kind, date, ident: ident(p.key), fileId: y.fileId });

    // The year's opening as the engine works it out today.
    const open = new Map<string, number>();
    if (y.bankFile) { for (const p of y.postings) if (p.kind === "opening") add(open, ident(p.key), p.cents); }
    else {
      let sum = 0;
      for (const a of y.accounts) {
        if (!a.lastCents) continue;
        const id = identOf(a);
        add(open, isIncome(typeOf(id)) ? re : id, a.lastCents);
        sum += a.lastCents;
      }
      // Last year's income statement not entered: the missing net income is in retained earnings at the start.
      add(open, re, -sum);
    }
    if (i === 0) {
      firstLast = new Map(y.accounts.filter((a) => a.lastCents).map((a) => [identOf(a), a.lastCents]));
    }
    const dayOne = dayBefore(y.yearStart);
    if (!savedOpening) {
      const lines = new Map(open);
      let origin_: GenOrigin = "opening_balances";
      if (i > 0) {
        origin_ = "opening_difference";
        for (const [k, c] of balancesBefore(postings, y.yearStart, typeOf, re)) add(lines, k, -c);
      }
      const ls = [...lines].filter(([, c]) => c).map(([ident, cents]) => ({ ident, cents }));
      if (ls.length) {
        const id = `gen:${y.fileId}:${origin_}`;
        const date = i === 0 ? dayOne : y.yearStart;
        generated.push({ id, fileId: y.fileId, origin: origin_, date, memo: GEN_MEMO[origin_], lines: ls });
        for (const l of ls) postings.push({ key: l.ident, ident: l.ident, cents: l.cents, date, kind: "opening", ref: id, label: GEN_MEMO[origin_], fileId: y.fileId });
      }
    }
    // The year's own postings: bank lines and entries; the engine's opening and import are replaced above and below.
    for (const p of y.postings) {
      if (p.kind === "opening" || p.kind === "import") continue;
      const o = p.kind === "entry" ? origin.get(p.ref) : null;
      if (o === "opening_balances" || o === "opening_difference") push(p, "opening", p.date);
      else if (o === "tb_import") push(p, "import");
      else push(p);
    }
    if (!y.bankFile && !savedImport) {
      const lines = new Map<string, number>();
      for (const p of y.postings) if (p.kind === "import") add(lines, ident(p.key), p.cents);
      for (const [k, c] of open) add(lines, k, -c);
      const ls = [...lines].filter(([, c]) => c).map(([ident, cents]) => ({ ident, cents }));
      if (ls.length) {
        const id = `gen:${y.fileId}:tb_import`;
        generated.push({ id, fileId: y.fileId, origin: "tb_import", date: y.yearEnd, memo: GEN_MEMO.tb_import, lines: ls });
        for (const l of ls) postings.push({ key: l.ident, ident: l.ident, cents: l.cents, date: y.yearEnd, kind: "import", ref: id, label: GEN_MEMO.tb_import, fileId: y.fileId });
      }
    }
  });
  return { postings, generated, info, firstStart: years[0]?.yearStart ?? null, firstLast, years: years.map((y) => ({ fileId: y.fileId, yearStart: y.yearStart, yearEnd: y.yearEnd })) };
}

// The fiscal year that holds a date: its first day (a date after the last year runs on from the last year's end).
export function fiscalStart(books: Books, date: string): string {
  const y = books.years.find((x) => x.yearStart <= date && date <= x.yearEnd);
  if (y) return y.yearStart;
  const before = [...books.years].reverse().find((x) => x.yearEnd < date);
  if (before) { const d = new Date(`${before.yearEnd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  return books.years[0]?.yearStart ?? date;
}

// What the report builders read for a date range (src/lib/closebook/reports.ts): each account's balance at the start as
// one opening posting (income closed to retained earnings), then every posting in the range. Prior: the same range a
// year earlier; before the first year in Closebook, the first year's stored last-year balances.
export type RangeInput = { accounts: RepAccount[]; postings: Posting[] };
export function rangeInput(books: Books, from: string, to: string, typeOf: (ident: string) => AcctType | undefined, re: string,
  chart: Map<string, { number: string; name: string; line_no: string | null }>): RangeInput {
  const window = (f: string, t: string) => {
    const before = balancesBefore(books.postings, f, typeOf, re);
    const out: Posting[] = [];
    const start = dayBefore(f);
    for (const [ident, cents] of before) if (cents) out.push({ key: ident, cents, date: start, kind: "opening", ref: "", label: "Balance at start" });
    for (const p of books.postings) if (p.date >= f && p.date <= t) out.push({ ...p, key: p.ident });
    return out;
  };
  const postings = window(from, to);
  const pf = yearBefore(from), pt = yearBefore(to);
  const prior = new Map<string, number>();
  if (books.firstStart && pt < books.firstStart) {
    for (const [k, c] of books.firstLast) prior.set(k, c);
  } else {
    for (const p of window(pf, pt)) add(prior, p.key, p.cents);
  }
  const keys = new Set<string>([...chart.keys(), ...postings.map((p) => p.key), ...prior.keys()]);
  const accounts: RepAccount[] = [...keys].map((k) => {
    const c = chart.get(k) ?? books.info.get(k);
    return { key: k, number: c?.number ?? "", name: c?.name ?? k.replace(/^name:/, ""), line_no: c?.line_no ?? null, lastCents: prior.get(k) ?? 0 };
  });
  return { accounts, postings };
}
