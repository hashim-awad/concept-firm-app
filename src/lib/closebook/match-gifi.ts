// Piece R1 (Hashim, Nov 19, 2026; mock M; benchmark QuickBooks Online Workpapers > Tax mapping): step 8's first paper,
// "Match accounts to GIFI". One row per GIFI code with a balance, in GIFI order, sub-lines added in (as the GIFI file
// writes them); each row's accounts with their amounts. The line an account is reported on is its GIFI override when set,
// else its group, after the paired line flip. Accounts that need a decision (the database's box, private.cb_match_items)
// are left out of the table: they show only in the box. Amounts in cents, as the trial balance shows them (debits
// positive, credits negative). Pure: tests check it.
import { effectiveLine, type Line } from "./matching.ts";

export type MatchAccount = { id: string; number: string; name: string; line_no: string | null; gifi_override?: string | null; this_year: number };
export type MatchSub = { id: string; label: string; cents: number; line: string; overridden: boolean };
export type MatchRow = { code: string; name: string; cents: number; accounts: MatchSub[] };
export type MatchTies = { ni_chart: number; ni_gifi: number; assets_chart: number; assets_gifi: number };

export function matchRows(accounts: MatchAccount[], entryTotals: Map<string, number>, lines: Map<string, Line>, inBox: Set<string>): MatchRow[] {
  const rows = new Map<string, MatchRow>();
  for (const a of accounts) {
    if (inBox.has(a.id)) continue;
    const cents = Math.round((Number(a.this_year) + (entryTotals.get(a.id) ?? 0)) * 100);
    if (cents === 0) continue;
    const gl = a.gifi_override ?? a.line_no;
    const eff = effectiveLine(gl, cents / 100, lines);
    const l = eff ? lines.get(eff) : undefined;
    if (!l) continue;
    // The trial balance's retained earnings is the balance at the start of the year: GIFI 3660, as the file writes it.
    const code = l.gifi_code === "3600" ? "3660" : l.gifi_code;
    const row = rows.get(code) ?? { code, name: gifiName(code, lines), cents: 0, accounts: [] };
    row.cents += cents;
    row.accounts.push({ id: a.id, label: `${a.number ? `${a.number} ` : ""}${a.name}`, cents, line: eff!, overridden: !!a.gifi_override && a.gifi_override !== a.line_no });
    rows.set(code, row);
  }
  return [...rows.values()].filter((r) => r.accounts.length).sort((x, y) => x.code.localeCompare(y.code));
}

// The full name of a GIFI code: its main line's name (D8: full master line names, never shortened).
export function gifiName(code: string, lines: Map<string, Line>): string {
  if (code === "3660") return "Retained earnings/deficit – Start";
  return lines.get(`${code}.00`)?.name ?? [...lines.values()].find((l) => l.gifi_code === code)?.name ?? "";
}

// The ties line, to the cent (D6): "net income <x> = GIFI 9999 ✓". A tie that fails shows the difference instead.
export type TieItem = { label: string; code: string; chart: number; gifi: number; diff: number; ok: boolean };
export function tieItems(t: MatchTies): TieItem[] {
  const c = (n: number) => Math.round(Number(n) * 100);
  const item = (label: string, code: string, chart: number, gifi: number): TieItem => ({ label, code, chart: c(chart), gifi: c(gifi), diff: c(chart) - c(gifi), ok: c(chart) === c(gifi) });
  return [item("net income", "9999", t.ni_chart, t.ni_gifi), item("total assets", "2599", t.assets_chart, t.assets_gifi)];
}

// One reason per account in the box (D5), in words.
export const BOX_REASON: Record<string, string> = {
  no_group: "No group",
  reviewer: "Waiting for the reviewer",
  locked: "On a locked or total line",
  suggested: "Suggested line not confirmed",
  type: "Type does not match the GIFI line",
  side: "Balance on the wrong side of its line",
  clearing: "Clearing has a balance",
  opening: "Opening balances to enter",
  uncoded: "Transactions not yet coded",
  moved: "Line changed from last year",   // piece R2 (D6): trial balance files
};

// Piece R1 (accounting review): last year's statement column. Step 2 stays the source (last year's T2 by GIFI code). When last
// year's Closebook file is the year just before (it ends the day before this year starts) and is locked, each account it had on
// a GIFI override is moved back, at its final amount, from the override's code to its group's code, so an account sits under
// the same caption in both years. Anything else: step 2 as entered. Pure: tests check it.
export const dayBefore = (isoDate: string) => { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
export const priorUsable = (prior: { year_end: string; phase: string } | null, yearStart: string) => !!prior && prior.phase === "locked" && prior.year_end === dayBefore(yearStart);

export function regroupPrior(prior: Map<string, number>, accounts: MatchAccount[], entryTotals: Map<string, number>, lines: Map<string, Line>): Map<string, number> {
  const out = new Map(prior);
  const code = (l: Line) => (l.gifi_code === "3600" ? "3660" : l.gifi_code);
  for (const a of accounts) {
    if (!a.gifi_override || a.gifi_override === a.line_no) continue;
    const fin = Math.round((Number(a.this_year) + (entryTotals.get(a.id) ?? 0)) * 100) / 100;
    if (!fin) continue;
    const from = lines.get(effectiveLine(a.gifi_override, fin, lines) ?? ""), to = lines.get(effectiveLine(a.line_no, fin, lines) ?? "");
    if (!from || !to || code(from) === code(to)) continue;
    const amt = (l: Line) => (l.line_type === "Asset" || l.line_type === "Expense" ? fin : -fin);
    const c = (n: number) => Math.round(n * 100) / 100;
    out.set(code(from), c((out.get(code(from)) ?? 0) - amt(from)));
    out.set(code(to), c((out.get(code(to)) ?? 0) + amt(to)));
    if (out.get(code(from)) === 0) out.delete(code(from));
  }
  return out;
}
