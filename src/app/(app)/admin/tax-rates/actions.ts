"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { withMessage } from "@/lib/messages";

const PAGE = "/admin/tax-rates";

// A new rate starts as pending, with the CRA page, the date checked and who checked it.
export async function addRate(formData: FormData) {
  const access = await getAccess();
  if (!access) redirect("/login");
  const g = (k: string) => String(formData.get(k) ?? "").trim();
  if (formData.get("confirm") !== "on") redirect(withMessage(PAGE, "error", "Tick the box to confirm you checked the rate on the CRA page."));
  const rate = Number(g("rate_percent"));
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 30) redirect(withMessage(PAGE, "error", "Enter the rate as a percent, for example 13."));
  const supabase = await createClient();
  const { error } = await supabase.from("tax_rates").insert({
    province: g("province"), tax: g("tax"), rate_percent: rate, effective_from: g("effective_from"),
    source_url: g("source_url"), checked_on: g("checked_on"), checked_by: access!.staff_id, notes: g("notes"),
  });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? (error.message.includes("source_url") ? "The source must be a canada.ca page." : error.message) : "Rate added as pending. An owner approves it."));
}

// Owner only (the database checks): approve or retire.
export async function setRateStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["approved", "retired"].includes(status)) redirect(withMessage(PAGE, "error", "Unknown action."));
  const supabase = await createClient();
  const { error } = await supabase.from("tax_rates").update({ status }).eq("id", id);
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : status === "approved" ? "Rate approved." : "Rate retired."));
}

// Owner only: load the CRA table as pending rates. The owner who clicks is recorded as the
// checker (they confirm they checked the table against the CRA page). Rows already loaded are skipped.
export async function loadCraRates(formData: FormData) {
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage(PAGE, "error", "Only an owner can load the CRA table."));
  if (formData.get("confirm") !== "on") redirect(withMessage(PAGE, "error", "Tick the box to confirm you checked the table against the CRA page."));
  const { CRA_TABLE, CRA_RATES_PAGE } = await import("@/lib/tax/cra-rates");
  const supabase = await createClient();
  const { data: existing } = await supabase.from("tax_rates").select("province, tax, rate_percent, effective_from, status").neq("status", "retired");
  const have = new Set((existing ?? []).map((r) => `${r.province}|${r.tax}|${Number(r.rate_percent)}|${r.effective_from}`));
  const rows = CRA_TABLE.rates
    .filter((r) => !have.has(`${r.province}|${r.tax}|${r.rate}|${CRA_TABLE.effectiveFrom}`))
    .map((r) => ({ province: r.province, tax: r.tax, rate_percent: r.rate, effective_from: CRA_TABLE.effectiveFrom, source_url: CRA_RATES_PAGE,
      checked_on: CRA_TABLE.checkedOn, checked_by: access!.staff_id, notes: "Loaded by the app from the CRA rates table." }));
  if (!rows.length) redirect(withMessage(PAGE, "msg", "All 13 CRA rates are already loaded."));
  const { error } = await supabase.from("tax_rates").insert(rows);
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : `Loaded ${rows.length} rates as pending. Review them, then press Approve all.`));
}

// Owner only (the database checks too): approve every pending rate in one step.
export async function approveAllRates() {
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage(PAGE, "error", "Only an owner can approve rates."));
  const supabase = await createClient();
  const { data, error } = await supabase.from("tax_rates").update({ status: "approved" }).eq("status", "pending").select("id");
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : `Approved ${data?.length ?? 0} rate${data?.length === 1 ? "" : "s"}. Quotes and proposals now use them.`));
}
