// Round 14: the shareholder loan schedule, with the s.15(2) repayment date.
// Benchmark: CaseWare's shareholder loan continuity working paper. One schedule per account on a due to
// or due from shareholder line: opening balance, the year's movements grouped by kind (each drills to its
// postings), closing balance, and the tie to the trial balance. Signs: debit positive, so a positive
// balance is what the shareholder owes the company.
import type { Posting } from "./tb-build";

export const SH_LINES = ["1301", "1302", "1303", "2780", "2781", "2782", "2783", "3260", "3261", "3262", "3263"];
export const isShLine = (line_no: string | null | undefined) => !!line_no && SH_LINES.includes(line_no.slice(0, 4));
// GIFI lines whose entries credit the shareholder: dividends declared (3700 to 3719) and salary or bonus.
const DIVIDEND = (g: number) => g >= 3700 && g <= 3719;
const SALARY = new Set([9060, 9063, 9065, 9066]);

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
export type ShFlag = "earlier_debit" | "late_repayment";
export type ShSchedule = {
  key: string; number: string; name: string; line_no: string;
  openingCents: number; openingItems: ShItem[]; movements: ShMovement[]; closingCents: number; tbCents: number; tied: boolean;
  debitAtEnd: boolean; dueOn: string | null; flags: ShFlag[];
  // The day-by-day test of flag B needs dates: a client who keeps their own books gives one line a year.
  datesKnown: boolean;
  // Credits on the account, as evidence a balance owed at the start of the year was repaid.
  repayments: ShItem[];
};

export const FLAG_TEXT: Record<ShFlag, string> = {
  earlier_debit: "Part of this balance may be past its s.15(2) date (this year end).",
  late_repayment: "Check this is not a series of loans and repayments.",
};

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

export type ShInput = {
  accounts: ShAccountIn[]; postings: Posting[]; entries: Map<string, ShEntryInfo>;
  own: boolean; yearEnd: string; windowDays: number;
};

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
      if (imported - a.lastCents) push("books", { date: inp.yearEnd, kind: "import", ref: "", label: "This year's balance in the client's books, less last year's", cents: imported - a.lastCents });
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
    const debitAtEnd = closingCents > 0;
    const flags: ShFlag[] = [];
    if (debitAtEnd && openingCents > 0) flags.push("earlier_debit");
    const datesKnown = !inp.own;
    if (datesKnown && !debitAtEnd && lateRepayment(openingCents, ps.filter((p) => p.kind !== "opening"), inp.yearEnd, inp.windowDays)) flags.push("late_repayment");
    out.push({
      key: a.key, number: a.number, name: a.name, line_no: a.line_no ?? "",
      openingCents, openingItems, movements, closingCents, tbCents: a.tbCents, tied: closingCents === a.tbCents,
      debitAtEnd, dueOn: debitAtEnd ? addYear(inp.yearEnd) : null, flags, datesKnown,
      repayments: ps.filter((p) => p.cents < 0 && (p.kind === "bank" || p.kind === "entry")).map(item).sort((x, y) => x.date.localeCompare(y.date)),
    });
  }
  return out.sort((x, y) => x.number.localeCompare(y.number));
}

// Flag B: the balance ends the year at zero or in credit, but was in debit at some point in the last
// `days` days of the year (counting the balance at the end of the day the window opens).
export function lateRepayment(openingCents: number, movements: { date: string; cents: number }[], yearEnd: string, days: number): boolean {
  const from = addDays(yearEnd, -days);
  const sorted = [...movements].sort((x, y) => x.date.localeCompare(y.date));
  let bal = openingCents, i = 0;
  while (i < sorted.length && sorted[i].date <= from) bal += sorted[i++].cents;
  if (bal > 0) return true;
  // Each later day's closing balance, up to the day before year end.
  while (i < sorted.length) {
    const d = sorted[i].date;
    while (i < sorted.length && sorted[i].date === d) bal += sorted[i++].cents;
    if (d < yearEnd && bal > 0) return true;
  }
  return false;
}

// The question in next year's file: a balance owed at the start of the year had a s.15(2) date one year
// after last year end.
export const priorDueOn = (yearStart: string) => addYear(addDays(yearStart, -1));
