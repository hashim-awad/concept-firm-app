// Opening balances for files built from bank and card CSVs (Hashim, Nov 13, 2026; BRIEF.md "Opening
// balances"). Last year's balances arrive as GIFI codes, whatever the route: last year's Closebook file,
// a prior-year GIFI file (Closebook layout: "code",amount lines, no total lines, 3660 and the 3700s
// included), or typed in by GIFI code. Pure and tested.

export type CodeInfo = { line_no: string; name: string; type: string };   // the master line a code lands on
export type OpeningLine = { code: string; line_no: string; name: string; type: string; debitCents: number };
export type Opening = { lines: OpeningLine[]; netIncomeCents: number; reStartCents: number; reClosingCents: number };

const n = (c: string) => Number(c);
export const isDeduction = (c: string) => n(c) >= 3700 && n(c) <= 3739;          // dividends and the like
export const isReAdjustment = (c: string) => n(c) >= 3740 && n(c) <= 3848;

// "GIFI01",... header (skipped), then "1002",207957.44 lines. Also accepts code,amount without quotes.
export function parseGifiFile(text: string): { codes: [string, number][]; errors: string[] } {
  const codes: [string, number][] = [], errors: string[] = [];
  const seen = new Set<string>();
  text.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || /^"?GIFI01"?/i.test(line)) return;
    const m = /^"?(\d{4})"?\s*[,;\t]\s*"?(-?\d+(?:\.\d{1,2})?)"?$/.exec(line);
    if (!m) { errors.push(`Line ${i + 1}: expected "code",amount, found ${line.slice(0, 40)}`); return; }
    if (seen.has(m[1])) { errors.push(`Line ${i + 1}: GIFI ${m[1]} appears twice.`); return; }
    seen.add(m[1]);
    codes.push([m[1], Math.round(Number(m[2]) * 100)]);
  });
  if (!codes.length && !errors.length) errors.push("The file has no GIFI lines.");
  return { codes, errors };
}

// GIFI sign: assets and expenses as debits; liabilities, equity and revenue as credits; deductions
// (3700s) positive. Turned into debit-positive balances; closing retained earnings worked out as
// 3660 + net income − dividends + adjustments (what last year's 3849 should show).
export function openingFrom(codes: [string, number][], info: Map<string, CodeInfo>): { opening: Opening; errors: string[] } {
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
  const netIncome = revenue - expenses;
  return { opening: { lines, netIncomeCents: netIncome, reStartCents: reStart, reClosingCents: reStart + netIncome - deductions + adjustments }, errors };
}

// A trial balance row the file builds itself (bank, chart, GIFI, holding) versus one imported from the
// prior accountant's trial balance, which waits to become opening balances (route 3).
export const isImportedRow = (key: string) => !/^(chart|bank|gifi):/.test(key) && key !== "uncoded" && key !== "opening";
