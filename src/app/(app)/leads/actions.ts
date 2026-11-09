"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { LEAD_STATUS } from "@/lib/leads/provinces";

// Staff update a lead: status, source, notes; owners also reassign. What the client entered stays as sent.
export async function updateLead(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const page = `/leads/${id}`;
  const access = await getAccess();
  if (!access || !canEdit(access, "leads")) redirect(withMessage(page, "error", "You do not have permission to change leads."));
  const status = String(formData.get("status") ?? "");
  const patch: Record<string, unknown> = { notes: String(formData.get("notes") ?? "").trim(), source: String(formData.get("source") ?? "Website") };
  if (LEAD_STATUS[status]) patch.status = status;
  if (access!.is_owner && formData.has("assigned_to")) patch.assigned_to = String(formData.get("assigned_to")) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  revalidatePath("/leads"); revalidatePath(page); revalidatePath("/");
  redirect(withMessage(page, error ? "error" : "msg", error ? error.message : "Lead saved."));
}
