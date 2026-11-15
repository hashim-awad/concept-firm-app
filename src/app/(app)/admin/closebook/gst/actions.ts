"use server";
// Sales tax rates, Quick method rates (round 20, Hashim, Nov 15, 2026). Owners approve CRA's figures,
// pre-filled as drafts; Edit makes a new draft; Add a province adds a row. The database checks every rule
// again (cb_add_quick_rates, cb_set_quick_rate_status, cb_approve_quick_rates, cb_add_quick_province,
// cb_set_quick_credit, cb_decide_quick_credit).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

const PAGE = "/admin/sales-tax?tab=quick";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const done = (error: { message: string } | null, msg: string, back = PAGE) => {
  revalidatePath("/admin/sales-tax");
  redirect(withMessage(error ? back : PAGE, error ? "error" : "msg", error ? error.message : msg));
};
async function owner() {
  const a = await getAccess();
  if (!a?.is_owner) redirect(withMessage(PAGE, "error", "Only an owner changes the quick method rates."));
}
// "8.8" or "8.8%" to 0.088; blank to null; anything else to NaN.
const pct = (v: string) => { const t = v.replace(/[%\s]/g, ""); return t === "" ? null : Number(t) / 100; };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Edit a province: new rates as a draft, waiting for approval. The approved rates apply until then.
export async function addQuickRate(formData: FormData) {
  await owner();
  const province = s(formData, "province");
  const back = `${PAGE}&edit=${encodeURIComponent(province)}`;
  if (formData.get("confirm") !== "on") redirect(withMessage(back, "error", "Tick the box to confirm you checked the rates on the CRA page."));
  const services = pct(s(formData, "services")), goods = pct(s(formData, "goods"));
  if ([services, goods].some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))) redirect(withMessage(back, "error", "Enter each rate as a percent, for example 8.8."));
  const { error } = await (await createClient()).rpc("cb_add_quick_rates", {
    p_rows: [{ province, services: services ?? "", goods: goods ?? "" }],
    p_from: s(formData, "effective_from") || null, p_source: s(formData, "source_url"), p_checked_on: s(formData, "checked_on") || null, p_notes: s(formData, "notes"),
  });
  done(error, "Saved as a draft. Approve it to use it.", back);
}

// Add a province to the page (no rates yet: they show "Not set").
export async function addQuickProvince(formData: FormData) {
  await owner();
  const province = s(formData, "province");
  const { error } = await (await createClient()).rpc("cb_add_quick_province", { p_province: province });
  if (error) done(error, "");
  revalidatePath("/admin/sales-tax");
  redirect(withMessage(`${PAGE}&edit=${encodeURIComponent(province)}`, "msg", "Province added. Enter its rates from the CRA guide."));
}

// Approve or reject (retire) one row.
export async function setQuickRateStatus(formData: FormData) {
  await owner();
  const status = s(formData, "status");
  const { error } = await (await createClient()).rpc("cb_set_quick_rate_status", { p_id: s(formData, "id"), p_status: status });
  done(error, status === "approved" ? "Approved. GST/HST returns now use these rates." : "Removed.");
}

// Approve every draft (rates and credit) in one step.
export async function approveAllQuickRates() {
  await owner();
  const { data, error } = await (await createClient()).rpc("cb_approve_quick_rates");
  const n = Number(data ?? 0);
  done(error, n ? `Approved ${plural(n, "draft", "drafts")}. GST/HST returns now use them.` : "Nothing was waiting for approval.");
}

// Edit the credit: a draft, waiting for approval.
export async function setQuickCredit(formData: FormData) {
  await owner();
  const back = `${PAGE}&edit=credit`;
  if (formData.get("confirm") !== "on") redirect(withMessage(back, "error", "Tick the box to confirm you checked the credit on the CRA page."));
  const rate = pct(s(formData, "rate"));
  const limit = Number(s(formData, "limit").replace(/[$,\s]/g, ""));
  if (rate === null || !Number.isFinite(rate) || !Number.isFinite(limit) || s(formData, "limit") === "") redirect(withMessage(back, "error", "Enter the credit as a percent and the limit as an amount, for example 1 and 30,000."));
  const { error } = await (await createClient()).rpc("cb_set_quick_credit", { p_rate: rate, p_limit: limit, p_source: s(formData, "source_url"), p_checked_on: s(formData, "checked_on") || null });
  done(error, "Saved as a draft. Approve it to use it.", back);
}

// Approve or reject the draft credit.
export async function decideQuickCredit(formData: FormData) {
  await owner();
  const approve = s(formData, "decision") === "approve";
  const { error } = await (await createClient()).rpc("cb_decide_quick_credit", { p_approve: approve });
  done(error, approve ? "Credit approved. GST/HST returns now use it." : "Draft credit removed.");
}
