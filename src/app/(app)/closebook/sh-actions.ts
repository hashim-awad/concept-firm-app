"use server";
// Step 5, round 14: the shareholder loan schedule. The schedule is worked out here from the live postings
// and saved with the books' fingerprint; every rule is checked again in the database.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { loadShLoans, toSavedGroup, toSavedRow } from "@/lib/closebook/sh-server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// The notice goes in the query, the anchor after it, so the page opens on the schedule with the notice.
const back = (id: string, kind: "msg" | "error" = "error", text = "") => `${withMessage(`/closebook/${id}?step=entries`, kind, text)}#sh-loans`;
const done = (id: string, error: { message: string } | null, ok: string): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(back(id, error ? "error" : "msg", error ? error.message : ok));
};
async function editor(id: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(back(id, "error", "You need Edit on Closebook."));
}

export async function prepareShSchedule(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const supabase = await createClient();
  const f = await loadFile(supabase, id);
  if (!f) redirect("/closebook");
  const ref = await loadReference(supabase);
  const sh = await loadShLoans(supabase, f.file, f.accounts, f.entries, ref.lines, ref.sheets);
  const { error } = await supabase.rpc("cb_prepare_sh_schedule", { p_file: id, p_rows: sh.rows.map((r) => toSavedRow(r, sh.owners[r.key])), p_groups: sh.groups.map(toSavedGroup) });
  const off = sh.rows.filter((r) => !r.tied).length;
  done(id, error, off ? `Schedule prepared. ${off} account${off === 1 ? " does" : "s do"} not tie to the trial balance.` : "Schedule prepared. Every account ties to the trial balance.");
}

export async function answerShFlag(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_answer_sh_flag", { p_file: id, p_account: s(formData, "account"), p_flag: s(formData, "flag"), p_note: s(formData, "note") });
  done(id, error, "Answer saved. The flag goes to the reviewer.");
}

export async function acceptShFlag(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_accept_sh_flag", { p_file: id, p_account: s(formData, "account"), p_flag: s(formData, "flag"), p_why: s(formData, "why") });
  done(id, error, "Flag accepted.");
}

// The shareholder of an account that is not one of the standard chart's.
export async function setShOwner(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_set_sh_owner", { p_file: id, p_account: s(formData, "account"), p_shareholder: Number(s(formData, "shareholder")) });
  done(id, error, "Shareholder saved. Prepare the schedule again.");
}

// "Repaid by": the preparer confirms the figures worked out from this year's postings.
export async function confirmShRepaid(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_confirm_sh_repaid", { p_file: id, p_group: s(formData, "group") });
  done(id, error, "Confirmed.");
}
