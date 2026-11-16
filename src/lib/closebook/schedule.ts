// Step 2, Opening balances (Hashim, Nov 14, 2026; board "Step 2, Opening balances" in the screen walkthrough):
// last year's closing balance sheet laid out like ProFile's Schedule 100, and last year's income statement
// (Schedule 125) when the prior T2 has one. Pure and tested. Amounts in cents.
//
// One sign rule for both tabs (Hashim, Nov 15, 2026, item 12): amounts are typed as printed on the T2.
// Schedule 125 revenue and expenses are positive; a deficit, a loss or a contra account (accumulated
// amortization, an allowance) is negative. Stored as typed, which is GIFI sign: assets and expenses as
// debits, liabilities, equity and revenue as credits (src/lib/closebook/opening.ts turns them into debits
// and credits for the opening trial balance). One exception, Hashim's rule 3 (Nov 14): dividends declared
// (3700 to 3719) are printed as a positive figure and always stored negative, whatever sign is typed
// (benchmark: the QuickBooks GIFI files ProFile imports carry equity debits as negative). Prior period
// adjustments (3720) and other items (3740) keep the sign printed: they add to retained earnings, as on
// the T2 and in gifi.ts, fs-model.ts and t2.ts (before Nov 15 step 2 forced them negative).
import { bracketAmount } from "./amount.ts";

export type Block = "assets" | "liabilities" | "equity" | "re" | "revenue" | "expenses";
export const BLOCK_TITLE: Record<Block, string> = { assets: "Assets", liabilities: "Liabilities", equity: "Equity", re: "Retained earnings", revenue: "Revenue", expenses: "Expenses" };

const num = (c: string) => Number(c);
// Dividends declared: 3700 and its sub-lines to 3719.
export const isDividend = (c: string) => num(c) >= 3700 && num(c) <= 3719;
const isReCode = (c: string) => c === "3660" || (num(c) >= 3700 && num(c) <= 3848);

// The retained earnings block of Schedule 100, always shown in this order (item 9). 3680 is last year's net
// income (from 9999 on the Schedule 125 tab when it has lines); 3849 is typed from the T2.
export const RE_BLOCK: [string, string][] = [
  ["3660", "Retained earnings/deficit, start of last year"], ["3680", "Net income/loss"], ["3700", "Dividends declared"],
  ["3720", "Prior period adjustments"], ["3740", "Other items affecting retained earnings"], ["3849", "Retained earnings/deficit, end of last year (from the T2)"],
];

// The block a GIFI code belongs in, from its master line type.
export function blockOf(code: string, type: string | undefined): Block | null {
  if (isReCode(code)) return "re";
  return type === "Asset" ? "assets" : type === "Liability" ? "liabilities" : type === "Equity" ? "equity" : type === "Revenue" ? "revenue" : type === "Expense" ? "expenses" : null;
}
// Typed (as printed on the T2) to stored (GIFI sign): only dividends change, always negative.
export const toGifi = (code: string, typed: number) => (isDividend(code) ? -Math.abs(typed) : typed);
// Stored to the box: dividends show as printed on the T2, a positive figure.
export const fromGifi = (code: string, gifi: number) => (isDividend(code) ? Math.abs(gifi) : gifi);

// Item 13: on a bank-statement file, a Schedule 100 line with an amount sits on a standard chart account.
export const needsAccount = (block: Block | null, cents: number | null) => block !== null && block !== "revenue" && block !== "expenses" && !!cents;

// Item 10: the message when retained earnings do not tie. difference = worked out − 3849, in cents; shown
// the way the app shows a negative, in brackets (red on screen).
export const RE_TIE_BEFORE = "Retained earnings do not tie. Start (3660) + net income (3680) − dividends (3700) + adjustments (3720, 3740) should equal 3849. Difference: ";
export const RE_TIE_AFTER = ". Check line 3660 on last year's T2.";
export const reTieMessage = (differenceCents: number) => `${RE_TIE_BEFORE}${bracketAmount(differenceCents)}${RE_TIE_AFTER}`;
export const RE_3660_BLANK = "Line 3660 is blank. Type it from last year's T2, or 0.00 if the T2 shows none.";

export type Totals = {
  t2599: number; t3499: number; equityLines: number; t3600: number; t3620: number; t3640: number;
  t8299: number; tExpenses: number; t9999: number; t3849calc: number; t3849: number | null; ni9999From125: boolean;
  reDifference: number | null;
};
export type Flag = { code: string; text: string };

const money = (c: number) => (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// lines: [code, stored cents]; type: the master line type of each code. typed9999 is 3680 as typed (used
// when the Schedule 125 tab has no lines).
export function scheduleTotals(lines: [string, number][], typeOf: (code: string) => string | undefined, typed3849: number | null, typed9999: number | null): { totals: Totals; flags: Flag[] } {
  const sum = (b: Block) => lines.filter(([c]) => blockOf(c, typeOf(c)) === b).reduce((n, [, v]) => n + v, 0);
  const t2599 = sum("assets"), t3499 = sum("liabilities"), equityLines = sum("equity");
  const t8299 = sum("revenue"), tExpenses = sum("expenses");
  const has125 = lines.some(([c]) => { const b = blockOf(c, typeOf(c)); return b === "revenue" || b === "expenses"; });
  const t9999 = has125 ? t8299 - tExpenses : typed9999 ?? 0;
  const reLines = lines.filter(([c]) => isReCode(c));
  // 3660 + 3680 − dividends (stored negative) + 3720 + 3740 and the other retained earnings items.
  const t3849calc = reLines.reduce((n, [c, v]) => n + (isDividend(c) ? -Math.abs(v) : v), 0) + t9999;
  const t3600 = typed3849 ?? t3849calc;          // 3600 equals 3849
  const t3620 = equityLines + t3600, t3640 = t3499 + t3620;
  const niKnown = has125 || typed9999 !== null;
  const reDifference = typed3849 !== null && niKnown ? t3849calc - typed3849 : null;
  const flags: Flag[] = [];
  if (t3640 !== t2599) flags.push({ code: "3640", text: `${money(Math.abs(t2599 - t3640))} ${t3640 < t2599 ? "less" : "more"} than total assets (2599, ${money(t2599)}). Check the liabilities and equity lines.` });
  if (!niKnown) flags.push({ code: "3680", text: "Type last year's net income (3680), or enter the Schedule 125 tab." });
  if (typed3849 === null) flags.push({ code: "3849", text: "Type last year's 3849 from the T2." });
  else {
    if (!reLines.some(([c]) => c === "3660")) flags.push({ code: "3660", text: RE_3660_BLANK });
    if (reDifference) flags.push({ code: "3849", text: reTieMessage(reDifference) });
  }
  return { totals: { t2599, t3499, equityLines, t3600, t3620, t3640, t8299, tExpenses, t9999, t3849calc, t3849: typed3849, ni9999From125: has125, reDifference }, flags };
}

// Item 13, Recommendation A (Hashim, Nov 16, 2026): the accounts a step 2 line can sit on. A code's own
// standard chart accounts first, then those on its detail lines when it is a summary line (3260 offers
// 25400 on 3261; 1300 offers 13000 and 13050), each in chart order; 3660 takes those on 3600. A bank or card
// line, or a summary over one (1000 over 1001 to 1007), lists the file's own bank accounts instead, so last
// year's balance sits on the account the statements post to. The database checks the same
// (private.cb_chart_on_code, cb_save_opening). parts: [summary, detail] pairs (cb_gifi_parts).
export type Choice = { number: string; name: string; label?: string };
export function accountChoices(chart: { number: string; name: string; line_no: string | null }[], banks: { id: string; name: string; number: string; code: string }[],
  parts: [string, string][]): Record<string, Choice[]> {
  const own = new Map<string, Choice[]>(), bank = new Map<string, Choice[]>();
  const pos = new Map(chart.map((c, i) => [c.number, i]));   // chart order (the list comes sorted)
  for (const c of chart) {
    if (!c.line_no) continue;
    const code = c.line_no.slice(0, 4);
    for (const k of code === "3600" ? ["3600", "3660"] : [code]) own.set(k, [...(own.get(k) ?? []), { number: c.number, name: c.name }]);
  }
  for (const b of banks) if (b.code) bank.set(b.code, [...(bank.get(b.code) ?? []), { number: `bank:${b.id}`, name: b.name, label: `${b.number} ${b.name}` }]);
  const details = new Map<string, string[]>();
  for (const [s, d] of parts) details.set(s, [...(details.get(s) ?? []), d]);
  const out: Record<string, Choice[]> = {};
  for (const code of new Set([...own.keys(), ...bank.keys(), ...details.keys()])) {
    const family = [code, ...(details.get(code) ?? []).sort()];
    const banks = family.flatMap((c) => bank.get(c) ?? []);
    const fromDetails = family.slice(1).flatMap((c) => own.get(c) ?? []).sort((x, y) => (pos.get(x.number) ?? 0) - (pos.get(y.number) ?? 0));
    const list = (banks.length ? banks : [...(own.get(code) ?? []), ...fromDetails]).filter((x, i, a) => a.findIndex((y) => y.number === x.number) === i);
    if (list.length) out[code] = list;
  }
  return out;
}
