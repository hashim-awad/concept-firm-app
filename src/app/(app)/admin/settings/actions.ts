"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

const PAGE = "/admin/settings";

export async function saveLeadAssignment(formData: FormData) {
  const mode = String(formData.get("mode") ?? "unassigned");
  const staffIds =
    mode === "single" ? [String(formData.get("single_staff_id") ?? "")].filter(Boolean)
    : mode === "rotate" ? formData.getAll("rotate_staff_ids").map(String)
    : [];
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", {
    p_key: "lead_assignment",
    p_value: { mode, staff_ids: staffIds },
  });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Lead assignment saved."));
}

export async function saveRetention(formData: FormData) {
  const months = Number(formData.get("months"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", { p_key: "retention_months", p_value: months });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Retention period saved."));
}
