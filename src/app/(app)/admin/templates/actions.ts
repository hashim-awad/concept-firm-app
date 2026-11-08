"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import { checkEdit, fromFriendly, PIECE } from "@/lib/studio/wording-pieces";
import { loadWordingState, nextLabel } from "@/lib/studio/wording-state";

const LIST = "/admin/templates";

// Save one piece of wording as an unpublished change (a draft is started automatically).
export async function saveWording(key: string, friendly: string): Promise<{ ok: boolean; error?: string }> {
  const text = fromFriendly(key, friendly);
  const problem = checkEdit(key, text);
  if (problem) return { ok: false, error: problem };
  const supabase = await createClient();
  let { draft } = await loadWordingState(supabase);
  if (!draft) {
    const { data: v } = await supabase.from("wording_versions").select("label");
    const { data: id, error } = await supabase.rpc("start_wording_draft", { p_label: nextLabel((v ?? []).map((x) => x.label)) });
    if (error || !id) return { ok: false, error: error?.message.includes("permission") ? "You need Edit on Engagement terms to change wording." : (error?.message ?? "Could not start the changes.") };
    draft = { id: id as string, label: "", texts: {} };
  }
  const original = PIECE.get(key)!.text;
  const { error } = text === original
    ? await supabase.from("wording_texts").delete().eq("version_id", draft.id).eq("key", key)
    : await supabase.from("wording_texts").upsert({ version_id: draft.id, key, text }, { onConflict: "version_id,key" });
  if (error) return { ok: false, error: "Could not save. You need Edit on Engagement terms." };
  revalidatePath(LIST, "layout");
  return { ok: true };
}

// Put one piece back to the published wording.
export async function undoWording(key: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { live, draft } = await loadWordingState(supabase);
  if (!draft) return { ok: true };
  const pub = live?.texts[key];
  const { error } = pub == null
    ? await supabase.from("wording_texts").delete().eq("version_id", draft.id).eq("key", key)
    : await supabase.from("wording_texts").upsert({ version_id: draft.id, key, text: pub }, { onConflict: "version_id,key" });
  revalidatePath(LIST, "layout");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function publishChanges(formData: FormData) {
  const back = `${LIST}/publish`;
  if (formData.get("read") !== "on") redirect(withMessage(back, "error", "Tick the box to confirm you read the changes."));
  const supabase = await createClient();
  const { draft } = await loadWordingState(supabase);
  if (!draft) redirect(withMessage(LIST, "msg", "Nothing to publish."));
  const { error } = await supabase.rpc("approve_wording", { p_id: draft!.id });
  revalidatePath(LIST, "layout");
  redirect(withMessage(error ? back : LIST, error ? "error" : "msg", error ? error.message : "Published. New letters and proposals use the new wording from now on. Letters already made keep theirs."));
}

export async function discardChanges() {
  const supabase = await createClient();
  const { draft } = await loadWordingState(supabase);
  if (draft) await supabase.from("wording_versions").delete().eq("id", draft.id).eq("status", "draft");
  revalidatePath(LIST, "layout");
  redirect(withMessage(LIST, "msg", "Unpublished changes discarded."));
}

export async function restoreVersion(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("make_wording_current", { p_id: String(formData.get("id") ?? ""), p_reason: String(formData.get("reason") ?? "") });
  revalidatePath(LIST, "layout");
  redirect(withMessage(`${LIST}/history`, error ? "error" : "msg", error ? error.message : "Restored. New letters use that wording from now on."));
}

// Owner marks a trial template ready for client use.
export async function approveTemplate(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const e = createStudioEngine({});
  const t = (e.TEMPLATES as { k: string; name: string; basis: string; status: string }[]).find((x) => x.k === key);
  const back = `${LIST}/${key}`;
  if (!t || t.status !== "Trial") redirect(withMessage(back, "error", "Only a trial template needs this."));
  if (formData.get("read") !== "on") redirect(withMessage(back, "error", "Tick the box to confirm you read it."));
  const supabase = await createClient();
  const { live } = await loadWordingState(supabase);
  const { error } = await supabase.from("template_approvals").insert({ template_key: t!.k, template_name: t!.name, el_version: live?.label ?? e.EL_VERSION, basis: t!.basis ?? "" });
  revalidatePath(LIST, "layout");
  redirect(withMessage(back, error ? "error" : "msg", error ? (error.message.includes("row-level") ? "Only an owner can do this." : error.message) : "Marked ready for client use."));
}
