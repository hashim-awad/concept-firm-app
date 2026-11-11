import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbDoc, CbFileRow } from "./files";

export type CbClient = { id: string; legal_name: string; business_number: string; year_end_md: string; taxdome_tags: string[]; province: string; signing_officer: string };
export type CbAccount = { id: string; number: string; name: string; last_year: number; this_year: number };
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
    supabase.from("cb_accounts").select("id, number, name, last_year, this_year").eq("file_id", id).order("number").order("name"),
    supabase.from("cb_imports").select("target, source, file_name, rows, debit_total, credit_total, imported_at, who:imported_by(full_name)").eq("file_id", id).order("imported_at", { ascending: false }),
    staffNames(supabase),
  ]);
  return {
    file: f as CbFileRow, client: client as CbClient | null, docs: (docs ?? []) as CbDoc[],
    accounts: ((accounts ?? []) as CbAccount[]).map((a) => ({ ...a, last_year: Number(a.last_year), this_year: Number(a.this_year) })),
    imports: (imports ?? []) as unknown as CbImport[], names,
  };
}
