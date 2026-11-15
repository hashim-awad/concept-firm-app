"use server";
// Sales tax rates, Quick method rates (round 20, Hashim, Nov 15, 2026): owners load CRA's rates or add
// them from CRA's page as pending, then approve them. The database checks every rule again
// (cb_add_quick_rates, cb_set_quick_rate_status, cb_approve_quick_rates).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { CRA_QUICK_PAGE, CRA_QUICK_TABLE } from "@/lib/tax/cra-quick-rates";

const PAGE = "/admin/sales-tax?tab=quick";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const done = (error: { message: string } | null, msg: string) => {
  revalidatePath("/admin/sales-tax");
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : msg));
};
async function owner() {
  const a = await getAccess();
  if (!a?.is_owner) redirect(withMessage(PAGE, "error", "Only an owner changes the quick method rates."));
}
// "8.8" or "8.8%" to 0.088; blank to null; anything else to NaN.
const pct = (v: string) => { const t = v.replace(/[%\s]/g, ""); return t === "" ? null : Number(t) / 100; };

// Load the CRA table in the app as pending. Rows already loaded are skipped.
export async function loadCraQuickRates(formData: FormData) {
  await owner();
  if (formData.get("confirm") !== "on") redirect(withMessage(PAGE, "error", "Tick the box to confirm you checked the table against the CRA page."));
  if (!CRA_QUICK_TABLE.rates.length) redirect(withMessage(PAGE, "error", "The CRA table is not in the app yet. Add the rates from the CRA page below."));
  const { data, error } = await (await createClient()).rpc("cb_add_quick_rates", {
    p_rows: CRA_QUICK_TABLE.rates.map((r) => ({ province: r.province, services: r.services / 100, goods: r.goods / 100 })),
    p_from: CRA_QUICK_TABLE.effectiveFrom, p_source: CRA_QUICK_PAGE, p_checked_on: CRA_QUICK_TABLE.checkedOn, p_notes: "Loaded by the app from the CRA quick method table.",
  });
  const n = Number(data ?? 0);
  done(error, n ? `Loaded ${n} province${n === 1 ? "" : "s"} as pending. Review them, then press Approve all.` : "All the CRA rates are already loaded.");
}

// Add one province's rates, typed from the CRA page, as pending.
export async function addQuickRate(formData: FormData) {
  await owner();
  if (formData.get("confirm") !== "on") redirect(withMessage(PAGE, "error", "Tick the box to confirm you checked the rates on the CRA page."));
  const services = pct(s(formData, "services")), goods = pct(s(formData, "goods"));
  if ([services, goods].some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))) redirect(withMessage(PAGE, "error", "Enter each rate as a percent, for example 8.8."));
  const { error } = await (await createClient()).rpc("cb_add_quick_rates", {
    p_rows: [{ province: s(formData, "province"), services: services ?? "", goods: goods ?? "" }],
    p_from: s(formData, "effective_from") || null, p_source: s(formData, "source_url"), p_checked_on: s(formData, "checked_on") || null, p_notes: s(formData, "notes"),
  });
  done(error, "Rates added as pending. An owner approves them.");
}

// Approve or retire one row.
export async function setQuickRateStatus(formData: FormData) {
  await owner();
  const status = s(formData, "status");
  const { error } = await (await createClient()).rpc("cb_set_quick_rate_status", { p_id: s(formData, "id"), p_status: status });
  done(error, status === "approved" ? "Rates approved. GST/HST returns now use them." : "Rates retired.");
}

// Approve every pending row in one step.
export async function approveAllQuickRates() {
  await owner();
  const { data, error } = await (await createClient()).rpc("cb_approve_quick_rates");
  const n = Number(data ?? 0);
  done(error, `Approved ${n} row${n === 1 ? "" : "s"}. GST/HST returns now use them.`);
}
