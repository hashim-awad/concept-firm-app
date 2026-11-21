"use server";
// Step 8, T2 tie-out (round 10, Hashim, Nov 27, 2026). The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// CB2-0 step 3: every save stays on the paper it was made on (step 8's papers: tie, taxwp).
const back = (id: string, paper = "tie") => `/closebook/${id}?step=t2&paper=${paper}`;
const done = (id: string, error: { message: string } | null, ok: string, paper = "tie"): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back(id, paper), error ? "error" : "msg", error ? error.message : ok));
};
type Result = { ok: boolean; message: string } | null;

// The figures typed from ProFile, and the T2 PDF. CB2-0 step 3: whatever is filled in is saved, nothing is required;
// the save stays on the paper and keeps what was typed (it returns a message, it does not redirect).
export async function saveT2Tieout(_prev: Result, formData: FormData): Promise<Result> {
  const id = s(formData, "file_id");
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { ok: false, message: "You need Edit on Closebook." };
  const v: Record<string, number | null> = {};
  for (const [k, label] of [["ni", "Net income"], ["assets", "Total assets"], ["cca", "Total CCA"], ["tax", "Total income tax"]] as const) {
    if (!s(formData, k)) { v[k] = null; continue; }
    const c = parseAmount(s(formData, k));
    if (c === null) return { ok: false, message: `${label}: type the amount from ProFile, for example 12,345.67. Nothing was saved.` };
    v[k] = c / 100;
  }
  let path = "";
  const pdf = formData.get("t2_pdf");
  if (pdf instanceof File && pdf.size > 0) {
    if (pdf.size > 20 * 1024 * 1024) return { ok: false, message: "The T2 PDF is over 20 MB. Nothing was saved." };
    path = `closebook/${id}/t2/${Date.now()}-${pdf.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await pdf.arrayBuffer()), { contentType: pdf.type || "application/pdf", upsert: false });
    if (up.error) return { ok: false, message: `The T2 PDF was not saved: ${up.error.message}. Nothing was saved.` };
  }
  const { error } = await (await createClient()).rpc("cb_save_t2_tieout", { p_file: id, p_ni: v.ni, p_assets: v.assets, p_cca: v.cca, p_tax: v.tax, p_pdf: path });
  revalidatePath(`/closebook/${id}`);
  return error ? { ok: false, message: error.message } : { ok: true, message: "ProFile figures saved." };
}

export async function acceptT2Difference(_prev: Result, formData: FormData): Promise<Result> {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_accept_t2_difference", { p_file: id, p_item: s(formData, "item"), p_reason: s(formData, "reason") });
  revalidatePath(`/closebook/${id}`);
  return error ? { ok: false, message: error.message } : { ok: true, message: "Difference accepted." };
}

export async function setReviewTreatment(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_set_review_treatment", { p_file: id, p_line: s(formData, "line"), p_treatment: s(formData, "treatment") });
  done(id, error, "Treatment saved for this client.", "taxwp");
}

export async function setBookAmortization(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_set_book_amortization", { p_file: id, p_on: s(formData, "on") === "1" });
  done(id, error, "Saved for this client.", "taxwp");
}
