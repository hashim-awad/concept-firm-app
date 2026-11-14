// Round 8 (Hashim, Nov 24, 2026): a file's sign-offs, open items and review notes, read from the
// database's own rules (cb_step_status), so the screens show exactly what the sign-off will check.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StepKey, StepSign } from "./steps";

export type StepStatus = {
  prepared_by: string | null; prepared_at: string | null; reviewed_by: string | null; reviewed_at: string | null;
  problems: string[]; waiting: string[]; notes: number; holds_preparer?: boolean;
};
export type ReviewNote = {
  id: string; step: StepKey; target_type: "step" | "account" | "entry" | "bank_line"; target_id: string | null; target_label: string; body: string;
  status: "open" | "fixed" | "cleared"; created_by: string; created_at: string; fixed_by: string | null; fixed_at: string | null; cleared_by: string | null; cleared_at: string | null;
  replies: { id: string; body: string; created_by: string; created_at: string }[];
};
export type ReviewData = { status: Partial<Record<StepKey, StepStatus>>; notes: ReviewNote[] };

export async function loadReview(supabase: SupabaseClient, fileId: string): Promise<ReviewData> {
  const [{ data: status }, { data: notes }] = await Promise.all([
    supabase.rpc("cb_step_status", { p_file: fileId }),
    supabase.from("cb_review_notes").select("id, step, target_type, target_id, target_label, body, status, created_by, created_at, fixed_by, fixed_at, cleared_by, cleared_at, replies:cb_review_note_replies(id, body, created_by, created_at)")
      .eq("file_id", fileId).order("created_at"),
  ]);
  return {
    status: (status ?? {}) as Partial<Record<StepKey, StepStatus>>,
    notes: ((notes ?? []) as unknown as ReviewNote[]).map((n) => ({ ...n, replies: [...n.replies].sort((a, b) => a.created_at.localeCompare(b.created_at)) })),
  };
}

// For the step list: each step's sign-offs and notes not yet cleared.
export function stepSigns(r: ReviewData): Partial<Record<StepKey, StepSign>> {
  return Object.fromEntries(Object.entries(r.status).map(([k, v]) => [k, { prepared: !!v?.prepared_at, reviewed: !!v?.reviewed_at, notes: v?.notes ?? 0 }]));
}
