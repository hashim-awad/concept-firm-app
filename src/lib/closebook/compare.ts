// Piece 10 (Hashim, Nov 19, 2026; CaseWare Cloud's analytical review): step 6, "Compare to last year". Pure, so the page and
// the tests share the rules. The database applies the same ones (private.cb_compare_accounts, private.cb_step_problems).
//   a) Flagged changes: the lead sheets' flag rule, unchanged (thresholds, retained earnings left out, piece 6's tax entries).
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
export type CompareRow = { id: string; key: string; number: string; name: string; line: string | null; lastCents: number; finalCents: number; changeCents: number };

const SYSTEM = new Set(["opening", "uncoded", "chart:10900"]);
const cents = (v: number) => Math.round(v * 100);

export function compareLists(accounts: CompareAccount[], entries: CompareEntry[], lines: Line[], sheets: { code: string; name: string }[], flag: { amount: number; percent: number }) {
  const entryTotals = new Map<string, number>(), tjeTotals = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) {
    entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
    if (e.kind === "TJE") tjeTotals.set(l.account_id, (tjeTotals.get(l.account_id) ?? 0) + l.amount);
  }
  const byNo = new Map(lines.map((l) => [l.line_no, l]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const row = (a: CompareAccount, line: string | null, finalCents: number): CompareRow => ({ id: a.id, key: a.account_key, number: a.number, name: a.name, line,
    lastCents: cents(a.last_year), finalCents, changeCents: finalCents - cents(a.last_year) });
  // a) The lead sheets' flagged lines, in lead sheet order.
  const flagged = leadSheets(accounts, entryTotals, byNo, sheets, flag, tjeTotals).flatMap((g) => g.rows.filter((r) => r.flagged))
    .map((r) => row(byId.get(r.id)!, r.line, cents(r.final)));
  const newAccounts: CompareRow[] = [], unused: CompareRow[] = [];
  for (const a of accounts) {
    if (SYSTEM.has(a.account_key)) continue;
    const fin = cents(a.this_year + (entryTotals.get(a.id) ?? 0)), last = cents(a.last_year);
    if (last === 0 && fin !== 0) newAccounts.push(row(a, a.line_no, fin));
    else if (last !== 0 && fin === 0) unused.push(row(a, a.line_no, fin));
  }
  const byNumber = (x: CompareRow, y: CompareRow) => (x.number || x.name).localeCompare(y.number || y.name, "en", { numeric: true });
  return { flagged, newAccounts: newAccounts.sort(byNumber), unused: unused.sort(byNumber) };
}

// The "Seen" tick is kept for the list it was ticked on (the database's private.cb_unused_key).
export const unusedKey = (unused: CompareRow[]) => unused.map((r) => r.key).sort().join(",");

// The flag rule in words, for the "Flagged changes" heading: "Over 5,000.00 and 20%."
export const flagRuleText = (flag: { amount: number; percent: number }) =>
  `Over ${flag.amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} and ${flag.percent}%. This year's tax entries are left out.`;
