// Closebook reports (Hashim, Nov 15, 2026; benchmark: QuickBooks Online's reports, with CaseWare's
// lead-sheet grouping). Built live from the postings every time they open; nothing is stored as a copy.
// Pure and tested. Amounts in cents, debits positive.
//
// - Trial balance: each account with last year, opening, coded activity, adjusting entries, final, and
//   the difference against last year.
// - Balance sheet and income statement: this year against last year, grouped by lead sheet, each lead
//   sheet with its accounts. "Not yet sorted" shows until it is zero.
// - General ledger: every account's postings with a running balance, filtered by account and date.
// - Journal: every posting in date order, grouped by its source, filtered by source.
import type { Posting, PostingKind } from "./tb-build.ts";

export type RepAccount = { key: string; number: string; name: string; line_no: string | null; lastCents: number };
export type LineInfo = { type: string; sheet: string | null; sheetName: string };

export type TbLine = { key: string; number: string; name: string; line_no: string | null; last: number; opening: number; activity: number; adjustments: number; final: number; diff: number };

const KIND_ORDER: Record<PostingKind, number> = { opening: 0, import: 1, bank: 2, entry: 3 };
// By account number; accounts without one (the holding accounts, GIFI-only lines) last.
const byNumber = (a: { number: string; name: string }, b: { number: string; name: string }) =>
  Number(!a.number) - Number(!b.number) || a.number.localeCompare(b.number) || a.name.localeCompare(b.name);

// Every account that has a posting or a balance last year, once.
function directory(accounts: RepAccount[], postings: Posting[]): Map<string, RepAccount> {
  const dir = new Map(accounts.map((a) => [a.key, a]));
  for (const p of postings) if (!dir.has(p.key)) dir.set(p.key, { key: p.key, number: "", name: p.key, line_no: null, lastCents: 0 });
  return dir;
}

export function trialBalance(accounts: RepAccount[], postings: Posting[]): TbLine[] {
  const dir = directory(accounts, postings);
  const tb = new Map<string, TbLine>([...dir.values()].map((a) => [a.key, { key: a.key, number: a.number, name: a.name, line_no: a.line_no, last: a.lastCents, opening: 0, activity: 0, adjustments: 0, final: 0, diff: 0 }]));
  for (const p of postings) {
    const t = tb.get(p.key)!;
    if (p.kind === "opening") t.opening += p.cents;
    else if (p.kind === "entry") t.adjustments += p.cents;
    else t.activity += p.cents;
  }
  for (const t of tb.values()) { t.final = t.opening + t.activity + t.adjustments; t.diff = t.final - t.last; }
  return [...tb.values()].filter((t) => t.final || t.last || t.opening || t.activity || t.adjustments).sort(byNumber);
}

// Statements. Shown as QuickBooks shows them: liabilities, equity and revenue positive on their side.
export type StmtAccount = { key: string; number: string; name: string; line_no: string | null; now: number; last: number };
export type StmtGroup = { code: string; name: string; accounts: StmtAccount[]; now: number; last: number };
export type StmtSection = { title: string; groups: StmtGroup[]; now: number; last: number };
export type Statements = {
  bs: { assets: StmtSection; liabilities: StmtSection; equity: StmtSection; unsorted: StmtSection | null; totalLE: { now: number; last: number }; balanced: boolean };
  // lastFromT2: last year's income statement was not entered (no Schedule 125), so last year's net income
  // is the figure that ties last year's closing balance sheet (the T2's 9999).
  pl: { revenue: StmtSection; expenses: StmtSection; net: { now: number; last: number }; lastFromT2: boolean };
};
export const NET_INCOME = "net-income";
export const UNSORTED = "unsorted";

function section(title: string, rows: TbLine[], sign: 1 | -1, groupOf: (r: TbLine) => { code: string; name: string }): StmtSection {
  const groups = new Map<string, StmtGroup>();
  for (const r of rows) {
    if (!r.final && !r.last) continue;
    const g = groupOf(r);
    const grp = groups.get(g.code) ?? { code: g.code, name: g.name, accounts: [], now: 0, last: 0 };
    grp.accounts.push({ key: r.key, number: r.number, name: r.name, line_no: r.line_no, now: sign * r.final || 0, last: sign * r.last || 0 });
    grp.now += sign * r.final || 0; grp.last += sign * r.last || 0;
    groups.set(g.code, grp);
  }
  const list = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  for (const g of list) g.accounts.sort(byNumber);
  return { title, groups: list, now: list.reduce((n, g) => n + g.now, 0), last: list.reduce((n, g) => n + g.last, 0) };
}

export function statements(tb: TbLine[], info: (line_no: string | null) => LineInfo | null): Statements {
  const typed = (t: string) => tb.filter((r) => info(r.line_no)?.type === t);
  const bySheet = (r: TbLine) => { const i = info(r.line_no); return i?.sheet ? { code: i.sheet, name: i.sheetName } : { code: "~", name: "Other" }; };
  const revenue = section("Revenue", typed("Revenue"), -1, bySheet);
  const expenses = section("Expenses", typed("Expense"), 1, bySheet);
  const net = { now: revenue.now - expenses.now, last: revenue.last - expenses.last };
  const assets = section("Assets", typed("Asset"), 1, bySheet);
  const liabilities = section("Liabilities", typed("Liability"), -1, bySheet);
  const equity = section("Equity", typed("Equity"), -1, bySheet);
  // Accounts without a GIFI line yet (not yet coded, opening balances to enter, not mapped).
  const open = section("Not yet sorted", tb.filter((r) => !info(r.line_no)), -1, () => ({ code: UNSORTED, name: "Not yet sorted" }));
  const unsorted = open.groups.length && (open.now || open.last) ? open : null;
  // Last year's net income on the balance sheet: whatever ties last year's closing balances. It equals
  // the income statement's when Schedule 125 was entered, and the T2's 9999 when it was typed instead.
  const tiedLast = assets.last - liabilities.last - equity.last - (unsorted?.last ?? 0);
  const lastFromT2 = tiedLast !== net.last;
  if (lastFromT2) net.last = tiedLast;
  if (net.now || net.last) {
    equity.groups.push({ code: NET_INCOME, name: "Net income for the year", accounts: [], now: net.now, last: net.last });
    equity.now += net.now; equity.last += net.last;
  }
  const totalLE = { now: liabilities.now + equity.now + (unsorted?.now ?? 0), last: liabilities.last + equity.last + (unsorted?.last ?? 0) };
  return { bs: { assets, liabilities, equity, unsorted, totalLE, balanced: assets.now === totalLE.now }, pl: { revenue, expenses, net, lastFromT2 } };
}

// General ledger: each account's postings in date order with a running balance. from/to: YYYY-MM-DD.
export type LedgerLine = Posting & { running: number };
export type LedgerAccount = { key: string; number: string; name: string; line_no: string | null; before: number; lines: LedgerLine[]; end: number };
const sortPostings = (a: Posting, b: Posting) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

export function ledger(accounts: RepAccount[], postings: Posting[], opts: { key?: string; from?: string; to?: string } = {}): LedgerAccount[] {
  const dir = directory(accounts, postings);
  const out: LedgerAccount[] = [];
  for (const a of [...dir.values()].sort(byNumber)) {
    if (opts.key && a.key !== opts.key) continue;
    const mine = postings.filter((p) => p.key === a.key).sort(sortPostings);
    let run = 0, before = 0;
    const lines: LedgerLine[] = [];
    for (const p of mine) {
      if (opts.from && p.date < opts.from) { before += p.cents; run += p.cents; continue; }
      if (opts.to && p.date > opts.to) continue;
      run += p.cents;
      lines.push({ ...p, running: run });
    }
    if (!lines.length && !before && !opts.key) continue;
    out.push({ key: a.key, number: a.number, name: a.name, line_no: a.line_no, before, lines, end: run });
  }
  return out;
}

// Journal: every posting in date order, grouped by the transaction it came from (one bank line, one
// adjusting entry, the opening balances), like QuickBooks' Journal report.
export type JournalTxn = { kind: PostingKind; ref: string; acct?: string; date: string; label: string; lines: { key: string; cents: number }[] };
export function journal(postings: Posting[], kind?: PostingKind | ""): JournalTxn[] {
  const txns = new Map<string, JournalTxn>();
  for (const p of [...postings].sort(sortPostings)) {
    if (kind && p.kind !== kind) continue;
    // The opening balances are one transaction; every bank line and every entry is its own.
    const id = p.kind === "opening" ? "opening" : `${p.kind}|${p.ref}`;
    const t = txns.get(id) ?? { kind: p.kind, ref: p.kind === "opening" ? "" : p.ref, acct: p.acct, date: p.date, label: p.kind === "opening" ? "Opening balances" : p.label, lines: [] };
    const same = t.lines.find((l) => l.key === p.key);
    if (same) same.cents += p.cents; else t.lines.push({ key: p.key, cents: p.cents });
    txns.set(id, t);
  }
  // The opening balances read in account order, as on a trial balance.
  const open = txns.get("opening");
  if (open) open.lines.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  return [...txns.values()];
}

export const KIND_LABEL: Record<PostingKind, string> = { opening: "Opening balance", bank: "Bank line", entry: "Adjusting entry", import: "Trial balance import" };
