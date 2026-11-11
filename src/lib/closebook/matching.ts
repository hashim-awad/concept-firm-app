// Matching client accounts to master lines (Phase 3 batch 4.1, 4.5, 5.5). Pure.
// - suggestLine: a suggestion from the account's name (history is applied first, in the database).
//   A clear single match is suggested; none, or two close ones, go to the reviewer.
// - effectiveLine: an account whose balance flips sign moves to its paired line (4.1).
// - typeMismatch: an account numbered as one type matched to a line of another type (4.5).
// - leadSheets: grouping, entries, final balances and the year-over-year flags (5.5).

export type Line = { line_no: string; name: string; gifi_code: string; line_type: string; lead_sheet: string | null; statement_line: string | null; default_tax_code: string | null; mappable: boolean; pair_line: string | null; section?: string };

// Common words in client account names that GIFI wording does not use. Suggestions only: the
// preparer confirms them and the reviewer sees every new match at sign-off. Review this list with
// Hashim; add words here, not in the code below.
export const WORDS: [RegExp, string][] = [
  [/\b(us\$|usd|u\.s\.)\b.*\b(bank|chequing|checking|savings|account)\b|\b(bank|chequing|checking|savings)\b.*\b(us\$|usd|u\.s\.)\b/i, "1003.00"],
  [/\b(chequing|checking|savings|operating account|business account|bank account)\b/i, "1002.00"],
  [/\b(visa|mastercard|master card|amex|american express|credit card)\b/i, "2707.00"],
  [/\b(hst|gst|gst\/hst|sales tax)\b.*\b(payable|owing|collected|account)\b|^(hst|gst|gst\/hst)$/i, "2680.00"],
  [/\b(share capital|common shares|capital stock)\b/i, "3500.00"],
  [/^retained earnings$/i, "3600.00"],
  [/\b(telephone|phone|cell|cellular|mobile|internet)\b/i, "9225.00"],
  [/\b(vehicle|automobile|auto expense|fuel|gas and oil)\b/i, "9281.00"],
  [/\b(meals|entertainment)\b/i, "8523.00"],
  [/\b(bank charges|bank fees|service charges|interest and bank charges)\b/i, "8715.00"],
  [/\b(advertising|promotion|marketing)\b/i, "8520.00"],
  [/\b(accounting|legal|professional fees)\b/i, "8860.00"],
  [/^rent$|\b(office rent|rent expense)\b/i, "8910.00"],
  [/\binsurance\b/i, "8690.00"],
];

const STOP = new Set(["and", "the", "of", "for", "to", "in", "on", "a", "an", "expense", "expenses", "account", "accounts", "other", "misc", "miscellaneous", "costs", "cost", "fees", "fee"]);
// Words, lower case, without plurals ("computers" matches "computer"), and without filler words.
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
  .map((w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));

// The account number's first digit, when the client uses a standard four-digit chart.
export function numberType(number: string): string | null {
  if (!/^\d{4}(\.\d+)?$/.test(number)) return null;
  return ({ "1": "Asset", "2": "Liability", "3": "Equity", "4": "Revenue" } as Record<string, string>)[number[0]] ?? (/[5-9]/.test(number[0]) ? "Expense" : null);
}

export function typeMismatch(number: string, line: Line | undefined): boolean {
  const t = numberType(number);
  return !!(t && line && line.line_type !== t);
}

export type Suggestion = { line: string | null; reason: string };

export function suggestLine(account: { number: string; name: string }, lines: Line[]): Suggestion {
  const mappable = lines.filter((l) => l.mappable);
  const byNo = new Map(mappable.map((l) => [l.line_no, l]));
  const t = numberType(account.number);
  const ok = (l: Line | undefined) => !!l && (!t || l.line_type === t);
  const word = WORDS.find(([re, ln]) => re.test(account.name) && ok(byNo.get(ln)));
  if (word) return { line: word[1], reason: "Common account name" };
  // "Accumulated amortization - computers": find the asset, then its accumulated amortization line
  // (the asset's GIFI code plus one, as CRA numbers them).
  const accum = /^\s*(accumulated|accum\.?)\s+(amortization|amortisation|depreciation|amort\.?|dep\.?)\b\s*(of|on|-|–|:)?\s*/i;
  if (accum.test(account.name)) {
    // The asset line must contain every word of what is left ("computers"), and only one may.
    const want = [...tokens(account.name.replace(accum, ""))];
    const assets = mappable.filter((l) => l.line_type === "Asset" && !/accumulated/i.test(l.name) && want.length > 0 && want.every((w) => tokens(l.name).has(w)));
    const pair = assets.length === 1 ? mappable.find((l) => Number(l.gifi_code) === Number(assets[0].gifi_code) + 1 && /accumulated/i.test(l.name)) : undefined;
    return pair ? { line: pair.line_no, reason: "Accumulated amortization of the matching asset" } : { line: null, reason: "Accumulated amortization: which asset is unclear" };
  }
  const a = tokens(account.name);
  if (!a.size) return { line: null, reason: "The account name has no words to match" };
  const scored = mappable.filter(ok).map((l) => {
    const b = tokens(l.name);
    const shared = [...a].filter((w) => b.has(w)).length;
    return { l, score: shared / new Set([...a, ...b]).size };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
  if (!scored.length || scored[0].score < 0.5) return { line: null, reason: "No clear match" };
  if (scored[1] && scored[0].score - scored[1].score < 0.15) return { line: null, reason: `Matches two lines: ${scored[0].l.line_no} and ${scored[1].l.line_no}` };
  return { line: scored[0].l.line_no, reason: "Name match" };
}

// The side a line normally sits on: debit for assets and expenses, credit for the rest.
const debitSide = (type: string) => type === "Asset" || type === "Expense";

export function effectiveLine(lineNo: string | null, balance: number, lines: Map<string, Line>): string | null {
  if (!lineNo) return null;
  const l = lines.get(lineNo);
  if (!l || !l.pair_line || balance === 0) return lineNo;
  const opposite = debitSide(l.line_type) ? balance < 0 : balance > 0;
  return opposite ? l.pair_line : lineNo;
}

export type LeadRow = { id: string; number: string; name: string; line: string; last: number; before: number; entries: number; final: number; change: number; pct: number | null; flagged: boolean };
export type LeadSheet = { code: string; name: string; rows: LeadRow[]; last: number; before: number; entries: number; final: number };

// Flag rule (5.5): changed by more than the amount AND more than the percentage. Both conditions.
export function flagged(last: number, final: number, amount: number, percent: number): boolean {
  const change = Math.abs(final - last);
  if (change <= amount) return false;
  if (last === 0) return true;
  return (change / Math.abs(last)) * 100 > percent;
}

export function leadSheets(
  accounts: { id: string; number: string; name: string; line_no: string | null; last_year: number; this_year: number }[],
  entryTotals: Map<string, number>, lines: Map<string, Line>, sheets: { code: string; name: string }[], flag: { amount: number; percent: number },
): LeadSheet[] {
  const out = new Map(sheets.map((s) => [s.code, { code: s.code, name: s.name, rows: [] as LeadRow[], last: 0, before: 0, entries: 0, final: 0 }]));
  for (const a of accounts) {
    const entries = entryTotals.get(a.id) ?? 0;
    const final = Math.round((a.this_year + entries) * 100) / 100;
    const line = effectiveLine(a.line_no, final, lines);
    const sheet = line ? lines.get(line)?.lead_sheet : null;
    if (!line || !sheet) continue;
    const change = Math.round((final - a.last_year) * 100) / 100;
    const row: LeadRow = { id: a.id, number: a.number, name: a.name, line, last: a.last_year, before: a.this_year, entries, final, change,
      pct: a.last_year === 0 ? null : (change / Math.abs(a.last_year)) * 100, flagged: flagged(a.last_year, final, flag.amount, flag.percent) };
    const s = out.get(sheet)!;
    s.rows.push(row); s.last += a.last_year; s.before += a.this_year; s.entries += entries; s.final += final;
  }
  return [...out.values()].filter((s) => s.rows.length);
}

// Wrong-sign check (borrowed from QuickBooks' tax mapping screen): a GIFI line whose total sits on the
// side it normally does not. Assets and expenses are normally debits; liabilities, equity and revenue
// credits. Contra lines (accumulated amortization, allowances, dividends) normally sit on the other side.
const CONTRA = /^(accumulated|allowance|less\b)|dividends|draws?\b/i;
export function wrongSign(line: Line | undefined, total: number): string {
  if (!line || Math.round(total) === 0) return "";
  const debitNormal = debitSide(line.line_type) !== CONTRA.test(line.name);
  const isDebit = total > 0;
  if (isDebit === debitNormal) return "";
  return `This line is normally a ${debitNormal ? "debit" : "credit"}, but its total is a ${isDebit ? "debit" : "credit"}. Check the matching, or a missing entry.`;
}
