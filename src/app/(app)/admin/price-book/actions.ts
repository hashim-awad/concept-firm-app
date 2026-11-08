"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseDollars } from "@/lib/screening/load";
import { withMessage } from "@/lib/messages";

export async function addItem(formData: FormData) {
  const page = "/admin/price-book";
  const cents = parseDollars(String(formData.get("price") ?? ""));
  const start = String(formData.get("effective_from") ?? "");
  if (cents === null) redirect(withMessage(page, "error", "Enter the price as dollars, for example 299 or 299.00."));
  if (!start) redirect(withMessage(page, "error", "Choose the date the price starts."));
  const supabase = await createClient();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const { data, error } = await supabase
    .from("catalogue_items")
    .insert({
      service_line_id: String(formData.get("service_line_id")),
      code,
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      unit_label: String(formData.get("unit_label") ?? "each").trim() || "each",
      per_spouse: formData.get("per_spouse") === "on",
      sort_order: Number(formData.get("sort_order") ?? 0) || 0,
    })
    .select("id")
    .single();
  if (error || !data) redirect(withMessage(page, "error", friendly(error?.message ?? "Could not add the item.")));
  const { error: priceError } = await supabase
    .from("item_prices")
    .insert({ item_id: data.id, amount_cents: cents, effective_from: start, note: "First price" });
  if (priceError) redirect(withMessage(`/admin/price-book/${data.id}`, "error", priceError.message));
  revalidatePath(page);
  redirect(withMessage(`/admin/price-book/${data.id}`, "msg", "Item added."));
}

export async function updateItem(formData: FormData) {
  const id = String(formData.get("id"));
  const page = `/admin/price-book/${id}`;
  const supabase = await createClient();
  const { error } = await supabase
    .from("catalogue_items")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      unit_label: String(formData.get("unit_label") ?? "each").trim() || "each",
      per_spouse: formData.get("per_spouse") === "on",
      sort_order: Number(formData.get("sort_order") ?? 0) || 0,
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/price-book");
  redirect(withMessage(page, error ? "error" : "msg", error ? friendly(error.message) : "Item saved."));
}

export async function addPrice(formData: FormData) {
  const id = String(formData.get("id"));
  const page = `/admin/price-book/${id}`;
  const cents = parseDollars(String(formData.get("price") ?? ""));
  const start = String(formData.get("effective_from") ?? "");
  if (cents === null) redirect(withMessage(page, "error", "Enter the price as dollars, for example 299 or 299.00."));
  if (!start) redirect(withMessage(page, "error", "Choose the date the price starts."));
  const supabase = await createClient();
  const { error } = await supabase.from("item_prices").insert({
    item_id: id,
    amount_cents: cents,
    effective_from: start,
    note: String(formData.get("note") ?? "").trim(),
  });
  revalidatePath("/admin/price-book");
  redirect(withMessage(page, error ? "error" : "msg", error ? friendly(error.message) : "New price saved."));
}

function friendly(message: string) {
  if (message.includes("catalogue_items_code_key")) return "That code is already used by another item.";
  if (message.includes("catalogue_items_code_check")) return "Code: 2 to 40 capital letters, numbers or underscores, for example T2_HOLDCO.";
  if (message.includes("item_prices_item_id_effective_from_key")) return "This item already has a price starting that day. Choose another date.";
  if (message.includes("row-level security")) return "You do not have permission to change the price book.";
  return message;
}
