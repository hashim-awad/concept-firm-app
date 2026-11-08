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
