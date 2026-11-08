"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

export async function createRole(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_role", {
    p_name: String(formData.get("name") ?? ""),
    p_description: String(formData.get("description") ?? ""),
  });
  if (error) redirect(withMessage("/admin/roles", "error", friendly(error.message)));
  revalidatePath("/admin/roles");
  redirect(withMessage(`/admin/roles/${data}`, "msg", "Role created. Every area starts at No access. Set the levels below."));
}

export async function saveRole(formData: FormData) {
  const roleId = String(formData.get("role_id"));
  const page = `/admin/roles/${roleId}`;
  const supabase = await createClient();

  const { error: nameError } = await supabase.rpc("update_role", {
    p_role_id: roleId,
    p_name: String(formData.get("name") ?? ""),
    p_description: String(formData.get("description") ?? ""),
  });
  if (nameError) redirect(withMessage(page, "error", friendly(nameError.message)));

  const levels: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("level:")) levels[key.slice(6)] = String(value);
  }
  const { error } = await supabase.rpc("set_role_permissions", { p_role_id: roleId, p_levels: levels });
  if (error) redirect(withMessage(page, "error", friendly(error.message)));

  revalidatePath("/admin/roles");
  redirect(withMessage(page, "msg", "Role saved."));
}

export async function deleteRole(formData: FormData) {
  const roleId = String(formData.get("role_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_role", { p_role_id: roleId });
  if (error) redirect(withMessage(`/admin/roles/${roleId}`, "error", friendly(error.message)));
  revalidatePath("/admin/roles");
  redirect(withMessage("/admin/roles", "msg", "Role deleted."));
}

function friendly(message: string) {
  if (message.includes("roles_name_key")) return "A role with that name already exists.";
  if (message.includes("roles_name_check")) return "Role name must be 1 to 60 characters.";
  return message;
}
