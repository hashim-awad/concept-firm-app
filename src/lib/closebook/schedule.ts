// Step 2, Opening balances (Hashim, Nov 14, 2026; board "Step 2, Opening balances" in the screen walkthrough):
// last year's closing balance sheet laid out like ProFile's Schedule 101, and last year's income statement
// (Schedule 125) when available. Pure and tested. Amounts in cents.
//
// Every amount is typed exactly as printed on the T2; staff never change signs (Hashim, Nov 14). Stored in
// GIFI sign. Lines 3700 to 3740 are always deductions: stored negative whatever sign is typed (rule 3;
// benchmark: the QuickBooks GIFI files ProFile imports carry equity debits as negative).

export type Block = "assets" | "liabilities" | "equity" | "re" | "revenue" | "expenses";
export const BLOCK_TITLE: Record<Block, string> = { assets: "Assets", liabilities: "Liabilities", equity: "Equity", re: "Retained earnings", revenue: "Revenue", expenses: "Expenses" };

const num = (c: string) => Number(c);
export const isDividend = (c: string) => num(c) >= 3700 && num(c) <= 3740;
const isReCode = (c: string) => c === "3660" || (num(c) >= 3700 && num(c) <= 3848);

// The block a GIFI code belongs in, from its master line type.
export function blockOf(code: string, type: string | undefined): Block | null {
  if (isReCode(code)) return "re";
  return type === "Asset" ? "assets" : type === "Liability" ? "liabilities" : type === "Equity" ? "equity" : type === "Revenue" ? "revenue" : type === "Expense" ? "expenses" : null;
}
// Typed (as printed on the T2) to GIFI sign: only the deductions change, always negative.
export const toGifi = (code: string, typed: number) => (isDividend(code) ? -Math.abs(typed) : typed);
export const fromGifi = (_code: string, gifi: number) => gifi;

export type Totals = {
  t2599: number; t3499: number; equityLines: number; t3600: number; t3620: number; t3640: number;
  t8299: number; tExpenses: number; t9999: number; t3849calc: number; t3849: number | null; ni9999From125: boolean;
};
export type Flag = { code: string; text: string };

const money = (c: number) => (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// lines: [code, GIFI-sign cents]; type: the master line type of each code.
export function scheduleTotals(lines: [string, number][], typeOf: (code: string) => string | undefined, typed3849: number | null, typed9999: number | null): { totals: Totals; flags: Flag[] } {
  const sum = (b: Block) => lines.filter(([c]) => blockOf(c, typeOf(c)) === b).reduce((n, [, v]) => n + v, 0);
  const t2599 = sum("assets"), t3499 = sum("liabilities"), equityLines = sum("equity");
  const t8299 = sum("revenue"), tExpenses = sum("expenses");
  const has125 = lines.some(([c]) => { const b = blockOf(c, typeOf(c)); return b === "revenue" || b === "expenses"; });
  const t9999 = has125 ? t8299 - tExpenses : typed9999 ?? 0;
  const reLines = lines.filter(([c]) => isReCode(c));
  // 3660 + 9999 + the 3700s (always negative) + other adjustments.
  const t3849calc = reLines.reduce((n, [c, v]) => n + (isDividend(c) ? -Math.abs(v) : v), 0) + t9999;
  const t3600 = typed3849 ?? t3849calc;          // 3600 equals 3849
  const t3620 = equityLines + t3600, t3640 = t3499 + t3620;
  const flags: Flag[] = [];
  if (t3640 !== t2599) flags.push({ code: "3640", text: `${money(Math.abs(t2599 - t3640))} ${t3640 < t2599 ? "less" : "more"} than total assets (2599, ${money(t2599)}). Check the liabilities and equity lines.` });
  if (typed3849 === null) flags.push({ code: "3849", text: "Type last year's 3849 from the T2." });
  else if (typed3849 !== t3849calc) flags.push({ code: "3849", text: `${money(Math.abs(typed3849 - t3849calc))} ${typed3849 < t3849calc ? "less" : "more"} than 3660 + 9999 + dividends and adjustments (${money(t3849calc)}).` });
  if (!has125 && typed9999 === null) flags.push({ code: "9999", text: "Type last year's net income, or enter the Schedule 125 tab." });
  return { totals: { t2599, t3499, equityLines, t3600, t3620, t3640, t8299, tExpenses, t9999, t3849calc, t3849: typed3849, ni9999From125: has125 }, flags };
}
