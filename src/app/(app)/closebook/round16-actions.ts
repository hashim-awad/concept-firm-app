"use server";
// Round 16: the acceptance and continuance record (step 1), first-year files (step 2) and the people on a
// file. The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { rebuildTb } from "@/lib/closebook/tb-build-server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const sameFile = (id: string, v: string) => (v.startsWith(`/closebook/${id}?`) ? v : `/closebook/${id}`);
async function done(id: string, back: string, error: { message: string } | null, ok: string): Promise<never> {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : ok));
}
async function editor(back: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
  return a!;
}

export async function saveAcceptance(formData: FormData) {
  const id = s(formData, "file_id");
  const back = sameFile(id, s(formData, "back"));
  await editor(back);
  let p: unknown;
  try { p = JSON.parse(s(formData, "answers")); } catch { redirect(withMessage(back, "error", "The answers could not be read. Nothing was saved.")); }
  const { error } = await (await createClient()).rpc("cb_save_acceptance", { p_file: id, p });
  await done(id, back, error, "Saved");
}

export async function acceptanceSameAsLast(formData: FormData) {
  const id = s(formData, "file_id");
  const back = sameFile(id, s(formData, "back"));
  await editor(back);
  const { error } = await (await createClient()).rpc("cb_acceptance_same_as_last", { p_file: id });
  await done(id, back, error, "Every answer confirmed as last year's.");
}

// Round 18: confirm the client's basis and users of the statements for this year.
export async function acceptanceConfirmClient(formData: FormData) {
  const id = s(formData, "file_id");
  const back = sameFile(id, s(formData, "back"));
  await editor(back);
  const { error } = await (await createClient()).rpc("cb_acceptance_confirm_client", { p_file: id });
  await done(id, back, error, "The client's basis and users confirmed for this year.");
}

export async function setFirstYear(formData: FormData) {
  const id = s(formData, "file_id");
  const back = sameFile(id, s(formData, "back"));
  await editor(back);
  const on = s(formData, "on") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_set_first_year", { p_file: id, p_on: on });
  // The trial balance rebuilds at once, so "Opening balances to enter" follows the choice.
  if (!error) await rebuildTb(supabase, id);
  await done(id, back, error, on ? "First year: no opening balances. The reviewer confirms it by signing step 2." : "First year taken back.");
}

export async function setPeople(formData: FormData) {
  const id = s(formData, "file_id");
  const back = sameFile(id, s(formData, "back"));
  const a = await getAccess();
  if (!a?.is_owner) redirect(withMessage(back, "error", "Only an owner changes the preparer and reviewer."));
  const { error } = await (await createClient()).rpc("cb_set_people", { p_file: id, p_preparer: s(formData, "preparer"), p_reviewer: s(formData, "reviewer") });
  // A refusal also stays as a red line by Save, with the picker open (round 15 rule 9).
  if (error) { revalidatePath(`/closebook/${id}`); redirect(withMessage(`${back}${back.includes("?") ? "&" : "?"}people_error=${encodeURIComponent(error.message)}`, "error", error.message)); }
  await done(id, back, null, "People saved.");
}
