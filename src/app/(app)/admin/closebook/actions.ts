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

// Lock or unlock a main line that has sub-lines (Hashim, Nov 11, 2026): a locked line shows with a
// lock in the picker and nobody can match to it or post an entry to it.
export async function setLineLocked(formData: FormData) {
  const line = s(formData, "line");
  const back = `${LINES}/${line}`;
  await owner(back);
  const lock = s(formData, "locked") === "true";
  const { error } = await (await createClient()).rpc("cb_set_line_locked", { p_line: line, p_locked: lock, p_reason: s(formData, "reason") });
  revalidatePath(LINES); revalidatePath(back);
  redirect(withMessage(back, error ? "error" : "msg", error?.message ?? (lock ? "Line locked. Staff now pick one of its sub-lines." : "Line unlocked.")));
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
  // Round 10: the T2 tie-out rounding, on the Thresholds page only (the Note 1 page does not send it).
  let err = error;
  if (!err && formData.has("t2_rounding")) {
    const r = n("t2_rounding");
    if (!Number.isFinite(r) || r < 0) redirect(withMessage(back, "error", "Rounding allowed in the T2 tie-out: enter a number, 0 or more."));
    err = (await (await createClient()).rpc("cb_update_t2_rounding", { p_amount: r })).error;
  }
  // Round 12: the instalment threshold Appendix C's client email uses (step 10).
  if (!err && formData.has("instalment_threshold")) {
    const r = n("instalment_threshold");
    if (!Number.isFinite(r) || r < 0) redirect(withMessage(back, "error", "Instalment threshold: enter a number, 0 or more."));
    err = (await (await createClient()).rpc("cb_update_instalment_threshold", { p_amount: r })).error;
  }
  revalidatePath(back);
  redirect(withMessage(back, err ? "error" : "msg", err ? err.message : "Saved."));
}

// Standard entries (Hashim, Nov 15, 2026, layout item 6). Owners only.
const STD = "/admin/closebook/standard-entries";
export async function saveStandardEntry(formData: FormData) {
  await owner(STD);
  const { error } = await (await createClient()).rpc("cb_save_standard_entry", {
    p_id: orNull(s(formData, "id")), p_name: s(formData, "name"), p_kind: s(formData, "kind"), p_reason: s(formData, "reason"),
    p_debit: s(formData, "debit_account"), p_credit: s(formData, "credit_account"), p_memo: s(formData, "memo"), p_wp_ref: s(formData, "wp_ref"), p_reverse: formData.get("reverse") === "on", p_tax_mode: s(formData, "tax_mode") || "line",
  });
  revalidatePath(STD);
  redirect(withMessage(STD, error ? "error" : "msg", error ? error.message : "Saved."));
}
export async function deleteStandardEntry(formData: FormData) {
  await owner(STD);
  const { error } = await (await createClient()).rpc("cb_delete_standard_entry", { p_id: s(formData, "id") });
  revalidatePath(STD);
  redirect(withMessage(STD, error ? "error" : "msg", error ? error.message : "Deleted. Entries already made keep their lines."));
}

// Firm vendor rules (layout item 4). The vendor is stored as the vendor part of a bank description, the
// same way lines are matched, so a match is exact.
const VR = "/admin/closebook/vendor-rules";
export async function saveFirmVendorRule(formData: FormData) {
  await owner(VR);
  const { vendorKey } = await import("@/lib/closebook/vendor");
  const { error } = await (await createClient()).rpc("cb_save_firm_vendor_rule", { p_vendor_key: vendorKey(s(formData, "vendor")), p_account: s(formData, "account"), p_tax_mode: s(formData, "tax_mode") || "line" });
  revalidatePath(VR);
  redirect(withMessage(VR, error ? "error" : "msg", error ? error.message : "Rule saved."));
}
export async function deleteFirmVendorRule(formData: FormData) {
  await owner(VR);
  const { error } = await (await createClient()).rpc("cb_delete_firm_vendor_rule", { p_id: s(formData, "id") });
  revalidatePath(VR);
  redirect(withMessage(VR, error ? "error" : "msg", error ? error.message : "Rule deleted."));
}

// Settings, Closebook, GST/HST (round 13): the due-date rule and the quick method's rates.
export async function updateGstSettings(formData: FormData) {
  const back = "/admin/closebook/gst";
  await owner(back);
  const num = (k: string) => { const v = s(formData, k).replace(/[$,%\s]/g, ""); return v === "" ? null : Number(v); };
  const due = [num("due_annual"), num("due_period")];
  if (due.some((v) => v === null || !Number.isInteger(v))) redirect(withMessage(back, "error", "Due dates: a whole number of months."));
  const cr = num("credit_rate"), lim = num("credit_limit");
  if ((cr !== null && !Number.isFinite(cr)) || (lim !== null && !Number.isFinite(lim))) redirect(withMessage(back, "error", "The quick method credit and limit are numbers."));
  const rates = [...formData.keys()].filter((k) => k.startsWith("rate_")).map((k) => { const v = num(k); return { province: k.slice(5), rate: v === null ? "" : v / 100 }; });
  if (rates.some((r) => r.rate !== "" && !Number.isFinite(r.rate))) redirect(withMessage(back, "error", "A remittance rate is a percentage, for example 8.8."));
  const { error } = await (await createClient()).rpc("cb_update_gst_settings", { p_due_annual: due[0], p_due_period: due[1], p_credit_rate: cr === null ? null : cr / 100, p_credit_limit: lim, p_rates: rates });
  revalidatePath(back);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Saved."));
}
