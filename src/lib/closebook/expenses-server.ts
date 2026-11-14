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
  gst_accepted_diff: number | null; gst_accepted_by: string | null; gst_accepted_at: string | null; t4a_accepted_diff: number | null; t4a_accepted_by: string | null; t4a_accepted_at: string | null;
  // From the database: over the threshold, a source entered, and not accepted at this signed amount.
  waiting: boolean; gst_waiting: boolean; t4a_waiting: boolean;
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
    t4a_explained_diff: raw.t4a_explained_diff == null ? null : n(raw.t4a_explained_diff), accepted_diff: raw.accepted_diff == null ? null : n(raw.accepted_diff),
    gst_accepted_diff: raw.gst_accepted_diff == null ? null : n(raw.gst_accepted_diff), t4a_accepted_diff: raw.t4a_accepted_diff == null ? null : n(raw.t4a_accepted_diff),
    waiting: raw.waiting === true, gst_waiting: raw.gst_waiting === true, t4a_waiting: raw.t4a_waiting === true,
  };
  return { state, sources: ((src ?? []) as RevenueSource[]).map((x) => ({ ...x, amount: Number(x.amount) })) };
}
// What waits for the reviewer on step 6, one item per check (A5).
export const revenueWaiting = (s: RevenueState) => [
  ...(s.waiting ? [{ label: "Revenue difference over the review threshold", diff: s.diff, explained: s.explained, text: s.explanation }] : []),
  ...(s.gst_waiting ? [{ label: "GST/HST returns difference over the review threshold", diff: s.gst_diff, explained: s.gst_explained, text: s.gst_explanation }] : []),
  ...(s.t4a_waiting ? [{ label: "T4A difference over the review threshold", diff: s.t4a_diff, explained: s.t4a_explained, text: s.t4a_explanation }] : []),
];

export type ExpensesData = {
  standardId: string; defs: ExpenseDef[]; autoTax: string; autoEntry: boolean; registered: boolean; quick: boolean;
  chart: { number: string; name: string; type: string; line_no: string }[];
  // What the form shows. shown: each chart account as it posts on this file (on a client who keeps their
  // own books, their account on the same GIFI line, or the new account Closebook will name). shareholders:
  // the accounts the credit can go to (round 9 fix 7: Cedar's own 26000, not the firm's 23000).
  own: boolean; shown: Record<string, string>; shareholders: { value: string; label: string }[];
};

export async function loadExpenses(supabase: SupabaseClient, file: CbFileRow): Promise<ExpensesData | null> {
  const [{ data: std }, { data: auto }, { data: chart }] = await Promise.all([
    supabase.from("cb_standard_entries").select("id").eq("style", "lines").eq("name", "Expenses paid personally").maybeSingle(),
    supabase.from("cb_standard_entries").select("id, tax_mode").eq("name", "Auto expenses").maybeSingle(),
    supabase.from("cb_chart_accounts").select("number, name, account_type, line_no").order("sort_order"),
  ]);
  if (!std) return null;
  const [{ data: lines }, { count }, { data: accts }] = await Promise.all([
    supabase.from("cb_standard_entry_lines").select("key, name, account, tax, share, capital, to_reviewer, pick, note_required, choices").eq("standard_id", std.id).order("sort_order"),
    auto ? supabase.from("cb_entries").select("id", { count: "exact", head: true }).eq("file_id", file.id).eq("standard_id", auto.id) : Promise.resolve({ count: 0 }),
    supabase.from("cb_accounts").select("id, account_key, number, name, line_no, client_new").eq("file_id", file.id).order("number"),
  ]);
  const charts = ((chart ?? []) as { number: string; name: string; account_type: string; line_no: string | null }[]).map((c) => ({ number: c.number, name: c.name, type: c.account_type, line_no: c.line_no ?? "" }));
  const own = ["client_software", "bookkeeper"].includes(file.books);
  // The client's own accounts, as cb_add_entry picks them: not new, numbered, first by number.
  type A = { id: string; account_key: string; number: string; name: string; line_no: string | null; client_new: boolean };
  const theirs = ((accts ?? []) as A[]).filter((a) => a.line_no && a.number && !a.client_new && !a.account_key.startsWith("line:") && !a.account_key.startsWith("gifi:"));
  const onLine = (line: string) => theirs.find((a) => a.line_no === line);
  const shown: Record<string, string> = {};
  for (const c of charts) {
    const a = own ? onLine(c.line_no) : undefined;
    shown[c.number] = !own ? `${c.number} ${c.name}` : a ? `${a.number} ${a.name}` : `New account: ${c.name}`;
  }
  const holderCharts = charts.filter((c) => c.number === "23000" || c.number === "23050");
  const ownHolders = own ? theirs.filter((a) => holderCharts.some((c) => c.line_no === a.line_no)) : [];
  const shareholders = ownHolders.length ? ownHolders.map((a) => ({ value: `acct:${a.id}`, label: `${a.number} ${a.name}` }))
    : holderCharts.map((c) => ({ value: c.number, label: shown[c.number] }));
  const setup = (file.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  return {
    standardId: std.id as string, defs: (lines ?? []) as ExpenseDef[], autoTax: (auto?.tax_mode as string) ?? "line", autoEntry: (count ?? 0) > 0,
    // The same reading of the GST/HST answers as the journal entry form (round 2 item 11).
    registered: setup.gst_registered !== false, quick: setup.quick_method === true,
    chart: charts, own, shown, shareholders,
  };
}
