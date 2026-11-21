// Round 24 (Hashim, Nov 16, 2026, rule 20): the file's history (the clock in the file header). Every event: when,
// who, what, the statement or line, the reason, the old and new values. Append-only in the database. The Review right reads it (R3a-1).
import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoryRow = { at: string; who: string; action: string; step: string; detail: string; ref: string; reason: string; old: string; new: string; erased: boolean;
  entryId?: string | null; lineId?: string | null; statementId?: string | null };

// CB2-0 step 2: one item's history (an entry, a bank line or a statement), QBO's "Audit history" of a transaction.
export type HistoryItem = { entry?: string; line?: string; statement?: string };
export async function loadHistory(supabase: SupabaseClient, fileId: string, names: Map<string, string>, step?: string | null, item?: HistoryItem): Promise<HistoryRow[]> {
  let q = supabase.from("cb_file_history").select("at, actor_id, action, step, detail, ref_label, reason, old_value, new_value, erased_at, entry_id, line_id, statement_id").eq("file_id", fileId);
  if (step) q = q.eq("step", step);
  if (item?.entry) q = q.eq("entry_id", item.entry);
  if (item?.line) q = q.eq("line_id", item.line);
  if (item?.statement) q = q.eq("statement_id", item.statement);
  const { data } = await q.order("at", { ascending: false }).order("id", { ascending: false }).limit(2000);
  type R = { at: string; actor_id: string | null; action: string; step: string | null; detail: string; ref_label: string | null; reason: string | null; old_value: string | null; new_value: string | null; erased_at: string | null;
    entry_id: string | null; line_id: string | null; statement_id: string | null };
  return ((data ?? []) as R[]).map((h) => ({ at: h.at, who: h.actor_id ? names.get(h.actor_id) ?? "" : "System", action: h.action, step: h.step ?? "", detail: h.detail,
    ref: h.ref_label ?? "", reason: h.reason ?? "", old: h.old_value ?? "", new: h.new_value ?? "", erased: !!h.erased_at,
    entryId: h.entry_id, lineId: h.line_id, statementId: h.statement_id }));
}

// CB2-0 step 2 (rule 14): the steps a change affects. Its own step; a change to steps 2 to 5 moves the trial balance,
// so steps 6, 8 and 9 rest on it too; a change to step 8 reaches step 9.
const TB_STEPS = ["opening", "records", "code", "entries"];
// Step 7 (the reviewer's overall review) and step 10 rest on every step after step 1 (CB2-0 review round). "mal": any change
// after the MAL was signed, in its own group, as the MAL covers every entry made during the compilation.
export const affectedSteps = (step: string): string[] =>
  TB_STEPS.includes(step) ? [step, "compare", "review", "t2", "statements", "lock", "mal"]
    : step === "compare" ? ["compare", "review", "lock", "mal"] : step === "t2" ? ["t2", "review", "statements", "lock", "mal"]
    : step === "statements" ? ["statements", "lock", "mal"] : step ? [step, "mal"] : [];
// Rows that are sign-offs, not changes.
const SIGN_ACTIONS = new Set(["prepared", "reviewed", "unsigned_prepared", "unsigned_reviewed", "signoff_removed", "signoff_cleared", "signoff_changed"]);

// History > "Changed after sign-off": the changes made after the latest sign-off of the steps they affect. Each change
// shows once, under the first of those steps in the steps' order; "also" names the others (UI review: no repeated rows).
// A step not signed lists nothing.
export function changedAfterSignoff(rows: HistoryRow[], signs: Record<string, { prepared_at?: string | null; reviewed_at?: string | null } | undefined>, order: string[]) {
  const latest = (k: string) => { const s = signs[k]; const t = [s?.prepared_at, s?.reviewed_at].filter((x): x is string => !!x).sort(); return t[t.length - 1] ?? null; };
  const groups = new Map<string, (HistoryRow & { also: string[] })[]>();
  for (const r of rows) {
    if (SIGN_ACTIONS.has(r.action) || r.erased) continue;
    const hit = order.filter((k) => affectedSteps(r.step).includes(k) && (() => { const t = latest(k); return !!t && Date.parse(r.at) > Date.parse(t); })());
    if (hit.length) groups.set(hit[0], [...(groups.get(hit[0]) ?? []), { ...r, also: hit.slice(1) }]);
  }
  return order.filter((k) => groups.has(k)).map((k) => ({ step: k, rows: groups.get(k)! }));
}

export const ACTION: Record<string, string> = {
  prepared: "Signed as preparer", reviewed: "Signed as reviewer", unsigned_prepared: "Took back the preparer sign-off", unsigned_reviewed: "Took back the reviewer sign-off",
  signoff_cleared: "Sign-offs cleared by a change (before CloseBook2)", changed: "Changed", mapping_changed: "Master account changed",
  entry_created: "Entry added", entry_changed: "Entry changed", note_added: "Review note added", note_replied: "Replied to a note", note_fixed: "Marked a note fixed",
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
  line_question: "Question to the client", questions_sent: "Client notified", questions_send_failed: "Email not sent", reclassified: "Reclassified", reclass_undone: "Reclassify undone", entry_line_reclassified: "Entry line reclassified", entry_edited: "Entry changed", entry_deleted: "Entry deleted", step5_covered: "Step 5 reviewed: what it covered", entry_booked: "Booked in QuickBooks", schedule_created: "Schedule created", schedule_input_changed: "Schedule input changed", schedule_method_switched: "Schedule method switched",
  schedule_itc: "Schedule ITC changed", schedule_put_in: "Schedule put into the entry", schedule_printed: "Schedule printed", schedule_deleted: "Entry deleted with its schedule", questions_marked_sent: "Questions marked as sent", client_answer: "Client answered",
  client_link_refused: "Client link refused", client_link_error: "Client link error",
  // Round 33: questions not sent yet.
  line_question_edited: "Question changed (not sent)", line_question_deleted: "Question deleted (not sent)", line_question_to_note: "Question moved to the internal note", line_reviewed: "Line marked reviewed", line_unreviewed: "Line back with the reviewer", account_reviewed: "Account marked reviewed", client_link_opened: "Client opened the link", questions_link_copied: "Link copied",
  // Before round 24 a statement could be deleted with its lines (rule 21: kept visible in the history).
  statement_undone: "Statement deleted (before round 24)", statement_discarded: "Uploaded statement removed",
};
export const actionLabel = (a: string) => ACTION[a] ?? a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
