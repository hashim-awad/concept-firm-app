"use server";
// Step 10, "Deliver and lock" (round 12). The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";
import { buildDocumentsZip, loadClose } from "@/lib/closebook/close-server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id: string) => `/closebook/${id}?step=lock`;
const done = (id: string, error: { message: string } | null, ok: string): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back(id), error ? "error" : "msg", error ? error.message : ok));
};
async function editor(id: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back(id), "error", "You need Edit on Closebook."));
}
// An amount typed as on ProFile: "1,234.56"; blank stays blank.
const amt = (f: FormData, k: string, label: string, id: string): number | null => {
  const raw = s(f, k);
  if (!raw) return null;
  const c = parseAmount(raw);
  if (c === null) redirect(withMessage(back(id), "error", `${label}: type an amount, for example 1,234.56. Nothing was saved.`));
  return c! / 100;
};
// Owing (+), refund (-) or nil.
const signed = (f: FormData, kind: string, k: string, label: string, id: string) => {
  const kd = s(f, kind);
  if (kd === "nil") return 0;
  const v = amt(f, k, label, id);
  if (v === null || !kd) return null;
  return kd === "refund" ? -Math.abs(v) : Math.abs(v);
};

export async function saveCloseFields(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const instalments: { date: string; amount: number }[] = [];
  for (let i = 0; formData.has(`inst_date_${i}`); i++) {
    const date = s(formData, `inst_date_${i}`), a = amt(formData, `inst_amount_${i}`, `Instalment ${i + 1}`, id);
    if (!date && a === null) continue;
    if (!date || a === null) redirect(withMessage(back(id), "error", `Instalment ${i + 1} needs a due date and an amount. Nothing was saved.`));
    instalments.push({ date, amount: a! });
  }
  const yn = (k: string) => (s(formData, k) === "yes" ? true : s(formData, k) === "no" ? false : null);
  const p = {
    tax_balance: signed(formData, "tax_kind", "tax_amount", "Corporate tax", id), tax_due: s(formData, "tax_due"), filed_on: s(formData, "filed_on"),
    noa_issued: yn("noa_issued"), noa_penalty: amt(formData, "noa_penalty", "NOA penalty", id) ?? 0, noa_interest: amt(formData, "noa_interest", "NOA interest", id) ?? 0,
    hst_filed: s(formData, "hst_filed") === "yes", hst_balance: signed(formData, "hst_kind", "hst_amount", "GST/HST", id), hst_due: s(formData, "hst_due"), hst_rt: s(formData, "hst_rt") || "RT 0001",
    fed_tax: amt(formData, "fed_tax", "Federal tax", id), prov_tax: amt(formData, "prov_tax", "Provincial tax", id),
    fed_tax_prior: amt(formData, "fed_tax_prior", "Federal tax, year before", id), prov_tax_prior: amt(formData, "prov_tax_prior", "Provincial tax, year before", id), instalments,
  };
  const { error } = await (await createClient()).rpc("cb_save_close_fields", { p_file: id, p });
  done(id, error, "Step 10 fields saved.");
}

// "Uploaded to TaxDome and email sent": the documents are stored as delivered, with the email as sent.
export async function recordDelivery(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  if (s(formData, "confirm") !== "yes") redirect(withMessage(back(id), "error", "Tick the box to confirm the documents are in TaxDome and the email is sent."));
  const supabase = await createClient();
  const d = await loadClose(supabase, id);
  if (!d) redirect(withMessage(back(id), "error", "This file was not found."));
  if (!d!.reviewed || !d!.email) redirect(withMessage(back(id), "error", "The reviewer signs step 10 first: until then the email is a draft."));
  const z = await buildDocumentsZip(supabase, d!);
  if ("error" in z) redirect(withMessage(back(id), "error", (z as { error: string }).error));
  const zz = z as { bytes: Uint8Array; sha256: string };
  const path = `closebook/${id}/delivered/${Date.now()}-${d!.zipName}`;
  const admin = createAdminClient();
  const up = await admin.storage.from("documents").upload(path, zz.bytes, { contentType: "application/zip", upsert: false });
  if (up.error) redirect(withMessage(back(id), "error", `The documents were not stored: ${up.error.message}. Nothing was recorded.`));
  const { error } = await supabase.rpc("cb_record_delivery", { p_file: id, p_path: path, p_sha256: zz.sha256, p_email: d!.email });
  if (error) await admin.storage.from("documents").remove([path]);
  done(id, error, "Recorded: uploaded to TaxDome and email sent. The documents are kept as delivered.");
}

export async function saveFilingRecord(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_save_filing_record", { p_file: id, p_t183: s(formData, "t183") || null, p_efile: s(formData, "efile") });
  done(id, error, "Filing record saved.");
}

export async function lockFile(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_lock_file", { p_file: id });
  done(id, error, "The file is locked. It is read-only, and its documents are kept as delivered.");
}

export async function reopenFile(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_reopen_file", { p_file: id, p_why: s(formData, "why") });
  done(id, error, "The file is reopened. Step 10 is open again; the reopen is in the file history.");
}
