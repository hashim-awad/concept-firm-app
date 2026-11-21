// Piece 10 (Hashim, Nov 19, 2026; CaseWare Cloud's analytical review): step 6, "Compare to last year". Pure, so the page and
// the tests share the rules. The database applies the same ones (private.cb_compare_accounts, private.cb_step_problems).
//   a) Every line: each lead sheet account, last year, this year, $ change and % change. No flags (CB2-0 step 5, rule 7).
//   b) New accounts this year: a balance this year (after entries) and none last year.
//   c) Accounts not used this year: a balance last year and none this year.
//   d) What changed this year: six yes/no questions.
// System rows ("opening", "uncoded") and Clearing (10900) are left out of b) and c).
import { leadSheets, type Line } from "./matching.ts";

export const YEAR_QUESTIONS: [string, string][] = [
  ["assets", "Assets bought or sold"],
  ["loans", "Loans taken or repaid"],
  ["shareholders", "Shareholders or share capital changed"],
  ["related", "Related-party transactions (rent, management fees, loans)"],
  ["revenue", "Revenue from a new source, or a source that stopped"],
  ["equity", "Negative equity at year-end"],
];

export type CompareAccount = { id: string; account_key: string; number: string; name: string; line_no: string | null; last_year: number; this_year: number;
  last_year_line?: string | null; tax_code?: string | null };
export type CompareEntry = { kind?: string; lines: { account_id: string; amount: number }[] };
export type CompareRow = { id: string; key: string; number: string; name: string; line: string | null; lastCents: number; finalCents: number; changeCents: number;
  sheet?: string; pct?: number | null };

const SYSTEM = new Set(["opening", "uncoded", "chart:10900"]);
const cents = (v: number) => Math.round(v * 100);

export function compareLists(accounts: CompareAccount[], entries: CompareEntry[], lines: Line[], sheets: { code: string; name: string }[]) {
  const entryTotals = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) {
    entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
  }
  const byNo = new Map(lines.map((l) => [l.line_no, l]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const row = (a: CompareAccount, line: string | null, finalCents: number): CompareRow => ({ id: a.id, key: a.account_key, number: a.number, name: a.name, line,
    lastCents: cents(a.last_year), finalCents, changeCents: finalCents - cents(a.last_year) });
  // a) Every lead sheet line with a balance in either year, in lead sheet order (the existing sort).
  const every = leadSheets(accounts, entryTotals, byNo, sheets).flatMap((g) => g.rows.filter((r) => cents(r.final) !== 0 || cents(r.last) !== 0)
    .map((r) => ({ ...row(byId.get(r.id)!, r.line, cents(r.final)), sheet: g.name, pct: r.pct })));
  const newAccounts: CompareRow[] = [], unused: CompareRow[] = [];
  for (const a of accounts) {
    if (SYSTEM.has(a.account_key)) continue;
    const fin = cents(a.this_year + (entryTotals.get(a.id) ?? 0)), last = cents(a.last_year);
    if (last === 0 && fin !== 0) newAccounts.push(row(a, a.line_no, fin));
    else if (last !== 0 && fin === 0) unused.push(row(a, a.line_no, fin));
  }
  const byNumber = (x: CompareRow, y: CompareRow) => (x.number || x.name).localeCompare(y.number || y.name, "en", { numeric: true });
  return { every, newAccounts: newAccounts.sort(byNumber), unused: unused.sort(byNumber) };
}

// The "Seen" tick is kept for the list it was ticked on (the database's private.cb_unused_key).
export const unusedKey = (unused: CompareRow[]) => unused.map((r) => r.key).sort().join(",");

// Sort for "Every line": the lead sheet order (as listed), the largest $ change first, or the largest % change first
// (a line with nothing last year has no % and goes last).
export type CompareSort = "sheet" | "dollar" | "pct";
export function sortEvery(rows: CompareRow[], by: CompareSort): CompareRow[] {
  if (by === "dollar") return [...rows].sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents));
  if (by === "pct") return [...rows].sort((a, b) => (b.pct === null || b.pct === undefined ? -1 : Math.abs(b.pct)) - (a.pct === null || a.pct === undefined ? -1 : Math.abs(a.pct)));
  return rows;
}
