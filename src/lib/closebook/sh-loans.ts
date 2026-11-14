// Round 14: the shareholder loan schedule, with the s.15(2) repayment date.
// Benchmark: CaseWare's shareholder loan continuity working paper. One continuity per account on a due to
// or due from shareholder line: opening balance, the year's movements grouped by kind (each drills to its
// postings), closing balance, and the tie to the trial balance. Signs: debit positive, so a positive
// balance is what the shareholder owes the company.
//
// The s.15(2) test is on each shareholder's accounts together (Hashim, Nov 14, 2026, fix 2): the net of
// the shareholder's due to and due from accounts. A net debit at year end is split by when it arose,
// repayments going against the oldest balance first (fix 1): last year's part (its s.15(2) date, this
// year end, has passed: the reviewer) and this year's part (its date is next year end: My day).
import type { Posting } from "./tb-build";

export const SH_LINES = ["1301", "1302", "1303", "2780", "2781", "2782", "2783", "3260", "3261", "3262", "3263"];
export const isShLine = (line_no: string | null | undefined) => !!line_no && SH_LINES.includes(line_no.slice(0, 4));
// GIFI lines whose entries credit the shareholder: dividends declared (3700 to 3719) and salary or bonus.
const DIVIDEND = (g: number) => g >= 3700 && g <= 3719;
const SALARY = new Set([9060, 9063, 9065, 9066]);
// The standard chart's shareholder accounts. Any other account on a shareholder line is picked by the
// preparer on the schedule, and the choice rolls forward to the client's next file.
export const CHART_SHAREHOLDER: Record<string, number> = { "chart:13000": 1, "chart:23000": 1, "chart:25400": 1, "chart:13050": 2, "chart:23050": 2 };

export type ShKind = "paid" | "repaid" | "expenses" | "dividends" | "salary" | "books" | "other";
export const KIND_LABEL: Record<ShKind, string> = {
  paid: "Paid to or for the shareholder",
  repaid: "Repaid by the shareholder",
  expenses: "Expenses paid personally",
  dividends: "Dividends credited",
  salary: "Salary or bonus credited",
  books: "Movement in the client's books",
  other: "Other entries",
};
export const KIND_ORDER: ShKind[] = ["paid", "repaid", "expenses", "dividends", "salary", "books", "other"];

export type ShAccountIn = { key: string; number: string; name: string; line_no: string | null; tbCents: number; lastCents: number };
export type ShEntryInfo = { origin: string | null; gifis: string[] };
export type ShItem = { date: string; kind: Posting["kind"]; ref: string; acct?: string; label: string; cents: number };
export type ShMovement = { kind: ShKind; label: string; cents: number; items: ShItem[] };
export type ShSchedule = {
  key: string; number: string; name: string; line_no: string;
  openingCents: number; openingItems: ShItem[]; movements: ShMovement[]; closingCents: number; tbCents: number; tied: boolean;
};
export type ShFlag = "earlier_debit" | "late_repayment";
export type ShGroup = {
  shareholder: number | null;          // null: an account whose shareholder is not picked yet
  keys: string[];
  openingCents: number; closingCents: number;
  reductionsCents: number; reductions: ShItem[];   // every reduction in the year, netted per posting across the shareholder's accounts
  lastPartCents: number;               // last year's part of the closing debit: its s.15(2) date (this year end) has passed
  thisPartCents: number;               // this year's part: s.15(2) date one year after this year end
  dueOn: string | null;
  // The balance owed at the start of the year, answered from this year's postings: repaid by its date or not.
  prior: { dueOn: string; openingCents: number; repaidCents: number; unpaidCents: number } | null;
  flags: ShFlag[];
  datesKnown: boolean;                 // own books give one line a year: the 30-day test needs dates
};

const money = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return `${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
export function flagText(flag: ShFlag, amountCents: number, yearEnd: string): string {
  return flag === "earlier_debit"
    ? `${money(amountCents)} of last year's balance was not repaid by ${longDate(yearEnd)}. s.15(2) may include it in the shareholder's income for the year the loan was made.`
    : "Check this is not a series of loans and repayments.";
}
export const shareholderLabel = (n: number | null) => (n ? `Shareholder ${n}` : "Shareholder not picked");

// One year after the given date (s.15(2.6)); February 29 falls back to February 28.
export function addYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
// A balance owed at the start of the year had its s.15(2) date one year after last year end.
export const priorDueOn = (yearStart: string) => addYear(addDays(yearStart, -1));

export function kindOf(p: Posting, entries: Map<string, ShEntryInfo>): ShKind | "opening" {
  if (p.kind === "opening") return "opening";
  if (p.kind === "import") return "books";
  if (p.kind === "bank") return p.cents > 0 ? "paid" : "repaid";
  const e = entries.get(p.ref);
  if (e?.origin === "expenses_personal") return "expenses";
  const g = (e?.gifis ?? []).map((x) => Number(x.slice(0, 4)));
  if (g.some(DIVIDEND)) return "dividends";
  if (g.some((x) => SALARY.has(x))) return "salary";
  return "other";
}

export type ShInput = { accounts: ShAccountIn[]; postings: Posting[]; entries: Map<string, ShEntryInfo>; own: boolean; yearEnd: string };

// The continuity of each account.
export function buildSchedules(inp: ShInput): ShSchedule[] {
  const out: ShSchedule[] = [];
  for (const a of inp.accounts.filter((x) => isShLine(x.line_no))) {
    const ps = inp.postings.filter((p) => p.key === a.key);
    const item = (p: Posting): ShItem => ({ date: p.date, kind: p.kind, ref: p.ref, acct: p.acct, label: p.label, cents: p.cents });
    const groups = new Map<ShKind, ShMovement>();
    const push = (k: ShKind, i: ShItem) => {
      const g = groups.get(k) ?? { kind: k, label: KIND_LABEL[k], cents: 0, items: [] };
      g.cents += i.cents; g.items.push(i); groups.set(k, g);
    };
    let openingCents = 0;
    const openingItems: ShItem[] = [];
    if (inp.own) {
      // The client's books: last year's closing opens the year; the year's movement in their books is one
      // line (this year's imported balance less last year's), and our entries follow by kind.
      openingCents = a.lastCents;
      if (a.lastCents) openingItems.push({ date: "", kind: "import", ref: "", label: "Last year's closing balance, from the trial balance import", cents: a.lastCents });
      const imported = ps.filter((p) => p.kind === "import").reduce((t, p) => t + p.cents, 0);
      if (imported - a.lastCents) push("books", { date: inp.yearEnd, kind: "import", ref: "books", label: "This year's balance in the client's books, less last year's", cents: imported - a.lastCents });
      for (const p of ps.filter((x) => x.kind === "entry")) push(kindOf(p, inp.entries) as ShKind, item(p));
    } else {
      for (const p of ps) {
        const k = kindOf(p, inp.entries);
        if (k === "opening") { openingCents += p.cents; openingItems.push(item(p)); } else push(k, item(p));
      }
    }
    const movements = KIND_ORDER.filter((k) => groups.has(k)).map((k) => {
      const g = groups.get(k)!;
      g.items.sort((x, y) => x.date.localeCompare(y.date));
      return g;
    });
    const closingCents = openingCents + movements.reduce((t, m) => t + m.cents, 0);
    out.push({ key: a.key, number: a.number, name: a.name, line_no: a.line_no ?? "", openingCents, openingItems, movements, closingCents, tbCents: a.tbCents, tied: closingCents === a.tbCents });
  }
  return out.sort((x, y) => x.number.localeCompare(y.number));
}

// Each shareholder's accounts together. owners: the shareholder of each account (null: not picked).
export function buildGroups(schedules: ShSchedule[], owners: Map<string, number | null>, o: { yearStart: string; yearEnd: string; windowDays: number; own: boolean }): ShGroup[] {
  const by = new Map<string, ShSchedule[]>();
  for (const s of schedules) {
    const n = owners.get(s.key) ?? null;
    const k = n === null ? `none:${s.key}` : `sh:${n}`;
    by.set(k, [...(by.get(k) ?? []), s]);
  }
  const out: ShGroup[] = [];
  for (const [k, list] of by) {
    const shareholder = k.startsWith("sh:") ? Number(k.slice(3)) : null;
    const openingCents = list.reduce((t, s) => t + s.openingCents, 0);
    const closingCents = list.reduce((t, s) => t + s.closingCents, 0);
    // Each posting netted across the shareholder's accounts (an entry moving an amount from 23000 to
    // 13000 is neither a loan nor a repayment); a net credit reduces what the shareholder owes.
    const moves = list.flatMap((s) => s.movements.flatMap((m) => m.items));
    const perRef = new Map<string, ShItem>();
    for (const i of moves) {
      const r = `${i.kind}:${i.ref || i.label}`;
      const x = perRef.get(r);
      if (x) x.cents += i.cents; else perRef.set(r, { ...i });
    }
    const netted = [...perRef.values()].sort((x, y) => x.date.localeCompare(y.date));
    const reductions = netted.filter((i) => i.cents < 0);
    const reductionsCents = -reductions.reduce((t, i) => t + i.cents, 0);
    const openingDebit = Math.max(0, openingCents), closingDebit = Math.max(0, closingCents);
    // Repayments go against the oldest balance first: last year's part is what is left of the opening
    // debit after every reduction in the year, never below nil and never more than the closing debit.
    const live = shareholder !== null;
    const lastPartCents = live ? Math.min(closingDebit, Math.max(0, openingDebit - reductionsCents)) : 0;
    const thisPartCents = live ? closingDebit - lastPartCents : 0;
    const flags: ShFlag[] = [];
    if (lastPartCents > 0) flags.push("earlier_debit");
    const datesKnown = !o.own;
    if (live && datesKnown && closingCents <= 0 && lateRepayment(openingCents, netted, o.yearEnd, o.windowDays)) flags.push("late_repayment");
    out.push({
      shareholder, keys: list.map((s) => s.key), openingCents, closingCents, reductionsCents, reductions,
      lastPartCents, thisPartCents, dueOn: thisPartCents > 0 ? addYear(o.yearEnd) : null,
      prior: live && openingDebit > 0 ? { dueOn: priorDueOn(o.yearStart), openingCents: openingDebit, repaidCents: openingDebit - lastPartCents, unpaidCents: lastPartCents } : null,
      flags, datesKnown,
    });
  }
  return out.sort((x, y) => (x.shareholder ?? 99) - (y.shareholder ?? 99) || x.keys[0].localeCompare(y.keys[0]));
}

// The 30-day flag: the balance ends the year at nil or in credit, but was in debit at some point in the
// last `days` days of the year (counting the balance at the end of the day the window opens).
export function lateRepayment(openingCents: number, movements: { date: string; cents: number }[], yearEnd: string, days: number): boolean {
  const from = addDays(yearEnd, -days);
  const sorted = [...movements].sort((x, y) => x.date.localeCompare(y.date));
  let bal = openingCents, i = 0;
  while (i < sorted.length && sorted[i].date <= from) bal += sorted[i++].cents;
  if (bal > 0) return true;
  while (i < sorted.length) {
    const d = sorted[i].date;
    while (i < sorted.length && sorted[i].date === d) bal += sorted[i++].cents;
    if (d < yearEnd && bal > 0) return true;
  }
  return false;
}
