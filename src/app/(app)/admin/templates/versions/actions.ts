"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { checkEdit, PIECE } from "@/lib/studio/wording-pieces";

const LIST = "/admin/templates/versions";
const nextLabel = (labels: string[]) => {
  const [ma, mi] = labels.map((l) => l.match(/^EL v(\d+)\.(\d+)$/)).filter(Boolean).map((m) => [Number(m![1]), Number(m![2])])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])[0] ?? [3, 31];
  return `EL v${ma}.${mi + 1}`;
};

export async function startDraft() {
  const supabase = await createClient();
  const { data: v } = await supabase.from("wording_versions").select("label");
  const { data: id, error } = await supabase.rpc("start_wording_draft", { p_label: nextLabel((v ?? []).map((x) => x.label)) });
  if (error) redirect(withMessage(LIST, "error", error.message));
  revalidatePath(LIST);
  redirect(`${LIST}/${id}`);
}

// Save one piece in the draft. Wording equal to the original is stored as "no change".
export async function savePiece(versionId: string, key: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const problem = checkEdit(key, text);
  if (problem) return { ok: false, error: problem };
  const supabase = await createClient();
  const original = PIECE.get(key)!.text;
  const q = text === original
    ? supabase.from("wording_texts").delete().eq("version_id", versionId).eq("key", key)
    : supabase.from("wording_texts").upsert({ version_id: versionId, key, text }, { onConflict: "version_id,key" });
  const { error } = await q;
  if (error) return { ok: false, error: error.message.includes("approved") ? error.message : "Could not save. You need Edit on Engagement terms, and the version must be a draft." };
  revalidatePath(`${LIST}/${versionId}`);
  return { ok: true };
}

// Undo a change in the draft: back to the wording of the current approved version.
export async function undoPiece(versionId: string, key: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: cw } = await supabase.rpc("current_wording");
  const cur = (cw as { texts?: Record<string, string> } | null)?.texts?.[key];
  return savePiece(versionId, key, cur ?? PIECE.get(key)?.text ?? "");
}

export async function approveDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = `${LIST}/${id}`;
  if (formData.get("read") !== "on") redirect(withMessage(back, "error", "Tick the box to confirm you read the changes."));
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_wording", { p_id: id });
  revalidatePath(LIST);
  redirect(withMessage(error ? back : LIST, error ? "error" : "msg", error ? error.message : "Approved. New letters use this wording from now on. Letters already made keep theirs."));
}

export async function deleteDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("wording_versions").delete().eq("id", id).eq("status", "draft");
  revalidatePath(LIST);
  redirect(withMessage(LIST, error ? "error" : "msg", error ? error.message : "Draft deleted."));
}

export async function makeCurrent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("make_wording_current", { p_id: id, p_reason: String(formData.get("reason") ?? "") });
  revalidatePath(LIST);
  redirect(withMessage(LIST, error ? "error" : "msg", error ? error.message : "Done. New letters use that version from now on."));
}
