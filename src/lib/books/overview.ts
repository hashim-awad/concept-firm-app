// CB2-1 PR C (Hashim, Nov 21, 2026): the Overview reads accounts by their GIFI line, never by account number (rule 12:
// clients who keep their own books bring their own charts).
// - Cash and bank: GIFI's cash lines 1000 to 1007 (and their sub-lines), the balance sheet's "Cash and bank" total.
//   (1060 to 1072 are receivables, so the range stops at 1007.)
// - Due to (from) shareholder: due from shareholders and directors 1300 to 1303 and 2180 to 2183 (long-term), due to
//   shareholders and directors 2780 to 2783 and 3260 to 3263 (long-term), and their sub-lines, netted.
import { fiscalStart, rangeInput, type AcctType, type Books } from "./ledger.ts";

const whole = (line: string | null | undefined) => (line ? Math.trunc(Number(line)) : NaN);
const within = (line: string | null | undefined, ranges: [number, number][]) => { const n = whole(line); return ranges.some(([a, b]) => n >= a && n <= b); };

export const CASH_LINES: [number, number][] = [[1000, 1007]];
export const DUE_FROM_SHAREHOLDER: [number, number][] = [[1300, 1303], [2180, 2183]];
export const DUE_TO_SHAREHOLDER: [number, number][] = [[2780, 2783], [3260, 3263]];
export const isCashLine = (line: string | null | undefined) => within(line, CASH_LINES);
export const isShareholderLine = (line: string | null | undefined) => within(line, DUE_FROM_SHAREHOLDER) || within(line, DUE_TO_SHAREHOLDER);

// balances: each account's balance, debits positive. Returns cash (debit positive) and the shareholder figure (positive:
// owed to the shareholder), with the accounts behind each.
export function overviewFigures(balances: Map<string, number>, lineOf: (key: string) => string | null | undefined) {
  const cashKeys: string[] = [], shKeys: string[] = [];
  let cash = 0, sh = 0;
  for (const [k, c] of balances) {
    const line = lineOf(k);
    if (isCashLine(line)) { cashKeys.push(k); cash += c; }
    if (isShareholderLine(line)) { shKeys.push(k); sh -= c; }
  }
  return { cash, cashKeys, shareholder: sh, shareholderKeys: shKeys };
}

// The Overview's figures on a date, worked out the way the Overview page does (one path for the page and its test):
// each account's balance on the date (income closed at each year end), read by GIFI line.
type BooksLike = { books: Books; typeOf: (ident: string) => AcctType | undefined; re: string;
  byIdent: Map<string, { number: string; name: string; line_no: string | null }> };
export function overviewOn(b: BooksLike, date: string) {
  const chart = new Map([...b.byIdent].map(([k, a]) => [k, { number: a.number, name: a.name, line_no: a.line_no }]));
  const r = rangeInput(b.books, fiscalStart(b.books, date), date, b.typeOf, b.re, chart);
  const bal = new Map<string, number>();
  for (const p of r.postings) bal.set(p.key, (bal.get(p.key) ?? 0) + p.cents);
  return overviewFigures(bal, (k) => b.byIdent.get(k)?.line_no ?? b.books.info.get(k)?.line_no);
}
