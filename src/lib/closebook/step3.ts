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
export type UploadStatus = "reading" | "ready" | "needs_look" | "outside" | "already" | "wrong_account" | "no_account" | "no_digits" | "failed" | "skipped" | "imported";
export const UPLOAD_LABEL: Record<UploadStatus, string> = {
  reading: "Reading", ready: "Ready to check", needs_look: "Needs a look", outside: "Outside the year: not needed", already: "Already imported",
  wrong_account: "Wrong account", no_account: "Wrong account", no_digits: "Needs a look", failed: "Failed", skipped: "Skipped", imported: "Imported",
};
export type UploadRowIn = { id: string; status: string; period_start: string | null; period_end: string | null; found: { name: string; last4: string; kind: "bank" | "card" }[];
  file_sha256?: string | null; target_account?: string | null };
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
  importedShas: Set<string>; importedPeriods: { account_id: string; period_start: string; period_end: string }[] }): UploadState {
  const none = { match: null, other: null, reason: "" };
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
  // Point 14: the same period already imported for the account.
  if (match && r.period_start && r.period_end && ctx.importedPeriods.some((p) => p.account_id === match.id && p.period_start <= r.period_end! && p.period_end >= r.period_start!)) {
    return { status: "already", match, other: null, reason: "A statement for this period is already imported." };
  }
  return { status: r.status === "ready" ? "ready" : "needs_look", match, other: null, reason: "" };
}

// ---------- Coverage strip (point 2): bank months, or a card's own cycles
export type Cell = { label: string; from: string; to: string; state: "in" | "part" | "missing" | "check" | "na" | "wait" };
const DAY = 86400000;
const toDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const addMonth = (s: string, k: number) => { const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1 + k, +s.slice(8, 10))); return t.toISOString().slice(0, 10); };
export type CovStatement = { period_start: string; period_end: string; opening: number; closing: number };

// pending: statements uploaded and waiting to check (yellow); they also tell a card's cycle before any import.
export function coverageStrip(yearStart: string, yearEnd: string, sts: CovStatement[], window: { opened?: string | null; closed?: string | null } = {},
  pending: { period_start: string; period_end: string }[] = []): { cells: Cell[]; missing: Cell[]; breaks: { after: CovStatement; before: CovStatement }[]; cycleDay: number } {
  const sorted = [...sts].sort((a, b) => a.period_start.localeCompare(b.period_start));
  // The cycle: the day the statements start on (1 = calendar months).
  const days = [...sorted, ...pending].map((s) => +s.period_start.slice(8, 10));
  const cycleDay = days.length ? days.sort((a, b) => days.filter((x) => x === a).length - days.filter((x) => x === b).length).pop()! : 1;
  const cells: Cell[] = [];
  let from = cycleDay === 1 ? yearStart.slice(0, 8) + "01" : `${yearStart.slice(0, 7)}-${String(cycleDay).padStart(2, "0")}`;
  if (from > yearStart) from = addMonth(from, -1);
  while (from <= yearEnd) {
    const to = fromDay(toDay(addMonth(from, 1)) - 1);
    const end = to;
    cells.push({ label: MON[+end.slice(5, 7) - 1], from: from < yearStart ? yearStart : from, to: to > yearEnd ? yearEnd : to, state: "missing" });
    from = addMonth(from, 1);
  }
  const spans = sorted.map((s) => [toDay(s.period_start), toDay(s.period_end)] as const);
  const covered = (a: number, b: number) => {
    let at = a;
    for (const [x, y] of spans) { if (x > at) break; if (y >= at) at = y + 1; if (at > b) return "all"; }
    return spans.some(([x, y]) => x <= b && y >= a) ? "some" : "none";
  };
  const breaks: { after: CovStatement; before: CovStatement }[] = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i].opening !== sorted[i - 1].closing) breaks.push({ after: sorted[i - 1], before: sorted[i] });
  for (const c of cells) {
    const a = Math.max(toDay(c.from), window.opened ? toDay(window.opened) : -Infinity), b = Math.min(toDay(c.to), window.closed ? toDay(window.closed) : Infinity);
    if (a > b) { c.state = "na"; continue; }
    const k = covered(a, b);
    c.state = k === "all" ? "in" : k === "some" ? "part" : "missing";
    if (c.state !== "in" && pending.some((x) => toDay(x.period_start) <= b && toDay(x.period_end) >= a)) c.state = "wait";
    if (c.state !== "missing" && breaks.some((x) => x.before.period_start >= c.from && x.before.period_start <= c.to)) c.state = "check";
  }
  return { cells, missing: cells.filter((c) => c.state === "missing" || c.state === "part"), breaks, cycleDay };
}
export const monthName = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
export const longDate = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;

// ---------- The year edges (point 22): the statements' balance beside the books, explained by outstanding items
export type Outstanding = { id: string; account_id: string; edge: "start" | "end"; item_date: string; description: string; dir: "in" | "out"; amount: number; cleared_line: string | null };
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
export type Tie = { gifi: string; numbers: string[]; books: number; t2: number; ties: boolean };
export function ties(accounts: TieAccount[], t2: Map<string, number>, entered: boolean): Tie[] {
  if (!entered) return [];
  const by = new Map<string, TieAccount[]>();
  for (const a of accounts) by.set(a.gifi, [...(by.get(a.gifi) ?? []), a]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([gifi, as]) => {
    const books = as.reduce((n, a) => n + (a.books ?? 0), 0), t = t2.get(gifi) ?? 0;
    return { gifi, numbers: as.map((a) => a.number).sort(), books, t2: t, ties: books === t };
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

// ---------- The "Next:" line (point 1): one action, in this order
export type NextFacts = {
  accounts: { id: string; label: string; statements: number; missing: string[]; breaks: number; books: number | null; reason: boolean; edgeOff: boolean }[];
  waiting: { account: string | null; label: string | null; n: number }[];   // statements ready or needing a look, per account
  reading: number; failed: number; wrong: number; tiesOff: string[]; possible: number; signed: boolean;
};
export type Next = { text: string; action: "add" | "check" | "upload" | "books" | "gap" | "tie" | "edge" | "failed" | "wrong" | "possible" | "sign" | "done"; account?: string };
export function nextAction(f: NextFacts): Next {
  if (!f.accounts.length) return { text: "add the bank and card accounts. Start with the one on last year's T2.", action: "add" };
  const noBooks = f.accounts.find((a) => a.books === null);
  if (noBooks) return { text: `enter the balance in the books for ${noBooks.label}.`, action: "books", account: noBooks.id };
  const w = [...f.waiting].sort((a, b) => b.n - a.n)[0];
  if (w && w.n) return { text: `check ${w.n} statement${w.n === 1 ? "" : "s"}${w.label ? ` for ${w.label}` : ""}.`, action: "check", account: w.account ?? undefined };
  if (f.wrong) return { text: `move ${f.wrong} statement${f.wrong === 1 ? "" : "s"} uploaded to the wrong account.`, action: "wrong" };
  if (f.failed) return { text: `retry or remove ${f.failed} statement${f.failed === 1 ? "" : "s"} that could not be read.`, action: "failed" };
  const none = f.accounts.find((a) => !a.statements && !a.reason);
  if (none) return { text: `upload statements for ${none.label}.`, action: "upload", account: none.id };
  const gap = f.accounts.find((a) => a.missing.length && !a.reason);
  if (gap) return { text: `upload ${gap.missing.length === 1 ? `the ${gap.missing[0]} statement` : `${gap.missing.length} missing statements`} for ${gap.label}, or record why there is none.`, action: "gap", account: gap.id };
  const br = f.accounts.find((a) => a.breaks);
  if (br) return { text: `a statement for ${br.label} does not follow the one before. Look for a missing statement.`, action: "gap", account: br.id };
  if (f.tiesOff.length) return { text: `fix the difference on GIFI ${f.tiesOff.join(" and ")}: check each account's balance in the books, or last year's T2 in step 2.`, action: "tie" };
  const ed = f.accounts.find((a) => a.edgeOff);
  if (ed) return { text: `explain the year-edge difference on ${ed.label} with outstanding items.`, action: "edge", account: ed.id };
  if (f.reading) return { text: `wait for ${f.reading} statement${f.reading === 1 ? "" : "s"} still reading.`, action: "check" };
  if (f.possible) return { text: "look at the possible account not set up below: add it, or mark it Not ours.", action: "possible" };
  if (!f.signed) return { text: "sign as preparer.", action: "sign" };
  return { text: "step 3 is signed. Go on to step 4, Code transactions.", action: "done" };
}
