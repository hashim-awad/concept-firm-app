"use server";
// Step 5, round 14: the shareholder loan schedule. The schedule is worked out here from the live postings
// and saved with the books' fingerprint; every rule is checked again in the database.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { loadShLoans, toSaved } from "@/lib/closebook/sh-server";

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
  const { error } = await supabase.rpc("cb_prepare_sh_schedule", { p_file: id, p_rows: sh.rows.map(toSaved) });
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

// "Repaid by [date]?" The evidence is "bank:<line id>" or "entry:<entry id>".
export async function answerShRepaid(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const answer = s(formData, "answer");
  const [kind, ref] = s(formData, "evidence").split(":");
  const { error } = await (await createClient()).rpc("cb_answer_sh_repaid", {
    p_file: id, p_account: s(formData, "account"), p_answer: answer, p_kind: answer === "yes" ? kind || null : null, p_ref: answer === "yes" ? ref || null : null, p_note: s(formData, "note"),
  });
  done(id, error, answer === "yes" ? "Saved: repaid, with the evidence." : "Saved: not repaid. It goes to the reviewer.");
}

export async function acceptShRepaid(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_accept_sh_repaid", { p_file: id, p_account: s(formData, "account"), p_why: s(formData, "why") });
  done(id, error, "Accepted.");
}
