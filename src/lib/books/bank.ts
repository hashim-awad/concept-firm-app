// CB2-1 PR B: Bank transactions (QBO). Rules and suggestions, pure and tested.
// A line For review shows a suggested account and tax code: from the first rule that applies (by priority), else from the
// last similar line the client confirmed (same vendor). Rules suggest; a person confirms, unless the rule says
// "Automatically confirm".
import { vendorKey } from "../closebook/vendor.ts";

export type Cond = { field: "description" | "amount"; op: "contains" | "eq" | "between"; value: string; value2?: string };
export type BooksRule = { id: string; name: string; priority: number; direction: "in" | "out" | "any"; accounts: string[]; match_all: boolean; conditions: Cond[];
  chart_account: string | null; splits: { account: string; tax: string; percent: number }[] | null; tax_code: string | null; memo: string; auto_confirm: boolean; active: boolean };
// A bank line in its account's own terms: money in positive on a bank account; a charge positive on a card.
export type BankLine = { id: string; description: string; cents: number };
export type Suggestion = { source: "rule" | "history"; ruleId?: string; account: string | null; tax: string | null; memo?: string;
  splits?: { account: string; tax: string; cents: number }[]; auto?: boolean; ruleName?: string };

export const isOut = (kind: "bank" | "card", cents: number) => (kind === "card" ? cents > 0 : cents < 0);
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
const toCents = (v: string | undefined) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null; };

export function condHolds(c: Cond, l: BankLine): boolean {
  if (c.field === "description") return !!norm(c.value) && norm(l.description).includes(norm(c.value));
  const have = Math.abs(l.cents), a = toCents(c.value);
  if (a === null) return false;
  if (c.op === "between") { const b = toCents(c.value2); return b !== null && have >= Math.min(a, b) && have <= Math.max(a, b); }
  return have === a;
}

export function ruleApplies(r: BooksRule, l: BankLine, ident: string, kind: "bank" | "card"): boolean {
  if (!r.active || !r.conditions.length) return false;
  const out = isOut(kind, l.cents);
  if ((r.direction === "out" && !out) || (r.direction === "in" && out)) return false;
  if (r.accounts.length && !r.accounts.includes(ident)) return false;
  return r.match_all ? r.conditions.every((c) => condHolds(c, l)) : r.conditions.some((c) => condHolds(c, l));
}

// A split by percentage, in cents that add up to the line exactly (the last row takes the rounding).
export function splitByPercent(cents: number, rows: { account: string; tax: string; percent: number }[]): { account: string; tax: string; cents: number }[] {
  const total = Math.abs(cents);
  let given = 0;
  return rows.map((r, i) => {
    const c = i === rows.length - 1 ? total - given : Math.round((total * r.percent) / 100);
    given += c;
    return { account: r.account, tax: r.tax, cents: c };
  });
}

// history: the client's confirmed lines by vendor (the latest first wins).
export type HistoryMap = Map<string, { account: string; tax: string | null }>;
export function historyOf(lines: { description: string; account: string | null; tax: string | null }[]): HistoryMap {
  const m: HistoryMap = new Map();
  for (const l of lines) { const k = vendorKey(l.description); if (k && l.account && !m.has(k)) m.set(k, { account: l.account, tax: l.tax }); }
  return m;
}

export function suggest(l: BankLine, ident: string, kind: "bank" | "card", rules: BooksRule[], history: HistoryMap): Suggestion | null {
  const r = [...rules].sort((a, b) => a.priority - b.priority).find((x) => ruleApplies(x, l, ident, kind));
  if (r) {
    if (r.splits?.length) return { source: "rule", ruleId: r.id, ruleName: r.name, account: null, tax: null, memo: r.memo || undefined, splits: splitByPercent(l.cents, r.splits), auto: r.auto_confirm };
    return { source: "rule", ruleId: r.id, ruleName: r.name, account: r.chart_account, tax: r.tax_code, memo: r.memo || undefined, auto: r.auto_confirm };
  }
  const h = history.get(vendorKey(l.description));
  return h ? { source: "history", account: h.account, tax: h.tax } : null;
}
