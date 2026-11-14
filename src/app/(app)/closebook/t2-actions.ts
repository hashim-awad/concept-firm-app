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
const back = (id: string) => `/closebook/${id}?step=t2`;
const done = (id: string, error: { message: string } | null, ok: string): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back(id), error ? "error" : "msg", error ? error.message : ok));
};

// The figures typed from ProFile, and the T2 PDF.
export async function saveT2Tieout(formData: FormData) {
  const id = s(formData, "file_id");
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back(id), "error", "You need Edit on Closebook."));
  const v: Record<string, number> = {};
  for (const [k, label] of [["ni", "Net income"], ["assets", "Total assets"], ["cca", "Total CCA"], ["tax", "Total income tax"]] as const) {
    const c = parseAmount(s(formData, k));
    if (c === null) redirect(withMessage(back(id), "error", `${label}: type the amount from ProFile, for example 12,345.67. Nothing was saved.`));
    v[k] = c! / 100;
  }
  let path = "";
  const pdf = formData.get("t2_pdf");
  if (pdf instanceof File && pdf.size > 0) {
    if (pdf.size > 20 * 1024 * 1024) redirect(withMessage(back(id), "error", "The T2 PDF is over 20 MB. Nothing was saved."));
    path = `closebook/${id}/t2/${Date.now()}-${pdf.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await pdf.arrayBuffer()), { contentType: pdf.type || "application/pdf", upsert: false });
    if (up.error) redirect(withMessage(back(id), "error", `The T2 PDF was not saved: ${up.error.message}. Nothing was saved.`));
  }
  const { error } = await (await createClient()).rpc("cb_save_t2_tieout", { p_file: id, p_ni: v.ni, p_assets: v.assets, p_cca: v.cca, p_tax: v.tax, p_pdf: path });
  done(id, error, "ProFile figures saved.");
}

export async function acceptT2Difference(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_accept_t2_difference", { p_file: id, p_item: s(formData, "item"), p_reason: s(formData, "reason") });
  done(id, error, "Difference accepted.");
}

export async function setReviewTreatment(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_set_review_treatment", { p_file: id, p_line: s(formData, "line"), p_treatment: s(formData, "treatment") });
  done(id, error, "Treatment saved for this client.");
}

export async function setBookAmortization(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_set_book_amortization", { p_file: id, p_on: s(formData, "on") === "1" });
  done(id, error, "Saved for this client.");
}
