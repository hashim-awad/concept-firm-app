"use server";
// Round 21 (Hashim, Nov 15, 2026): "Clear this step" (QuickBooks Online's Clear). The database decides
// what is typed on each step and refuses a signed step, a locked file and anyone without Edit.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { STEP_KEYS, type StepKey } from "@/lib/closebook/steps";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const sameFile = (id: string, v: string) => (v.startsWith(`/closebook/${id}?`) ? v : `/closebook/${id}`);

export async function clearStep(formData: FormData) {
  const id = s(formData, "file_id"), step = s(formData, "step") as StepKey;
  const back = sameFile(id, s(formData, "back"));
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_clear_typed_step", { p_file: id, p_step: step });
  // Answers, opening balances, coding and matches feed the trial balance: build it again.
  if (!error) await rebuildTb(supabase, id);
  revalidatePath(`/closebook/${id}`);
  const n = STEP_KEYS.indexOf(step) + 1;
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : `Step ${n} cleared.`));
}
