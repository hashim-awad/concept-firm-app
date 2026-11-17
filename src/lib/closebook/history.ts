// Round 24 (Hashim, Nov 16, 2026, rule 20): the file's history (the clock in the file header). Every event: when,
// who, what, the statement or line, the reason, the old and new values. Append-only in the database. Owners read it.
import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoryRow = { at: string; who: string; action: string; step: string; detail: string; ref: string; reason: string; old: string; new: string; erased: boolean };

export async function loadHistory(supabase: SupabaseClient, fileId: string, names: Map<string, string>, step?: string | null): Promise<HistoryRow[]> {
  let q = supabase.from("cb_file_history").select("at, actor_id, action, step, detail, ref_label, reason, old_value, new_value, erased_at").eq("file_id", fileId);
  if (step) q = q.eq("step", step);
  const { data } = await q.order("at", { ascending: false }).order("id", { ascending: false }).limit(2000);
  type R = { at: string; actor_id: string | null; action: string; step: string | null; detail: string; ref_label: string | null; reason: string | null; old_value: string | null; new_value: string | null; erased_at: string | null };
  return ((data ?? []) as R[]).map((h) => ({ at: h.at, who: h.actor_id ? names.get(h.actor_id) ?? "" : "System", action: h.action, step: h.step ?? "", detail: h.detail,
    ref: h.ref_label ?? "", reason: h.reason ?? "", old: h.old_value ?? "", new: h.new_value ?? "", erased: !!h.erased_at }));
}

export const ACTION: Record<string, string> = {
  prepared: "Signed as preparer", reviewed: "Signed as reviewer", unsigned_prepared: "Took back the preparer sign-off", unsigned_reviewed: "Took back the reviewer sign-off",
  signoff_cleared: "Sign-offs cleared by a change", note_added: "Review note added", note_replied: "Replied to a note", note_fixed: "Marked a note fixed",
  note_cleared: "Cleared a note", note_reopened: "Reopened a note", checklist_saved: "Saved the completion checklist",
  revenue_accepted: "Accepted a revenue difference", gifi_exported: "Exported the GIFI file", t2_accepted: "Accepted a T2 tie-out difference", side_confirmed: "Kept a balance on the other side of its line",
  mal_sent: "Sent the MAL for signing", mal_signed: "The MAL was signed", mal_withdrawn: "The MAL was withdrawn",
  checklist_opened: "The checklist opened (MAL signed)", close_fields_saved: "Saved the email figures", filing_recorded: "Saved the filing record",
  delivered: "Uploaded to TaxDome and email sent", delivery_cleared: "Delivery cleared by a change", locked: "Locked the file", reopened: "Reopened the file",
  // Round 24
  signoff_removed: "Sign-off removed to make a change", statement_imported: "Statement imported", bank_csv: "CSV imported", statement_excluded: "Statement excluded",
  statement_restored: "Statement restored", statement_purged: "Statement purged", statement_file_replaced: "Statement file replaced",
  corrected_before_import: "Corrected before import", line_coded: "Line coded", line_uncoded: "Line uncoded", line_recoded: "Line coding changed",
  line_client: "Line on the client question list", line_reviewer: "Line sent to the reviewer", line_date: "Accounting date changed", line_memo: "Memo",
  transfer_matched: "Transfer matched", transfer_unmatched: "Transfer unmatched", bank_outstanding: "Outstanding item", bank_account_added: "Account added",
  bank_account_changed: "Account changed", bank_account_removed: "Account removed",
  // Round 26: the fix screen before import.
  line_added_before_import: "Added before import", line_removed_before_import: "Removed before import", line_changed_before_import: "Changed before import",
  statement_read_again: "Read again",
  upload_refused: "Upload refused",
  // Round 31, step 4 (QuickBooks Online's Bank transactions page).
  line_excluded: "Line excluded", line_restored: "Line back to Pending", line_answer: "Client's answer", line_file: "Receipt attached", pair_unpaired: "Unpaired",
  rule_saved: "Bank rule", excluded_reviewed: "Excluded lines reviewed",
  // Round 32: questions to the client.
  line_question: "Question to the client", questions_sent: "Client notified", questions_marked_sent: "Questions marked as sent", client_answer: "Client answered",
  client_link_refused: "Client link refused",
  // Before round 24 a statement could be deleted with its lines (rule 21: kept visible in the history).
  statement_undone: "Statement deleted (before round 24)", statement_discarded: "Uploaded statement removed",
};
export const actionLabel = (a: string) => ACTION[a] ?? a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
