import "server-only";
// Piece 8: Reporting > Shareholder loans, loaded live from the postings (the same as the other reports), with the
// shareholder names ("Who is who": this file's, else the client's latest earlier file's, so a name rolls forward).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbAccount, CbEntry } from "./server";
import type { CbFileRow } from "./files";
import { loadReportData } from "./report-data";
import { keepsOwnBooks } from "./books";
import { entryNo } from "./reports";
import { buildShReport, type ShEntryRef, type ShReport } from "./sh-report";

export async function loadShNames(supabase: SupabaseClient, file: Pick<CbFileRow, "id" | "client_id" | "year_end">): Promise<Map<string, string>> {
  const { data } = await supabase.from("cb_sh_names").select("account_key, name, file:file_id!inner(id, client_id, year_end)")
    .eq("file.client_id", file.client_id).lte("file.year_end", file.year_end);
  type Row = { account_key: string; name: string; file: { id: string; year_end: string } };
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => (a.file.id === file.id ? -1 : b.file.id === file.id ? 1 : b.file.year_end.localeCompare(a.file.year_end)));
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.account_key)) continue;
    seen.add(r.account_key);
    if (r.name) out.set(r.account_key, r.name);
  }
  return out;
}

export async function loadShReport(supabase: SupabaseClient, file: CbFileRow, accounts: CbAccount[], entries: CbEntry[],
  lines: { line_no: string; line_type: string; lead_sheet: string | null }[], sheets: { code: string; name: string }[]): Promise<ShReport> {
  const [data, holders] = await Promise.all([loadReportData(supabase, file, accounts, entries, lines, sheets), loadShNames(supabase, file)]);
  // The trial balance as stored (the balance plus entries), on the reports' accounts, as the schedule ties to it.
  const onAcct = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) onAcct.set(l.account_id, (onAcct.get(l.account_id) ?? 0) + Math.round(l.amount * 100));
  const tb = new Map<string, number>();
  for (const a of accounts) {
    const key = data.acctOf(a.id)?.key ?? a.account_key;
    tb.set(key, (tb.get(key) ?? 0) + Math.round(a.this_year * 100) + (onAcct.get(a.id) ?? 0));
  }
  const refs = new Map<string, ShEntryRef>(entries.map((e) => [e.id, { no: entryNo(file.year_end, e), kind: e.kind, wpRef: e.wp_ref ?? "" }]));
  return buildShReport({
    accounts: data.accounts.map((a) => ({ key: a.key, number: a.number, name: a.name, line_no: a.line_no, lastCents: a.lastCents, tbCents: tb.get(a.key) ?? 0 })),
    postings: data.postings, entries: refs, own: keepsOwnBooks(file), yearEnd: file.year_end, holders,
  });
}
