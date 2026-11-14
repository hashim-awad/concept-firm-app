// The GIFI export (Hashim, Nov 13, 2026; changes PHASE3-BATCH.md 4.2): QuickBooks' GIFI file layout,
// exactly (docs/phase3/Sample-GIFI-TestCo.gfi). A "GIFI01" header line, then one "code",amount line per
// GIFI code, CRLF line endings, 2 decimals, no total lines. Closebook checks the required totals first
// and refuses to export when they do not tie. Pure: tests check it against the sample.
import { effectiveLine, type Line } from "./matching.ts";

export type GifiAccount = { id: string; number: string; name: string; line_no: string | null; this_year: number; needs_reviewer: boolean };
export type GifiTotals = { "2599": number; "3499": number; "3620": number; "3640": number; "8299": number; "9368": number; "9999": number; "3660": number; "3849": number };
// Round 10: tbOutBy (the trial balance difference), issues (accounts not ready: unmatched, waiting for the
// reviewer, on a total or locked line) and the retained earnings movements, for the checks on step 8.
export type GifiResult = { codes: [string, number][]; totals: GifiTotals; problems: string[]; tbOutBy: number; issues: string[];
  re: { dividends: number; ppa: number; other: number; shareEquity: number } };

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (code: string) => Number(code);
// Benchmark (Hashim's rule 1, Nov 14, 2026): QuickBooks Online's GIFI export, which ProFile imports, carries
// equity debits as negative amounts, dividends (3700 to 3740) included. No special case for deductions.

// The GIFI amount for a line, from a balance kept debit-positive: assets and expenses as debits,
// liabilities, equity and revenue as credits. A contra or deficit balance comes out negative.
export function gifiAmount(line: Pick<Line, "line_type" | "gifi_code">, debitPositive: number): number {
  if (line.line_type === "Asset" || line.line_type === "Expense") return cents(debitPositive);
  return cents(-debitPositive);
}

export function gifiCodes(accounts: GifiAccount[], entryTotals: Map<string, number>, lines: Map<string, Line>): GifiResult {
  const problems: string[] = [];
  const issues: string[] = [];
  const byCode = new Map<string, number>();
  let tb = 0;
  for (const a of accounts) {
    const fin = cents(a.this_year + (entryTotals.get(a.id) ?? 0));
    tb += fin;
    if (fin === 0) continue;
    const label = `${a.number ? `${a.number} ` : ""}${a.name}`;
    if (!a.line_no) { issues.push(`${label} is not matched to a GIFI line.`); continue; }
    if (a.needs_reviewer) issues.push(`${label} is waiting for the reviewer's decision.`);
    const eff = effectiveLine(a.line_no, fin, lines);
    const l = eff ? lines.get(eff) : undefined;
    if (!l) { issues.push(`${label}: its GIFI line ${a.line_no} no longer exists.`); continue; }
    if (!l.mappable) { issues.push(`${label} is on ${l.line_no}, a total line. Match it to a line that is not a total.`); continue; }
    if (l.locked) issues.push(`${label} is on ${l.line_no}, a locked line. Choose one of its sub-lines.`);
    // The trial balance's retained earnings is the balance at the start of the year: GIFI 3660.
    const code = l.gifi_code === "3600" ? "3660" : l.gifi_code;
    byCode.set(code, cents((byCode.get(code) ?? 0) + gifiAmount({ line_type: l.line_type, gifi_code: code }, fin)));
  }
  problems.push(...issues);
  if (Math.abs(cents(tb)) >= 0.01) problems.push(`The trial balance is out by ${cents(tb).toFixed(2)}.`);

  const typeOf = (code: string) => [...lines.values()].find((l) => l.gifi_code === code)?.line_type ?? "";
  let assets = 0, liabilities = 0, shareEquity = 0, revenue = 0, opExpenses = 0, allExpenses = 0, reMoves = 0, dividends = 0, ppa = 0, other = 0;
  for (const [code, amt] of byCode) {
    const t = code === "3660" ? "Equity" : typeOf(code), n = num(code);
    if (t === "Asset") assets += amt;
    else if (t === "Liability") liabilities += amt;
    else if (t === "Revenue") revenue += amt;
    else if (t === "Expense") { allExpenses += amt; if (n < 9369) opExpenses += amt; }
    else if (t === "Equity") {
      if (code === "3660") continue;
      if (n >= 3700 && n < 3849) {   // dividends (negative) and other retained earnings items
        reMoves += amt;
        if (n < 3720) dividends -= amt; else if (n < 3740) ppa += amt; else other += amt;
      }
      else shareEquity += amt;
    }
  }
  const netIncome = cents(revenue - allExpenses);
  const reEnd = cents((byCode.get("3660") ?? 0) + netIncome + reMoves);
  const totals: GifiTotals = {
    "2599": cents(assets), "3499": cents(liabilities), "3620": cents(shareEquity + reEnd), "3640": cents(liabilities + shareEquity + reEnd),
    "8299": cents(revenue), "9368": cents(opExpenses), "9999": netIncome, "3660": cents(byCode.get("3660") ?? 0), "3849": reEnd,
  };
  if (Math.abs(cents(totals["2599"] - totals["3640"])) >= 0.01) {
    problems.push(`Total assets (2599) ${totals["2599"].toFixed(2)} do not equal total liabilities and equity (3640) ${totals["3640"].toFixed(2)}: a difference of ${cents(totals["2599"] - totals["3640"]).toFixed(2)}.`);
  }
  const codes = [...byCode.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b));
  return { codes, totals, problems, tbOutBy: cents(tb), issues, re: { dividends: cents(dividends), ppa: cents(ppa), other: cents(other), shareEquity: cents(shareEquity) } };
}

// Round 10 (Hashim, Nov 27, 2026). Benchmark: QuickBooks Online's GIFI export, field for field. bn: the
// 15-character Business Number (123456789RC0001). vendor and software: positions 6 and 11; Closebook
// writes "Concept Accounting" and "Concept Studio" (the test passes QuickBooks' own to rebuild the sample).
export type GifiHeader = { bn: string; legalName: string; address: string; city: string; province: string; postal: string; yearEnd: string; created: string;
  vendor?: string; software?: string };

// A Business Number as the header needs it: 9 digits get the first corporate income tax account
// (RC0001); 15 characters are taken as they are. Anything else: null, and the export is refused.
export function businessNumber(bn: string | null | undefined): string | null {
  const t = (bn ?? "").replace(/\s+/g, "").toUpperCase();
  if (/^\d{9}$/.test(t)) return `${t}RC0001`;
  return /^\d{9}RC\d{4}$/.test(t) ? t : null;
}

// The file, byte for byte in QuickBooks' layout. Dates are YYYY-MM-DD in, YYYYMMDD out. CRLF between
// lines and none after the last, as the sample.
export function gifiFile(h: GifiHeader, codes: [string, number][]): string {
  const q = (v: string) => `"${v.replace(/"/g, "'")}"`;
  const ymd = (d: string) => d.replace(/-/g, "");
  const head = ["GIFI01", "", "", "", "", h.vendor ?? "Concept Accounting", "", "", "", "", h.software ?? "Concept Studio", "", "", h.bn, h.legalName, "", h.address, h.city, h.province, h.postal, "", ymd(h.yearEnd), ymd(h.created), ""];
  return [head.map(q).join(","), ...codes.map(([c, v]) => `"${c}",${v.toFixed(2)}`)].join("\r\n");
}
