// What the reports read, gathered live every time a report opens (Hashim, Nov 15, 2026): the postings of
// the bank lines and opening balances (bank-statement files) or the imported trial balance (other
// files), plus every adjusting entry. Nothing is stored as a copy.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Posting } from "./tb-build";
import { entryNo, type LineInfo, type RepAccount } from "./reports";
import type { CbAccount, CbEntry } from "./server";
import type { CbFileRow } from "./files";
import { fromStatements } from "./steps";
import { livePostings } from "./tb-build-server";

// acctOf: the report account an entry line posts to (number and name as the reports show it).
export type ReportData = { accounts: RepAccount[]; postings: Posting[]; info: (line_no: string | null) => LineInfo | null; bankFile: boolean; entryLabel: Map<string, string>;
  acctOf: (accountId: string) => { key: string; number: string; name: string; gifi: string } | null };

export async function loadReportData(supabase: SupabaseClient, file: CbFileRow, stored: CbAccount[], entries: CbEntry[],
  lines: { line_no: string; line_type: string; lead_sheet: string | null }[], sheets: { code: string; name: string }[]): Promise<ReportData> {
  const sheetName = new Map(sheets.map((s) => [s.code, s.name]));
  const lineMap = new Map(lines.map((l) => [l.line_no, l]));
  const info = (line_no: string | null): LineInfo | null => {
    const l = line_no ? lineMap.get(line_no) : undefined;
    return l ? { type: l.line_type, sheet: l.lead_sheet, sheetName: l.lead_sheet ? sheetName.get(l.lead_sheet) ?? "" : "" } : null;
  };
  const bankFile = fromStatements(file.books);
  const byId = new Map(stored.map((a) => [a.id, a]));
  const accounts = new Map<string, RepAccount>();
  const postings: Posting[] = [];
  if (bankFile) {
    const live = await livePostings(supabase, file.id);
    for (const r of live?.rows ?? []) accounts.set(r.key, { key: r.key, number: r.number, name: r.name, line_no: r.line_no, lastCents: r.lastCents });
    postings.push(...(live?.postings ?? []));
    // A GIFI line chosen by hand in GIFI mapping wins over the chart's line.
    for (const a of stored) {
      const cur = accounts.get(a.account_key);
      if (cur && a.line_no && (a.mapping_source === "preparer" || a.mapping_source === "reviewer")) cur.line_no = a.line_no;
    }
  } else {
    for (const a of stored) {
      const c = Math.round(a.this_year * 100);
      if (c) postings.push({ key: a.account_key, cents: c, date: file.year_end, kind: "import", ref: "", label: "Trial balance import" });
    }
  }
  // Bank-statement files: an entry posted to a GIFI line lands on the standard chart account on that
  // line (8670.00 is 61500 Amortization), so every account keeps a number. A line with no chart account
  // (3720 Prior period adjustments) keeps its GIFI line.
  const keyOf = new Map<string, string>();
  if (bankFile) {
    const { data: chart } = await supabase.from("cb_chart_accounts").select("number, name, line_no").order("sort_order");
    const onLine = new Map<string, { number: string; name: string; line_no: string }>();
    for (const c of (chart ?? []) as { number: string; name: string; line_no: string }[]) if (!onLine.has(c.line_no)) onLine.set(c.line_no, c);
    for (const a of stored) {
      const c = a.account_key.startsWith("line:") && a.line_no ? onLine.get(a.line_no) : undefined;
      if (!c) continue;
      keyOf.set(a.account_key, `chart:${c.number}`);
      if (!accounts.has(`chart:${c.number}`)) accounts.set(`chart:${c.number}`, { key: `chart:${c.number}`, number: c.number, name: c.name, line_no: c.line_no, lastCents: 0 });
    }
  }
  // Accounts only an entry or the import uses.
  for (const a of stored) if (!keyOf.has(a.account_key) && !accounts.has(a.account_key)) accounts.set(a.account_key, { key: a.account_key, number: a.number, name: a.name, line_no: a.line_no, lastCents: bankFile ? 0 : Math.round(a.last_year * 100) });
  const entryLabel = new Map<string, string>();
  for (const e of entries) {
    const no = entryNo(file.year_end, e);
    const label = `${no}${e.note ? `: ${e.note}` : ""}`;
    entryLabel.set(e.id, no);
    for (const l of e.lines) {
      const a = byId.get(l.account_id);
      const c = Math.round(l.amount * 100);
      if (a && c) postings.push({ key: keyOf.get(a.account_key) ?? a.account_key, cents: c, date: file.year_end, kind: "entry", ref: e.id, entryKind: e.kind as "AJE" | "RJE" | "TJE", label: l.memo ? `${label} (${l.memo})` : label });
    }
  }
  const acctOf = (id: string) => {
    const a = byId.get(id);
    const r = a ? accounts.get(keyOf.get(a.account_key) ?? a.account_key) : undefined;
    return r ? { key: r.key, number: r.number, name: r.name, gifi: (r.line_no ?? "").replace(/\.00$/, "") } : null;
  };
  return { accounts: [...accounts.values()], postings, info, bankFile, entryLabel, acctOf };
}
