"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";

// Dollars, read as every typed amount is (parseAmount: commas, $, a minus sign or brackets); blank is
// none; a negative or unreadable amount is refused.
const num = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); if (!s) return null; const c = parseAmount(s); return c !== null && c >= 0 ? c / 100 : NaN; };

// Price book offer (Studio Price Floors row). Every change is in the activity log.
export async function saveOffer(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = id ? `/admin/price-book/packages/${id}` : "/admin/price-book/packages/new";
  const segment = String(formData.get("segment") ?? "");
  // T1 prices live only in the Catalogue (Personal tax (T1) items).
  if (segment !== "Team or brokerage" && segment !== "Agent") redirect(withMessage(back, "error", "Choose Team or brokerage, or Agent."));
  const nums = { monthly_fee: num(formData.get("monthly_fee")), software_per_month: num(formData.get("software_per_month")), year_end_fee: num(formData.get("year_end_fee")),
    annual_floor: num(formData.get("annual_floor")), monthly_reference: num(formData.get("monthly_reference")) };
  if (Object.values(nums).some((n) => Number.isNaN(n))) redirect(withMessage(back, "error", "Amounts must be numbers, 0 or more, for example 1,250.00."));
  const row = {
    offer: String(formData.get("offer") ?? "").trim(), segment, is_package: formData.get("is_package") === "on",
    services: formData.getAll("services").map(String), ...nums, allows_payment_admin: formData.get("allows_payment_admin") === "on",
    notes: String(formData.get("notes") ?? "").trim(), sort_order: Number(formData.get("sort_order") ?? 0) || 0, is_active: formData.get("is_active") === "on",
  };
  if (!row.offer) redirect(withMessage(back, "error", "Enter the offer name."));
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("offers").update(row).eq("id", id).select("id").single()
    : await supabase.from("offers").insert(row).select("id").single();
  revalidatePath("/admin/price-book/packages");
  if (error || !data) redirect(withMessage(back, "error", error?.message ?? "Could not save."));
  redirect(withMessage(`/admin/price-book/packages/${data!.id}`, "msg", "Saved. The change is in the activity log."));
}
