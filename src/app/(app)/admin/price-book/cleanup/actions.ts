"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { withMessage } from "@/lib/messages";
import { planCleanup } from "@/lib/price-book/cleanup";
import { loadItems } from "@/lib/price-book/load";

const PAGE = "/admin/price-book/cleanup";

// Applies the plan worked out again now; it must be the same plan the owner saw.
export async function applyCleanup(formData: FormData) {
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage(PAGE, "error", "Only an owner can apply the clean-up."));
  if (formData.get("read") !== "on") redirect(withMessage(PAGE, "error", "Tick the box to confirm you checked the changes."));
  const supabase = await createClient();
  const { items, lineKeys } = await loadItems(supabase);
  const { plan, blockers } = planCleanup(items, lineKeys);
  if (blockers.length) redirect(withMessage(PAGE, "error", blockers[0]));
  if (JSON.stringify(plan) !== String(formData.get("plan"))) redirect(withMessage(PAGE, "error", "The price book changed since this page opened. Check the list again, then apply."));
  const { error } = await supabase.rpc("apply_catalogue_cleanup", { p_plan: plan });
  revalidatePath("/admin/price-book");
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : `Applied ${plan.length} changes. Each is in the activity log.`));
}
