// Closebook step 3 "Bank statements" (round 22, Hashim, Nov 16, 2026; mock approved). Pure, in cents, so the
// screens and the tests share one set of rules. Benchmarks: QuickBooks Online Banking (one card per account,
// "Add an account", "Upload from file" in a window) and CaseWare Cloud (each account under its GIFI line,
// tied to last year).
// - Account placement and numbers, as the database does it (cb_bank_placement, cb_bank_number).
// - The year cut-off on a statement: lines inside the year import (cards by the purchase date); the balance
//   at each year edge worked out from the statement.
// - The upload list's status for each statement, the coverage strip, the tie to step 2, the year-edge
//   differences, possible accounts not set up, and the one "Next:" action.

import { signedCents, type StatementAccount, type StatementLine } from "../statements/types.ts";

// ---------- Accounts: types, placement, names
export type AccountType = "chequing" | "savings" | "card" | "loc" | "loan";
export const TYPE_LABEL: Record<AccountType, string> = { chequing: "Chequing", savings: "Savings", card: "Credit card", loc: "Line of credit", loan: "Loan" };
export type Placement = { stdName: string; chart: string; base: string; gifi: string; gifiName: string; kind: "bank" | "card" };

// Decisions 2 and 3 (Nov 16, 2026). gifi is the GIFI line; base the first number tried.
export function placement(type: AccountType, longTerm: boolean): Placement {
  const lt = longTerm && (type === "loc" || type === "loan");
  if (type === "chequing") return { stdName: "Chequing", chart: "10000", base: "10000", gifi: "1002", gifiName: "Deposits in Canadian banks", kind: "bank" };
  if (type === "savings") return { stdName: "Savings", chart: "10100", base: "10100", gifi: "1002", gifiName: "Deposits in Canadian banks", kind: "bank" };
  if (type === "card") return { stdName: "Credit card", chart: "22000", base: "22000", gifi: "2707", gifiName: "Credit card loans", kind: "card" };
  if (type === "loc") return lt ? { stdName: "Line of credit", chart: "25200", base: "25300", gifi: "3149", gifiName: "Line of credit (long-term)", kind: "card" }
    : { stdName: "Line of credit", chart: "22100", base: "22100", gifi: "2701", gifiName: "Loans from Canadian banks", kind: "card" };
  return lt ? { stdName: "Bank loan", chart: "25000", base: "25000", gifi: "3143", gifiName: "Chartered bank loan", kind: "card" }
    : { stdName: "Loan", chart: "22100", base: "22110", gifi: "2701", gifiName: "Loans from Canadian banks", kind: "card" };
}

// The number the database will give: the base if free, else +10 past every chart number and number taken.
export function nextNumber(base: string, chartNumbers: Set<string>, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = Number(base) + 10;
  while (chartNumbers.has(String(n)) || taken.has(String(n))) n += 10;
  return String(n);
}

export const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
export const accountName = (type: AccountType, longTerm: boolean, bank: string, last4: string) =>
  `${placement(type, longTerm).stdName} · ${bank.trim().replace(/\s+/g, " ")} ••• ${digitsOnly(last4)}`;
// Everywhere in Closebook (point 25): "10000 Chequing · MDB ••• 2201".
export const accountLabel = (a: { number: string; name: string }) => `${a.number} ${a.name}`;

// ---------- Money
export const fmt = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
export const toCents = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100));

// ---------- The year cut-off on one statement account
export type YearCut = {
  inYear: StatementLine[]; before: StatementLine[]; after: StatementLine[];
  crossesStart: boolean; crossesEnd: boolean; outside: boolean;
  atStart: number | null;     // the balance at the end of the day before the year starts, from this statement
  atEnd: number | null;       // the balance at the end of the year's last day, from this statement
};
// Cards: the line's date is the transaction (purchase) date (decision 1); the posting date is not used here.
export function yearCut(acc: StatementAccount, yearStart: string, yearEnd: string): YearCut {
  const before = acc.lines.filter((l) => l.date < yearStart), after = acc.lines.filter((l) => l.date > yearEnd);
  const inYear = acc.lines.filter((l) => l.date >= yearStart && l.date <= yearEnd);
  const outside = acc.periodEnd < yearStart || acc.periodStart > yearEnd;
  const crossesStart = !outside && acc.periodStart < yearStart && acc.periodEnd >= yearStart;
  const crossesEnd = !outside && acc.periodEnd > yearEnd && acc.periodStart <= yearEnd;
  const sum = (ls: StatementLine[]) => ls.reduce((n, l) => n + signedCents(l), 0);
  const atStart = outside || acc.periodStart > yearStart ? null : acc.periodStart === yearStart ? acc.opening : acc.opening + sum(before);
  const atEnd = outside || acc.periodEnd < yearEnd ? null : acc.opening + sum(acc.lines.filter((l) => l.date <= yearEnd));
  return { inYear, before, after, crossesStart, crossesEnd, outside, atStart, atEnd };
}

// ---------- The card summary check (point 17): previous + purchases + interest + fees - payments = new
export function cardSummary(acc: StatementAccount, inTotal: number, outTotal: number) {
  const s = acc.summary;
  const interest = s?.interest ?? 0, fees = s?.fees ?? 0;
  const purchases = inTotal - interest - fees;
  return { previous: acc.opening, purchases, interest, fees, payments: outTotal, newBalance: acc.closing,
    ties: acc.opening + purchases + interest + fees - outTotal === acc.closing };
}

// ---------- The upload list's status (point 9)
export type FileAccount = { id: string; number: string; name: string; kind: "bank" | "card"; last4: string | null };
export type UploadStatus = "reading" | "ready" | "needs_look" | "outside" | "already" | "copy" | "wrong_account" | "no_account" | "no_digits" | "failed" | "skipped" | "imported";
// One short word per row (round 22 fixes); the reason shows on its own line only when something is wrong.
export const UPLOAD_LABEL: Record<UploadStatus, string> = {
  reading: "Reading", ready: "Ready to check", needs_look: "Needs a look", outside: "Outside the year", already: "Already imported", copy: "Copy",
  wrong_account: "Wrong account", no_account: "Wrong account", no_digits: "Needs a look", failed: "Failed", skipped: "Skipped", imported: "Imported",
};
export type UploadRowIn = { id: string; status: string; period_start: string | null; period_end: string | null; found: { name: string; last4: string; kind: "bank" | "card" }[];
  file_sha256?: string | null; target_account?: string | null; created_at?: string };
export type UploadState = { status: UploadStatus; match: FileAccount | null; other: FileAccount | null; reason: string };

const digitsMatch = (a: string, b: string) => !!a && !!b && (a.endsWith(b) || b.endsWith(a));
// The file's account a statement's last digits belong to (exactly one), or null.
export function accountFor(last4: string, accounts: FileAccount[]): FileAccount | null {
  const d = digitsOnly(last4);
  if (d.length < 2) return null;
  const m = accounts.filter((a) => digitsMatch(digitsOnly(a.last4), d));
  return m.length === 1 ? m[0] : null;
}

export function uploadState(r: UploadRowIn, ctx: { yearStart: string; yearEnd: string; accounts: FileAccount[]; target: FileAccount | null;
  importedShas: Set<string>; importedPeriods: { account_id: string; period_start: string; period_end: string }[]; copies?: Set<string> }): UploadState {
  const none = { match: null, other: null, reason: "" };
  if (ctx.copies?.has(r.id)) return { status: "copy", ...none, reason: "Another copy of this statement is already in the list. Remove this one." };
  if (r.status === "queued" || r.status === "reading" || r.status === "uploading") return { status: "reading", ...none };
  if (r.status === "failed") return { status: "failed", ...none };
  if (r.status === "imported") return { status: "imported", ...none };
  if (r.status === "skipped") return { status: "skipped", ...none };
  if (r.period_start && r.period_end && (r.period_end < ctx.yearStart || r.period_start > ctx.yearEnd)) return { status: "outside", ...none };
  if (r.file_sha256 && ctx.importedShas.has(r.file_sha256)) return { status: "already", ...none, reason: "The same file is already imported." };
  const found = r.found ?? [];
  // Point 13: the statement must be for the account it was uploaded to.
  const mine = ctx.target ? found.some((f) => digitsMatch(digitsOnly(ctx.target!.last4), digitsOnly(f.last4))) : false;
  if (ctx.target && !mine) {
    if (found.length && found.every((f) => !digitsOnly(f.last4))) return { status: "no_digits", ...none, reason: "The statement prints no last digits. Check it is for this account." };
    const other = found.map((f) => accountFor(f.last4, ctx.accounts)).find((a) => a && a.id !== ctx.target!.id) ?? null;
    if (other) return { status: "wrong_account", match: null, other, reason: `It is for ${accountLabel(other)}.` };
    const f = found.find((x) => digitsOnly(x.last4));
    return { status: "no_account", match: null, other: null, reason: f ? `No account in this file ends in ${digitsOnly(f.last4)}.` : "" };
  }
  const match = ctx.target ?? found.map((f) => accountFor(f.last4, ctx.accounts)).find(Boolean) ?? null;
  if (!ctx.target && !match) {
    if (found.length && found.every((f) => !digitsOnly(f.last4))) return { status: "no_digits", ...none, reason: "The statement prints no last digits. Choose the account it is for." };
    const f = found.find((x) => digitsOnly(x.last4));
    return { status: "no_account", match: null, other: null, reason: f ? `No account in this file ends in ${digitsOnly(f.last4)}.` : "" };
  }
  // Point 14: the same period already imported for the account. Sharing one day is not the same period:
  // some banks print the day a statement ends as the first day of the next (round 22 fixes).
  if (match && r.period_start && r.period_end && ctx.importedPeriods.some((p) => p.account_id === match.id && p.period_start < r.period_end! && p.period_end > r.period_start!)) {
    return { status: "already", match, other: null, reason: "A statement for this period is already imported." };
  }
  return { status: r.status === "ready" ? "ready" : "needs_look", match, other: null, reason: "" };
}

// One copy of each statement (round 22 fixes): uploads not imported that are the same statement as an earlier one
// in the list (the same file, or the same account and period). The earliest stays; the ids returned are the others.
export function copiesOf(rows: (UploadRowIn & { created_at: string })[]): Set<string> {
  const open = rows.filter((r) => ["queued", "reading", "ready", "needs_look"].includes(r.status)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const digits = (r: UploadRowIn) => (r.found ?? []).map((f) => digitsOnly(f.last4).slice(-4)).filter((d) => d.length >= 2);
  const out = new Set<string>();
  open.forEach((r, i) => {
    if (open.slice(0, i).some((o) => !out.has(o.id) && ((r.file_sha256 && o.file_sha256 === r.file_sha256)
      || (r.period_start && o.period_start === r.period_start && o.period_end === r.period_end && (!o.target_account || !r.target_account || o.target_account === r.target_account)
        && digits(r).some((d) => digits(o).includes(d)))))) out.add(r.id);
  });
  return out;
}

// ---------- Coverage strip (point 2): bank months, or a card's own cycles
// Four states only (round 22 fixes, Hashim, Nov 16, 2026): green covered, red missing, amber waiting to check,
// grey outside the year (or before the account opened, after it closed).
export type Cell = { label: string; from: string; to: string; state: "in" | "missing" | "wait" | "na" };
const DAY = 86400000;
const toDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const addMonth = (s: string, k: number) => { const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1 + k, +s.slice(8, 10))); return t.toISOString().slice(0, 10); };
export type CovStatement = { period_start: string; period_end: string; opening: number; closing: number };

// pending: statements uploaded and waiting to check (amber); they also tell a card's cycle before any import.
export function coverageStrip(yearStart: string, yearEnd: string, sts: CovStatement[], window: { opened?: string | null; closed?: string | null } = {},
  pending: { period_start: string; period_end: string }[] = []): { cells: Cell[]; gaps: Gap[]; cycleDay: number } {
  const sorted = [...sts].sort((a, b) => a.period_start.localeCompare(b.period_start));
  // The cycle: the day the statements start on (1 = calendar months).
  const days = [...sorted, ...pending].map((s) => +s.period_start.slice(8, 10));
  const cycleDay = days.length ? days.sort((a, b) => days.filter((x) => x === a).length - days.filter((x) => x === b).length).pop()! : 1;
  const raw: { from: string; to: string; name: string }[] = [];
  let from = cycleDay === 1 ? yearStart.slice(0, 8) + "01" : `${yearStart.slice(0, 7)}-${String(Math.min(cycleDay, 28)).padStart(2, "0")}`;
  if (from > yearStart) from = addMonth(from, -1);
  while (from <= yearEnd) {
    const to = fromDay(toDay(addMonth(from, 1)) - 1);
    // Named by the month it starts in; a cycle starting after mid-month by the month it ends in.
    raw.push({ from: from < yearStart ? yearStart : from, to: to > yearEnd ? yearEnd : to, name: cycleDay > 15 ? to : from });
    from = addMonth(from, 1);
  }
  // A sliver of a cycle at either end of the year joins its neighbour (so a year has 12 cells, not 13).
  const len = (c: { from: string; to: string }) => toDay(c.to) - toDay(c.from) + 1;
  if (raw.length > 1 && len(raw[0]) < 15) { raw[1].from = raw[0].from; raw.shift(); }   // keeps its neighbour's name
  if (raw.length > 1 && len(raw[raw.length - 1]) < 15) { raw[raw.length - 2].to = raw[raw.length - 1].to; raw.pop(); }
  const winFrom = window.opened && window.opened > yearStart ? window.opened : yearStart;
  const winTo = window.closed && window.closed < yearEnd ? window.closed : yearEnd;
  const gaps = winFrom <= winTo ? gapSegments(sorted, winFrom, winTo) : [];
  const meets = (a1: string, b1: string, a2: string, b2: string) => a1 <= b2 && b1 >= a2;
  const cells: Cell[] = raw.map((c) => {
    const cell: Cell = { label: MON[+c.name.slice(5, 7) - 1], from: c.from, to: c.to, state: "in" };
    if (!meets(c.from, c.to, winFrom, winTo)) return { ...cell, state: "na" };
    const hit = gaps.filter((g) => g.kind === "missing" ? meets(c.from, c.to, g.from, g.to) : g.from >= c.from && g.from <= c.to);
    if (!hit.length) return cell;
    // Amber when an upload waiting to check covers what is missing in this cell.
    const waiting = hit.every((g) => { const a = g.from > c.from ? g.from : c.from, b = g.to < c.to ? g.to : c.to; return pending.some((x) => meets(x.period_start, x.period_end, a, b)); });
    return { ...cell, state: waiting ? "wait" : "missing" };
  });
  return { cells, gaps, cycleDay };
}
export const monthName = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
export const longDate = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;

// ---------- The year edges (point 22): the statements' balance beside the books, explained by outstanding items
export type Outstanding = { id: string; account_id: string; edge: "start" | "end"; item_date: string; description: string; dir: "in" | "out"; amount: number; cleared_line: string | null;
  kind?: "item" | "rounding" };
export type Edge = { statements: number | null; books: number | null; items: number; difference: number | null; explained: boolean };
// In the account's own terms (a bank's money; what is owed on a card). An "in" item raises the statement's
// balance (a deposit, or a card charge): books = statements + in items - out items.
export function edge(statements: number | null, books: number | null, items: Outstanding[]): Edge {
  const sum = items.reduce((n, i) => n + (i.dir === "in" ? i.amount : -i.amount), 0);
  if (statements === null || books === null) return { statements, books, items: sum, difference: null, explained: true };
  const difference = books - statements;
  return { statements, books, items: sum, difference, explained: difference === sum };
}

// ---------- The tie to step 2 (point 4), per GIFI line
export type TieAccount = { number: string; gifi: string; books: number | null };
// The T2 is in whole dollars: a line within 1.00 ties, and the cents show as rounding (round 22 fixes).
export type Tie = { gifi: string; numbers: string[]; books: number; t2: number; ties: boolean; rounding: number };
export function ties(accounts: TieAccount[], t2: Map<string, number>, entered: boolean): Tie[] {
  if (!entered) return [];
  const by = new Map<string, TieAccount[]>();
  for (const a of accounts) by.set(a.gifi, [...(by.get(a.gifi) ?? []), a]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([gifi, as]) => {
    const books = as.reduce((n, a) => n + (a.books ?? 0), 0), t = t2.get(gifi) ?? 0;
    return { gifi, numbers: as.map((a) => a.number).sort(), books, t2: t, ties: Math.abs(books - t) < 100, rounding: Math.abs(books - t) < 100 ? books - t : 0 };
  });
}

// ---------- Possible accounts not set up (point 18): payments to a card the file does not have
export type Possible = { last4: string; label: string; count: number; example: { date: string; description: string; cents: number } };
const CARD_WORD = /\b(MC|MASTERCARD|VISA|AMEX|AMERICAN EXPRESS|CARD|LOC|LINE OF CREDIT)\b[\s#*•.-]*(\d{4})\b/i;
export function possibleAccounts(lines: { date: string; description: string; cents: number; bank: boolean }[], accounts: FileAccount[], notOurs: Set<string>): Possible[] {
  const out = new Map<string, Possible>();
  for (const l of lines) {
    if (!l.bank || l.cents >= 0) continue;
    const m = CARD_WORD.exec(l.description);
    if (!m) continue;
    const d = m[2];
    if (notOurs.has(d) || accounts.some((a) => digitsMatch(digitsOnly(a.last4), d))) continue;
    const word = m[1].toUpperCase();
    const label = `${word === "MASTERCARD" ? "MC" : word === "AMERICAN EXPRESS" ? "AMEX" : word} ••• ${d}`;
    const p = out.get(d);
    if (p) p.count++;
    else out.set(d, { last4: d, label, count: 1, example: { date: l.date, description: l.description, cents: -l.cents } });
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

// ---------- The to-do list (round 22 correction, Hashim, Nov 16, 2026): the Next bar is the only to-do list on
// the page. Its first item is the "Next:" line; "Show all" opens the whole list, each item with its own button.
// The order: accounts, statements to check, gaps, the tie to step 2, the year edges, possible accounts, sign.
export type TodoKind = "add" | "books" | "check" | "wrong" | "failed" | "none" | "gap" | "tie" | "edge" | "possible" | "reading" | "sign" | "done";
export type Todo = { key: string; kind: TodoKind; text: string; account?: string | null; edge?: "start" | "end"; possible?: Possible };
export type TodoFacts = {
  accounts: { id: string; label: string; statements: number; gaps: number; books: number | null; reason: boolean;
    start: Edge; end: Edge; startDay: string; endDay: string }[];
  waiting: { account: string | null; label: string | null; n: number }[];   // statements ready or needing a look, per account
  reading: number; failed: number; wrong: number; ties: Tie[]; possible: Possible[]; signed: boolean;
};
const s_ = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export function todoList(f: TodoFacts): Todo[] {
  const out: Todo[] = [];
  if (!f.accounts.length) return [{ key: "add", kind: "add", text: "Add the bank and card accounts. Start with the ones on last year's T2." }];
  for (const a of f.accounts) if (a.books === null) out.push({ key: `books-${a.id}`, kind: "books", account: a.id, text: `Enter the balance in the books for ${a.label}.` });
  for (const w of [...f.waiting].filter((x) => x.n).sort((x, y) => y.n - x.n)) {
    out.push({ key: `check-${w.account ?? "all"}`, kind: "check", account: w.account, text: `Check ${s_(w.n, "statement")}${w.label ? ` for ${w.label}` : ""}.` });
  }
  if (f.wrong) out.push({ key: "wrong", kind: "wrong", text: `Move ${s_(f.wrong, "statement")} uploaded to the wrong account.` });
  if (f.failed) out.push({ key: "failed", kind: "failed", text: `Retry or remove ${s_(f.failed, "statement")} that could not be read.` });
  for (const a of f.accounts) {
    if (a.reason) continue;
    if (!a.statements) out.push({ key: `none-${a.id}`, kind: "none", account: a.id, text: `Upload statements for ${a.label}, or record why there are none.` });
    else if (a.gaps) out.push({ key: `gap-${a.id}`, kind: "gap", account: a.id,
      text: `${a.label} has ${s_(a.gaps, "gap")} in its statements. Upload the missing ${a.gaps === 1 ? "statement" : "statements"}, or record why.` });
  }
  for (const t of f.ties) if (!t.ties) out.push({ key: `tie-${t.gifi}`, kind: "tie",
    text: `GIFI ${t.gifi}: the accounts open at ${fmt(t.books)}, last year's T2 has ${fmt(t.t2)}, a difference of ${fmt(Math.abs(t.books - t.t2))}. Check each account's balance in the books, or step 2.` });
  for (const a of f.accounts) for (const [k, e, day] of [["start", a.start, a.startDay], ["end", a.end, a.endDay]] as const) {
    if (!e.explained && e.difference !== null) out.push({ key: `edge-${k}-${a.id}`, kind: "edge", account: a.id, edge: k,
      text: `${a.label}: the statements show ${fmt(e.statements!)} on ${day} and the books ${fmt(e.books!)}. Explain the difference of ${fmt(Math.abs(e.difference - e.items))}.` });
  }
  for (const p of f.possible) out.push({ key: `possible-${p.last4}`, kind: "possible", possible: p,
    text: `Possible account not set up: ${p.label}. ${s_(p.count, "payment")} from a bank account go${p.count === 1 ? "es" : ""} to it, for example ${longDate(p.example.date)} "${p.example.description}" ${fmt(p.example.cents)}.` });
  if (f.reading) out.push({ key: "reading", kind: "reading", text: `Wait for ${s_(f.reading, "statement")} still reading.` });
  if (!out.length) out.push(f.signed ? { key: "done", kind: "done", text: "Step 3 is signed. Go on to step 4, Code transactions." } : { key: "sign", kind: "sign", text: "Sign as preparer." });
  return out;
}

// ---------- Gaps (point 6; round 22 fixes): one red row per gap, quoting the statement just before it and the
// one just after. A gap is a run of days no statement covers (two statements that share a day, as some banks
// print, leave none), or a break: two statements that meet but the opening is not the closing before.
export type Gap = { kind: "missing" | "break"; from: string; to: string; after: CovStatement | null; before: CovStatement | null; waiting?: { id: string; file_name: string } | null };
export function gapSegments(sts: CovStatement[], winFrom: string, winTo: string): Gap[] {
  const sorted = [...sts].sort((a, b) => a.period_start.localeCompare(b.period_start) || a.period_end.localeCompare(b.period_end));
  const out: Gap[] = [];
  const end = toDay(winTo);
  let at = toDay(winFrom);
  for (const s of sorted) {
    if (at > end) break;
    const a = toDay(s.period_start), b = toDay(s.period_end);
    if (b < at) continue;
    if (a > at) out.push({ kind: "missing", from: fromDay(at), to: fromDay(Math.min(a - 1, end)), after: null, before: null });
    at = Math.max(at, b + 1);
  }
  if (at <= end) out.push({ kind: "missing", from: fromDay(at), to: winTo, after: null, before: null });
  for (const g of out) {
    g.after = sorted.filter((x) => x.period_end < g.from).sort((x, y) => x.period_end.localeCompare(y.period_end)).pop() ?? null;
    g.before = sorted.find((x) => x.period_start > g.to) ?? null;
  }
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i - 1], n = sorted[i];
    if (n.opening === p.closing || n.period_start > winTo || p.period_end < winFrom) continue;
    if (out.some((g) => g.after === p && g.before === n)) continue;   // the missing row already quotes both
    out.push({ kind: "break", from: n.period_start, to: n.period_start, after: p, before: n });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

// ---------- One status word per card (point 3)
export type CardStatus = { word: string; tone: "ok" | "warn" | "bad" | "" };
export function cardStatus(a: { waiting: number; gaps: number; notExplained: boolean; books: number | null; statements: number; reason: boolean }): CardStatus {
  if (a.waiting) return { word: `${a.waiting} to check`, tone: "warn" };
  if (a.gaps) return { word: `${a.gaps} gap${a.gaps === 1 ? "" : "s"}`, tone: "bad" };
  if (a.books === null) return { word: "No balance", tone: "bad" };
  if (a.notExplained) return { word: "Not explained", tone: "bad" };
  if (!a.statements && !a.reason) return { word: "None yet", tone: "" };
  return { word: "Complete", tone: "ok" };
}
