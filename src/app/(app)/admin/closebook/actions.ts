"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

const LINES = "/admin/closebook/gifi-lines";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

async function owner(back: string) {
  const a = await getAccess();
  if (!a?.is_owner) redirect(withMessage(back, "error", "Only an owner can change Closebook setup."));
}

// A master line's name, statement line, default tax code, lead sheet and note, with a reason.
export async function updateMasterLine(formData: FormData) {
  const line = s(formData, "line");
  const back = `${LINES}/${line}`;
  await owner(back);
  const { error } = await (await createClient()).rpc("cb_update_master_line", {
    p_line: line, p_name: s(formData, "name"), p_statement_line: orNull(s(formData, "statement_line")), p_tax_code: orNull(s(formData, "tax_code")),
    p_lead_sheet: orNull(s(formData, "lead_sheet")), p_note: s(formData, "note"), p_reason: s(formData, "reason"),
  });
  revalidatePath(LINES); revalidatePath(back);
  const msg = error?.message === "Nothing changed." ? "No field was changed. To add a sub-line, use the box on the right." : error?.message;
  redirect(withMessage(back, error ? "error" : "msg", msg ?? "Line saved. The change is logged with your reason."));
}

// A sub-line under a line staff can map to.
export async function addSubLine(formData: FormData) {
  const parent = s(formData, "parent");
  const back = `${LINES}/${parent}`;
  await owner(back);
  const { data, error } = await (await createClient()).rpc("cb_add_sub_line", {
    p_parent: parent, p_name: s(formData, "name"), p_statement_line: orNull(s(formData, "statement_line")), p_tax_code: orNull(s(formData, "tax_code")),
    p_note: s(formData, "note"), p_reason: s(formData, "reason"),
  });
  revalidatePath(LINES);
  if (error) redirect(withMessage(back, "error", error.message));
  redirect(withMessage(`${LINES}/${data}`, "msg", `Line ${data} added.`));
}

// Thresholds and the Note 1 policy.
export async function updateCbSettings(formData: FormData) {
  const back = String(formData.get("back") ?? "/admin/closebook/thresholds");
  await owner(back);
  const n = (k: string) => Number(s(formData, k).replace(/[$,%\s]/g, ""));
  const vals = ["recon", "flag_amount", "flag_percent", "entry_review", "capital_invoice"].map(n);
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) redirect(withMessage(back, "error", "Enter each amount as a number, 0 or more."));
  const { error } = await (await createClient()).rpc("cb_update_settings", {
    p_recon: vals[0], p_flag_amount: vals[1], p_flag_percent: vals[2], p_entry_review: vals[3], p_capital_invoice: vals[4], p_note1: s(formData, "note1") || "amortization_equals_cca",
  });
  revalidatePath(back);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Saved."));
}
