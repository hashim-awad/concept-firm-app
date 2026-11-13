// Opening balances for files built from bank and card CSVs (Hashim, Nov 13 and 14, 2026; BRIEF.md "Opening
// balances"): last year's balances by GIFI code, filled from last year's Closebook file or typed in step 2
// from the prior T2 or the CRA assessment. A GIFI file is never an input, only the output to ProFile.

export type CodeInfo = { line_no: string; name: string; type: string };   // the master line a code lands on
export type OpeningLine = { code: string; line_no: string; name: string; type: string; debitCents: number };
export type Opening = { lines: OpeningLine[]; netIncomeCents: number; reStartCents: number; reClosingCents: number };

const n = (c: string) => Number(c);
export const isDeduction = (c: string) => n(c) >= 3700 && n(c) <= 3739;          // dividends and the like
export const isReAdjustment = (c: string) => n(c) >= 3740 && n(c) <= 3848;

// GIFI sign: assets and expenses as debits; liabilities, equity and revenue as credits; deductions
// (3700s) positive. Turned into debit-positive balances; closing retained earnings worked out as
// 3660 + net income − dividends + adjustments (what last year's 3849 should show).
export function openingFrom(codes: [string, number][], info: Map<string, CodeInfo>, niTypedCents: number | null = null): { opening: Opening; errors: string[] } {
  const errors: string[] = [];
  const lines: OpeningLine[] = [];
  let revenue = 0, expenses = 0, deductions = 0, adjustments = 0, reStart = 0;
  for (const [code, cents] of codes) {
    if (code === "3849") { errors.push("Leave 3849 out: it is a total. Enter last year's 3849 in its own box for the check."); continue; }
    const i = info.get(code);
    if (!i) { errors.push(`GIFI ${code} is not a line Closebook can use (unknown, or a total line).`); continue; }
    const debit = i.type === "Asset" || i.type === "Expense" || isDeduction(code) ? cents : -cents;
    lines.push({ code, line_no: i.line_no, name: i.name, type: i.type, debitCents: debit });
    if (i.type === "Revenue") revenue += cents;
    else if (i.type === "Expense") expenses += cents;
    else if (code === "3660") reStart += cents;
    else if (isDeduction(code)) deductions += cents;
    else if (isReAdjustment(code)) adjustments += cents;
  }
  // Last year's net income: from Schedule 125 when entered, else as typed (step 2, Hashim Nov 14).
  const has125 = lines.some((l) => l.type === "Revenue" || l.type === "Expense");
  const netIncome = has125 ? revenue - expenses : niTypedCents ?? 0;
  return { opening: { lines, netIncomeCents: netIncome, reStartCents: reStart, reClosingCents: reStart + netIncome - deductions + adjustments }, errors };
}
