import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbDoc, CbFileRow } from "./files";

export type CbClient = { id: string; legal_name: string; business_number: string; year_end_md: string; taxdome_tags: string[]; province: string; signing_officer: string; street_address?: string; city?: string; postal_code?: string };
export type CbAccount = { id: string; account_key: string; number: string; name: string; last_year: number; this_year: number; line_no: string | null; tax_code: string | null;
  side_confirm_reason?: string | null; side_confirmed_line?: string | null; side_confirmed_by?: string | null; side_confirmed_at?: string | null;
  client_new?: boolean; qbo_type?: string | null; account_type?: string | null; type_source?: string | null;
  type_confirm_reason?: string | null; type_confirmed_line?: string | null; type_confirmed_by?: string | null; type_confirmed_at?: string | null;
  mapping_source: string | null; needs_reviewer: boolean; reviewer_reason: string };
export type CbEntry = { id: string; kind: string; number: number; seq: number; wp_ref: string; reason: string; note: string; reverse_next_year: boolean; needs_review: boolean; reviewed_at: string | null;
  reviewed_by: string | null; created_by: string | null; created_at: string; entry_date?: string | null; attachments?: string[]; origin?: string | null; lines: { account_id: string; amount: number; memo: string; tax_code?: string | null; is_tax?: boolean }[] };
export type CbImport = { target: string; source: string; file_name: string; rows: number; debit_total: number; credit_total: number; imported_at: string; who: { full_name: string } | null };
export type ListedFile = CbFileRow & { client: { legal_name: string } | null; docs: CbDoc[];
  // For the 9-step "Step" and "Next job" columns (Nov 13, 2026).
  stmts?: { account_id: string; period_start: string; period_end: string; opening: number; closing: number }[]; baccts?: { id: string; name: string }[]; imps?: { target: string }[]; accts?: { line_no: string | null; needs_reviewer: boolean }[]; ents?: { id: string }[];
  // Round 8: sign-offs and notes not yet cleared, for the Step and Next job columns.
  signs?: { step: string; prepared_at: string | null; reviewed_at: string | null }[]; rnotes?: { step: string; status: string }[] };

const DOC_COLS = "code, phase, title, detail, sort_order, status, prepared_by, prepared_at, reviewed_by, reviewed_at";

export async function staffNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await supabase.from("staff").select("id, full_name");
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
}

// Files for the lists; mine: only files where this person is the preparer or the reviewer.
export async function loadFileList(supabase: SupabaseClient, mine?: string): Promise<ListedFile[]> {
  let q = supabase.from("cb_files").select(`id, client_id, year_start, year_end, year_change_reason, file_type, books, preparer_id, reviewer_id, phase, created_at, client:client_id(legal_name), docs:cb_documents(${DOC_COLS}), stmts:cb_bank_statements(account_id, period_start, period_end, opening, closing), baccts:cb_bank_accounts(id, name), imps:cb_imports(target), accts:cb_accounts(line_no, needs_reviewer), ents:cb_entries(id), signs:cb_step_signoffs(step, prepared_at, reviewed_at), rnotes:cb_review_notes(step, status)`).order("year_end");
  if (mine) q = q.or(`preparer_id.eq.${mine},reviewer_id.eq.${mine}`);
  const { data } = await q;
  return (data ?? []) as unknown as ListedFile[];
}

export async function loadFile(supabase: SupabaseClient, id: string) {
  const { data: f } = await supabase.from("cb_files").select("id, client_id, year_start, year_end, year_change_reason, file_type, books, preparer_id, reviewer_id, phase, created_at, setup, opening_source, opening_re_stated, opening_set_at, opening_note, opening_pdf, opening_ni_typed, opening_signed_by, opening_signed_at").eq("id", id).maybeSingle();
  if (!f) return null;
  const [{ data: client }, { data: docs }, { data: accounts }, { data: imports }, names] = await Promise.all([
    supabase.from("clients").select("id, legal_name, business_number, year_end_md, taxdome_tags, province, signing_officer, street_address, city, postal_code").eq("id", f.client_id).maybeSingle(),
    supabase.from("cb_documents").select(DOC_COLS).eq("file_id", id).order("sort_order"),
    supabase.from("cb_accounts").select("id, account_key, number, name, last_year, this_year, line_no, tax_code, mapping_source, needs_reviewer, reviewer_reason, client_new, qbo_type, account_type, type_source, type_confirm_reason, type_confirmed_line, type_confirmed_by, type_confirmed_at, side_confirm_reason, side_confirmed_line, side_confirmed_by, side_confirmed_at").eq("file_id", id).order("number").order("name"),
    supabase.from("cb_imports").select("target, source, file_name, rows, debit_total, credit_total, imported_at, who:imported_by(full_name)").eq("file_id", id).order("imported_at", { ascending: false }),
    staffNames(supabase),
  ]);
  const { data: notes } = await supabase.from("cb_flag_notes").select("account_id, reason, note").eq("file_id", id);
  const { data: entries } = await supabase.from("cb_entries").select("id, kind, number, seq, wp_ref, reason, note, reverse_next_year, needs_review, reviewed_at, reviewed_by, created_by, created_at, entry_date, attachments, origin, lines:cb_entry_lines(account_id, amount, memo, tax_code, is_tax)")
    .eq("file_id", id).order("seq");
  return {
    notes: new Map(((notes ?? []) as { account_id: string; reason: string; note: string }[]).map((n) => [n.account_id, { reason: n.reason, note: n.note }])),
    entries: ((entries ?? []) as unknown as CbEntry[]).map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, amount: Number(l.amount) })) })),
    file: f as CbFileRow, client: client as CbClient | null, docs: (docs ?? []) as CbDoc[],
    accounts: ((accounts ?? []) as CbAccount[]).map((a) => ({ ...a, last_year: Number(a.last_year), this_year: Number(a.this_year) })),
    imports: (imports ?? []) as unknown as CbImport[], names,
  };
}

// Closebook's reference data for a file page: the master lines, lead sheets, tax codes and thresholds.
export async function loadReference(supabase: SupabaseClient) {
  const [{ data: lines }, { data: sheets }, { data: taxes }, { data: settings }, { data: gifi }] = await Promise.all([
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, section, locked").order("sort_order"),
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
