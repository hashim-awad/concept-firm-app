// Which months of the file's year each bank or card account has statements for (Hashim, Nov 13, 2026;
// BRIEF.md "Bank upload, a statement period"; mockup step 2). Pure, so the step page, the file list and
// tests share one set of rules.
// - in: every day of the month (inside the file's year) is inside an uploaded statement period;
// - part: some days are; missing: none are;
// - empty: covered, but the account has no transactions that month: check the file is complete;
// - check: a statement's opening balance does not follow the closing balance before it.

export type MonthState = "in" | "part" | "missing" | "empty" | "check";
export type Month = { key: string; label: string; state: MonthState };
export type CovStatement = { account_id: string; period_start: string; period_end: string; opening: number; closing: number };
export type AccountCoverage = { months: Month[]; complete: boolean; inCount: number; latestClosing: number | null; gaps: string[] };

const LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

// The months of the file's year, each clipped to the year.
export function yearMonths(yearStart: string, yearEnd: string): { key: string; label: string; from: number; to: number }[] {
  const out = [];
  let y = +yearStart.slice(0, 4), m = +yearStart.slice(5, 7) - 1;
  const end = day(yearEnd);
  while (true) {
    const first = Date.UTC(y, m, 1) / 86400000, last = Date.UTC(y, m + 1, 0) / 86400000;
    if (first > end) break;
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: LABEL[m], from: Math.max(first, day(yearStart)), to: Math.min(last, end) });
    m++; if (m === 12) { m = 0; y++; }
  }
  return out;
}

export function accountCoverage(yearStart: string, yearEnd: string, statements: CovStatement[], txnMonths?: Set<string>): AccountCoverage {
  const sts = [...statements].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const spans = sts.map((s) => [day(s.period_start), day(s.period_end)] as const);
  const covered = (from: number, to: number) => {
    let at = from;
    for (const [a, b] of spans) { if (a > at) break; if (b >= at) at = b + 1; if (at > to) return "all"; }
    return spans.some(([a, b]) => a <= to && b >= from) ? "some" : "none";
  };
  // A statement whose opening does not follow the one before: its first month needs a look.
  const checkMonths = new Set<string>();
  for (let i = 1; i < sts.length; i++) {
    if (Math.round(sts[i].opening * 100) !== Math.round(sts[i - 1].closing * 100)) checkMonths.add(sts[i].period_start.slice(0, 7));
  }
  const months: Month[] = yearMonths(yearStart, yearEnd).map((m) => {
    const c = covered(m.from, m.to);
    let state: MonthState = c === "all" ? "in" : c === "some" ? "part" : "missing";
    if (state === "in" && txnMonths && !txnMonths.has(m.key)) state = "empty";
    if (state !== "missing" && checkMonths.has(m.key)) state = "check";
    return { key: m.key, label: m.label, state };
  });
  const gaps = months.filter((m) => m.state !== "in").map((m) => m.label + (m.state === "part" ? " (part)" : m.state === "empty" ? " (no transactions)" : m.state === "check" ? " (opening does not follow)" : ""));
  return { months, complete: gaps.length === 0, inCount: months.filter((m) => m.state === "in").length, latestClosing: sts.length ? sts[sts.length - 1].closing : null, gaps };
}

// The step 2 "next job" line: every account's missing months, in one sentence.
export function missingText(rows: { name: string; gaps: string[] }[]): string {
  const open = rows.filter((r) => r.gaps.length);
  if (!open.length) return "";
  const list = (g: string[]) => (g.length > 4 ? `${g.slice(0, 3).join(", ")} and ${g.length - 3} more` : g.join(", "));
  return open.map((r) => `${r.name}: ${list(r.gaps)}`).join(". ");
}

