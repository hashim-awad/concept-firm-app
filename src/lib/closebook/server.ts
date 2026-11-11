import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbDoc, CbFileRow } from "./files";

export type CbClient = { id: string; legal_name: string; business_number: string; year_end_md: string; taxdome_tags: string[]; province: string; signing_officer: string };
export type CbAccount = { id: string; account_key: string; number: string; name: string; last_year: number; this_year: number; line_no: string | null; tax_code: string | null;
  mapping_source: string | null; needs_reviewer: boolean; reviewer_reason: string };
export type CbEntry = { id: string; kind: string; number: number; reason: string; note: string; reverse_next_year: boolean; needs_review: boolean; reviewed_at: string | null;
  reviewed_by: string | null; created_by: string | null; created_at: string; lines: { account_id: string; amount: number; memo: string }[] };
export type CbImport = { target: string; source: string; file_name: string; rows: number; debit_total: number; credit_total: number; imported_at: string; who: { full_name: string } | null };
export type ListedFile = CbFileRow & { client: { legal_name: string } | null; docs: CbDoc[] };

const DOC_COLS = "code, phase, title, detail, sort_order, status, prepared_by, prepared_at, reviewed_by, reviewed_at";

export async function staffNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await supabase.from("staff").select("id, full_name");
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
}

// Files for the lists; mine: only files where this person is the preparer or the reviewer.
export async function loadFileList(supabase: SupabaseClient, mine?: string): Promise<ListedFile[]> {
  let q = supabase.from("cb_files").select(`id, client_id, year_start, year_end, year_change_reason, file_type, books, preparer_id, reviewer_id, phase, created_at, client:client_id(legal_name), docs:cb_documents(${DOC_COLS})`).order("year_end");
  if (mine) q = q.or(`preparer_id.eq.${mine},reviewer_id.eq.${mine}`);
  const { data } = await q;
  return (data ?? []) as unknown as ListedFile[];
}

export async function loadFile(supabase: SupabaseClient, id: string) {
  const { data: f } = await supabase.from("cb_files").select("id, client_id, year_start, year_end, year_change_reason, file_type, books, preparer_id, reviewer_id, phase, created_at").eq("id", id).maybeSingle();
  if (!f) return null;
  const [{ data: client }, { data: docs }, { data: accounts }, { data: imports }, names] = await Promise.all([
    supabase.from("clients").select("id, legal_name, business_number, year_end_md, taxdome_tags, province, signing_officer").eq("id", f.client_id).maybeSingle(),
    supabase.from("cb_documents").select(DOC_COLS).eq("file_id", id).order("sort_order"),
    supabase.from("cb_accounts").select("id, account_key, number, name, last_year, this_year, line_no, tax_code, mapping_source, needs_reviewer, reviewer_reason").eq("file_id", id).order("number").order("name"),
    supabase.from("cb_imports").select("target, source, file_name, rows, debit_total, credit_total, imported_at, who:imported_by(full_name)").eq("file_id", id).order("imported_at", { ascending: false }),
    staffNames(supabase),
  ]);
  const { data: entries } = await supabase.from("cb_entries").select("id, kind, number, reason, note, reverse_next_year, needs_review, reviewed_at, reviewed_by, created_by, created_at, lines:cb_entry_lines(account_id, amount, memo)")
    .eq("file_id", id).order("kind").order("number");
  return {
    entries: ((entries ?? []) as unknown as CbEntry[]).map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, amount: Number(l.amount) })) })),
    file: f as CbFileRow, client: client as CbClient | null, docs: (docs ?? []) as CbDoc[],
    accounts: ((accounts ?? []) as CbAccount[]).map((a) => ({ ...a, last_year: Number(a.last_year), this_year: Number(a.this_year) })),
    imports: (imports ?? []) as unknown as CbImport[], names,
  };
}

// Closebook's reference data for a file page: the master lines, lead sheets, tax codes and thresholds.
export async function loadReference(supabase: SupabaseClient) {
  const [{ data: lines }, { data: sheets }, { data: taxes }, { data: settings }, { data: gifi }] = await Promise.all([
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, section").order("sort_order"),
    supabase.from("cb_lead_sheets").select("code, name").order("sort_order"),
    supabase.from("cb_tax_codes").select("code, name").order("sort_order"),
    supabase.from("cb_settings").select("flag_amount, flag_percent, entry_review_amount").maybeSingle(),
    supabase.from("cb_gifi_codes").select("code, description, cb_gifi_versions!inner(is_current)").eq("cb_gifi_versions.is_current", true),
  ]);
  return {
    lines: (lines ?? []) as import("./matching").Line[], sheets: (sheets ?? []) as { code: string; name: string }[], taxes: (taxes ?? []) as { code: string; name: string }[],
    flag: { amount: Number(settings?.flag_amount ?? 5000), percent: Number(settings?.flag_percent ?? 20) },
    // CRA's description of each GIFI code (Appendix A), for the hint in the line picker.
    craText: new Map(((gifi ?? []) as { code: string; description: string }[]).map((g) => [g.code, g.description])),
  };
}
