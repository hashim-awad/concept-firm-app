// Step 5, round 9 (Hashim, Nov 27, 2026): what the revenue check and the "Expenses paid personally" form
// read. The page and the save actions read the same, so the server works the entry out again exactly as
// the form showed it.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbFileRow } from "./files";
import type { ExpenseDef } from "./expenses";

export type RevenueState = {
  tb: number; sources: number; n_sources: number; diff: number; gst: number; n_gst: number; gst_diff: number; commission: number; n_commission: number;
  t4a: number; n_t4a: number; t4a_diff: number; threshold: number; realtor: boolean; registrant: boolean;
  explanation: string; gst_explanation: string; t4a_explanation: string; t4a_none: boolean;
  explained: boolean; gst_explained: boolean; t4a_explained: boolean; explained_diff: number | null; gst_explained_diff: number | null; t4a_explained_diff: number | null; accepted_diff: number | null; accepted_by: string | null; accepted_at: string | null;
};
export type RevenueSource = { id: string; kind: string; payer: string; label: string; amount: number; attachment: string; created_at: string };

export async function loadRevenue(supabase: SupabaseClient, fileId: string) {
  const [{ data: st }, { data: src }] = await Promise.all([
    supabase.rpc("cb_revenue_status", { p_file: fileId }),
    supabase.from("cb_revenue_sources").select("id, kind, payer, label, amount, attachment, created_at").eq("file_id", fileId).order("created_at"),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  const raw = (st ?? {}) as Record<string, unknown>;
  const state: RevenueState = {
    ...(raw as unknown as RevenueState),
    tb: n(raw.tb), sources: n(raw.sources), diff: n(raw.diff), gst: n(raw.gst), gst_diff: n(raw.gst_diff), commission: n(raw.commission), t4a: n(raw.t4a), t4a_diff: n(raw.t4a_diff),
    threshold: n(raw.threshold),
    explained_diff: raw.explained_diff == null ? null : n(raw.explained_diff), gst_explained_diff: raw.gst_explained_diff == null ? null : n(raw.gst_explained_diff),
    t4a_explained_diff: raw.t4a_explained_diff == null ? null : n(raw.t4a_explained_diff), accepted_diff: raw.accepted_diff === null || raw.accepted_diff === undefined ? null : n(raw.accepted_diff),
  };
  return { state, sources: ((src ?? []) as RevenueSource[]).map((x) => ({ ...x, amount: Number(x.amount) })) };
}
// Over the threshold and not accepted at this amount: it waits for the reviewer (A5).
export const revenueWaiting = (s: RevenueState) => Math.abs(s.diff) > s.threshold && s.accepted_diff !== s.diff;

export type ExpensesData = {
  standardId: string; defs: ExpenseDef[]; autoTax: string; autoEntry: boolean; registered: boolean; quick: boolean;
  chart: { number: string; name: string; type: string; line_no: string }[];
};

export async function loadExpenses(supabase: SupabaseClient, file: CbFileRow): Promise<ExpensesData | null> {
  const [{ data: std }, { data: auto }, { data: chart }] = await Promise.all([
    supabase.from("cb_standard_entries").select("id").eq("style", "lines").eq("name", "Expenses paid personally").maybeSingle(),
    supabase.from("cb_standard_entries").select("id, tax_mode").eq("name", "Auto expenses").maybeSingle(),
    supabase.from("cb_chart_accounts").select("number, name, account_type, line_no").order("sort_order"),
  ]);
  if (!std) return null;
  const [{ data: lines }, { count }] = await Promise.all([
    supabase.from("cb_standard_entry_lines").select("key, name, account, tax, share, capital, to_reviewer, pick, note_required, choices").eq("standard_id", std.id).order("sort_order"),
    auto ? supabase.from("cb_entries").select("id", { count: "exact", head: true }).eq("file_id", file.id).eq("standard_id", auto.id) : Promise.resolve({ count: 0 }),
  ]);
  const setup = (file.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  return {
    standardId: std.id as string, defs: (lines ?? []) as ExpenseDef[], autoTax: (auto?.tax_mode as string) ?? "line", autoEntry: (count ?? 0) > 0,
    // The same reading of the GST/HST answers as the journal entry form (round 2 item 11).
    registered: setup.gst_registered !== false, quick: setup.quick_method === true,
    chart: ((chart ?? []) as { number: string; name: string; account_type: string; line_no: string | null }[]).map((c) => ({ number: c.number, name: c.name, type: c.account_type, line_no: c.line_no ?? "" })),
  };
}
