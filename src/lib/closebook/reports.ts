// Closebook reports (Hashim, Nov 15, 2026; benchmark: QuickBooks Online's reports; the trial balance by
// group and the entries follow a large firm's CaseWare working paper package). Built live from the
// postings every time they open; nothing is stored as a copy. Pure and tested. Amounts in cents, debits
// positive.
//
// - Trial balance: Prelim (opening + coded activity, or the imported balance), Adjust (AJE and TJE),
//   Reclass (RJE), Final, Prior, $ change, % change; by group in the order of the statements, or flat.
// - Balance sheet and income statement: this year against last year, grouped by lead sheet. Equity shows
//   Share capital; Retained earnings, start of year; Net income; Dividends. "Not yet sorted" until zero.
// - General ledger: every account's postings with a running balance, filtered by account and date.
// - Journal: every posting in date order, grouped by its source, then the net income box.
import type { Posting, PostingKind } from "./tb-build.ts";

export type RepAccount = { key: string; number: string; name: string; line_no: string | null; lastCents: number };
// sheet: the lead sheet code; sheetName: its name ("Cash and bank").
export type LineInfo = { type: string; sheet: string | null; sheetName: string };

export type TbLine = { key: string; number: string; name: string; line_no: string | null;
  last: number; opening: number; activity: number; prelim: number; adjust: number; reclass: number; final: number; diff: number };

export const NET_INCOME = "net-income";
export const UNSORTED = "unsorted";
// Last year's net income, when last year's income statement (Schedule 125) was not entered: a trial
// balance line so last year's column balances.
export const NI_LAST = "ni-last";

const KIND_ORDER: Record<PostingKind, number> = { opening: 0, import: 1, bank: 2, entry: 3 };
// By account number; accounts without one (the holding accounts, GIFI-only lines) last.
const byNumber = (a: { number: string; name: string }, b: { number: string; name: string }) =>
  Number(!a.number) - Number(!b.number) || a.number.localeCompare(b.number, "en", { numeric: true }) || a.name.localeCompare(b.name);
const gifiOf = (line_no: string | null) => Number((line_no ?? "").slice(0, 4));

// Every account that has a posting or a balance last year, once.
function directory(accounts: RepAccount[], postings: Posting[]): Map<string, RepAccount> {
  const dir = new Map(accounts.map((a) => [a.key, a]));
  for (const p of postings) if (!dir.has(p.key)) dir.set(p.key, { key: p.key, number: "", name: p.key, line_no: null, lastCents: 0 });
  return dir;
}

export function trialBalance(accounts: RepAccount[], postings: Posting[]): TbLine[] {
  const dir = directory(accounts, postings);
  const tb = new Map<string, TbLine>([...dir.values()].map((a) => [a.key, { key: a.key, number: a.number, name: a.name, line_no: a.line_no,
    last: a.lastCents, opening: 0, activity: 0, prelim: 0, adjust: 0, reclass: 0, final: 0, diff: 0 }]));
  for (const p of postings) {
    const t = tb.get(p.key)!;
    if (p.kind === "opening") t.opening += p.cents;
    else if (p.kind === "entry") { if (p.entryKind === "RJE") t.reclass += p.cents; else t.adjust += p.cents; }
    else t.activity += p.cents;
  }
  for (const t of tb.values()) { t.prelim = t.opening + t.activity; t.final = t.prelim + t.adjust + t.reclass; t.diff = t.final - t.last; }
  const rows = [...tb.values()].filter((t) => t.final || t.last || t.prelim || t.adjust || t.reclass).sort(byNumber);
  // Last year's column balances: what is missing is last year's net income from the T2.
  const lastSum = rows.reduce((n, t) => n + t.last, 0);
  if (lastSum) rows.push({ key: NI_LAST, number: "", name: "Net income last year (from the T2)", line_no: null, last: -lastSum, opening: 0, activity: 0, prelim: 0, adjust: 0, reclass: 0, final: 0, diff: lastSum });
  return rows;
}

// % change compares the size of the balance: a growing liability or revenue is positive. n/a when the
// prior balance is zero; n/m when the balance changed side. The one calculation for every change % in
// Closebook: the trial balance, step 7, the lead sheets (round 4 item 1). Amounts in cents.
export function pctChange(final: number, prior: number): string {
  if (!prior) return final ? "n/a" : "–";
  if (final && (final > 0) !== (prior > 0)) return "n/m";
  return `${(((Math.abs(final) - Math.abs(prior)) / Math.abs(prior)) * 100).toFixed(1)}%`;
}

// Equity on the balance sheet (Hashim, Nov 15): Share capital; Retained earnings, start of year; Net
// income; Dividends. Prior period adjustments and other items affecting retained earnings (3720, 3740)
// sit with retained earnings at the start of the year, as a restatement.
// A prior period adjustment (3720, 31500) shows on its own line under retained earnings at the start of
// the year (Hashim, Nov 15, 2026).
const EQUITY = { SC: "Share capital", RE: "Retained earnings, start of year", PPA: "Prior period adjustment", DIV: "Dividends" } as const;
const equityGroup = (line_no: string | null): keyof typeof EQUITY => {
  const g = gifiOf(line_no);
  return g >= 3700 && g <= 3702 ? "DIV" : g === 3720 ? "PPA" : g >= 3600 && g <= 3849 ? "RE" : "SC";
};

// The groups of a trial balance or statement, in the statements' order: assets, liabilities, equity,
// revenue, expenses, then not yet sorted.
type Group = { order: number; code: string; name: string };
const SECTION_ORDER: Record<string, number> = { Asset: 0, Liability: 1, Equity: 2, Revenue: 3, Expense: 4 };
// withCode: the statements (lead sheet codes, equity in its five lines); without: the trial balance by
// group, where a prior period adjustment stays in retained earnings and last year's net income from the
// T2 has its own group after income taxes (it stands in for last year's income statement).
function groupOf(r: TbLine, info: (l: string | null) => LineInfo | null, withCode: boolean): Group {
  if (r.key === NI_LAST) return { order: 4.5, code: NI_LAST, name: "Last year's income statement" };
  const i = info(r.line_no);
  if (!i) return { order: 5, code: UNSORTED, name: "Not yet sorted" };
  if (i.type === "Equity") {
    const e = equityGroup(r.line_no);
    if (!withCode) return e === "RE" || e === "PPA" ? { order: 2, code: "RE", name: "Retained earnings" } : { order: 2, code: e, name: EQUITY[e] };
    return { order: 2, code: e, name: EQUITY[e] };
  }
  const name = i.sheet ? (withCode ? `${i.sheet} ${i.sheetName}` : i.sheetName) : "Other";
  return { order: SECTION_ORDER[i.type] ?? 5, code: i.sheet ?? "~", name };
}
const EQ_ORDER = ["SC", "RE", "PPA", NET_INCOME, "DIV"];
const groupSort = (a: Group, b: Group) => a.order - b.order
  || (a.order === 2 ? EQ_ORDER.indexOf(a.code) - EQ_ORDER.indexOf(b.code) : a.code.length - b.code.length || a.code.localeCompare(b.code, "en", { numeric: true }));

// The trial balance by group (reference pages 1 and 2): each group's accounts and its total.
export type TbGroup = { code: string; name: string; rows: TbLine[]; total: TbLine };
const sumRows = (key: string, name: string, rows: TbLine[]): TbLine => {
  const t: TbLine = { key, number: "", name, line_no: null, last: 0, opening: 0, activity: 0, prelim: 0, adjust: 0, reclass: 0, final: 0, diff: 0 };
  for (const r of rows) for (const k of ["last", "opening", "activity", "prelim", "adjust", "reclass", "final", "diff"] as const) t[k] += r[k];
  return t;
};
export function tbByGroup(tb: TbLine[], info: (l: string | null) => LineInfo | null): { groups: TbGroup[]; total: TbLine } {
  const map = new Map<string, { g: Group; rows: TbLine[] }>();
  for (const r of tb) {
    const g = groupOf(r, info, false);
    const k = `${g.order}|${g.code}`;
    if (!map.has(k)) map.set(k, { g, rows: [] });
    map.get(k)!.rows.push(r);
  }
  const groups = [...map.values()].sort((a, b) => groupSort(a.g, b.g))
    .map(({ g, rows }) => ({ code: g.code, name: g.name, rows, total: sumRows(`total:${g.code}`, `Total ${g.name.charAt(0).toLowerCase()}${g.name.slice(1)}`, rows) }));
  return { groups, total: sumRows("total", "Total (debits less credits)", tb) };
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

function section(title: string, rows: TbLine[], sign: 1 | -1, info: (l: string | null) => LineInfo | null, keep: string[] = []): StmtSection {
  const groups = new Map<string, StmtGroup & { g: Group }>();
  for (const k of keep) groups.set(k, { g: { order: 2, code: k, name: EQUITY[k as keyof typeof EQUITY] }, code: k, name: EQUITY[k as keyof typeof EQUITY], accounts: [], now: 0, last: 0 });
  for (const r of rows) {
    if (!r.final && !r.last) continue;
    const g = groupOf(r, info, true);
    const grp = groups.get(g.code) ?? { g, code: g.code, name: g.name, accounts: [], now: 0, last: 0 };
    const now = sign * r.final || 0, last = sign * r.last || 0;
    grp.accounts.push({ key: r.key, number: r.number, name: r.name, line_no: r.line_no, now, last });
    grp.now += now; grp.last += last;
    groups.set(g.code, grp);
  }
  const list: StmtGroup[] = [...groups.values()].sort((a, b) => groupSort(a.g, b.g)).map((x) => ({ code: x.code, name: x.name, accounts: x.accounts, now: x.now, last: x.last }));
  for (const g of list) g.accounts.sort(byNumber);
  return { title, groups: list, now: list.reduce((n, g) => n + g.now, 0), last: list.reduce((n, g) => n + g.last, 0) };
}

export function statements(tbAll: TbLine[], info: (line_no: string | null) => LineInfo | null): Statements {
  const tb = tbAll.filter((r) => r.key !== NI_LAST);
  const typed = (t: string) => tb.filter((r) => info(r.line_no)?.type === t);
  const revenue = section("Revenue", typed("Revenue"), -1, info);
  const expenses = section("Expenses", typed("Expense"), 1, info);
  const net = { now: revenue.now - expenses.now, last: revenue.last - expenses.last };
  const assets = section("Assets", typed("Asset"), 1, info);
  const liabilities = section("Liabilities", typed("Liability"), -1, info);
  const equity = section("Equity", typed("Equity"), -1, info, ["SC", "RE", "PPA", "DIV"]);
  // Accounts without a GIFI line yet (not yet coded, opening balances to enter, not mapped).
  const open = section("Not yet sorted", tb.filter((r) => !info(r.line_no)), -1, info);
  const unsorted = open.groups.length && (open.now || open.last) ? open : null;
  // Last year's net income on the balance sheet: whatever ties last year's closing balances. It equals
  // the income statement's when Schedule 125 was entered, and the T2's 9999 when it was typed instead.
  const tiedLast = assets.last - liabilities.last - equity.last - (unsorted?.last ?? 0);
  const lastFromT2 = tiedLast !== net.last;
  if (lastFromT2) net.last = tiedLast;
  equity.groups.splice(equity.groups.findIndex((g) => g.code === "DIV"), 0, { code: NET_INCOME, name: "Net income", accounts: [], now: net.now, last: net.last });
  equity.now += net.now; equity.last += net.last;
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

// The box at the end of the journal (reference page 3): net income before entries, the adjusting and
// tax entries, the reclassifying entries (always nil: an RJE cannot change the result), adjusted net income.
export type NetIncomeBox = { before: number; adjust: number; reclass: number; after: number };
export function netIncomeBox(accounts: RepAccount[], postings: Posting[], info: (l: string | null) => LineInfo | null): NetIncomeBox {
  const line = new Map(directory(accounts, postings).entries());
  let after = 0, adjust = 0, reclass = 0;
  for (const p of postings) {
    const t = info(line.get(p.key)?.line_no ?? null)?.type;
    if (t !== "Revenue" && t !== "Expense") continue;
    after -= p.cents;
    if (p.kind === "entry") { if (p.entryKind === "RJE") reclass -= p.cents; else adjust -= p.cents; }
  }
  return { before: after - adjust - reclass, adjust, reclass, after };
}

// An entry's number: the year-end year and its order of creation, with its type (2026-001 AJE).
export const entryNo = (yearEnd: string, e: { seq: number; kind: string }) => `${yearEnd.slice(0, 4)}-${String(e.seq).padStart(3, "0")} ${e.kind}`;

export const KIND_LABEL: Record<PostingKind, string> = { opening: "Opening balance", bank: "Bank line", entry: "Adjusting entry", import: "Trial balance import" };
