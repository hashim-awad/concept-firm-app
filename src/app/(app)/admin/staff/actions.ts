"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccess, canEdit } from "@/lib/access";
import { env } from "@/lib/env";
import { withMessage } from "@/lib/messages";

const PAGE = "/admin/team?tab=people";

export async function inviteStaff(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleId = String(formData.get("role_id") ?? "");

  // Check permission before creating any login. The database checks again in add_staff.
  const access = await getAccess();
  if (!access || !canEdit(access, "staff_accounts")) {
    redirect(withMessage(PAGE, "error", "You do not have permission to add staff."));
  }
  if (!fullName || !email || !roleId) {
    redirect(withMessage(PAGE, "error", "Enter a name, an email and a role."));
  }

  const admin = createAdminClient();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${env.siteUrl()}/auth/confirm?next=/set-password`,
    data: { full_name: fullName },
  });
  if (inviteError || !invited?.user) {
    const text = inviteError?.message?.toLowerCase().includes("already")
      ? "That email already has a login."
      : "Could not send the invite. Check the email address and try again.";
    redirect(withMessage(PAGE, "error", text));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_staff", {
    p_user_id: invited.user.id,
    p_full_name: fullName,
    p_email: email,
    p_role_id: roleId,
  });
  if (error) {
    // Undo the login so nothing is left half set up.
    await admin.auth.admin.deleteUser(invited.user.id);
    redirect(withMessage(PAGE, "error", error.message));
  }
  revalidatePath("/admin/team");
  redirect(withMessage(PAGE, "msg", `Invite sent to ${email}.`));
}

export async function changeRole(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_role", {
    p_staff_id: String(formData.get("staff_id")),
    p_role_id: String(formData.get("role_id")),
  });
  revalidatePath("/admin/team");
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Role changed."));
}

export async function setActive(formData: FormData) {
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_active", {
    p_staff_id: String(formData.get("staff_id")),
    p_active: active,
  });
  revalidatePath("/admin/team");
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : active ? "Account switched on." : "Account switched off."));
}
