"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { CB_SWITCHES } from "./rights";

export async function createRole(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_role", {
    p_name: String(formData.get("name") ?? ""),
    p_description: String(formData.get("description") ?? ""),
  });
  if (error) redirect(withMessage("/admin/team?tab=roles", "error", friendly(error.message)));
  revalidatePath("/admin/team");
  redirect(withMessage(`/admin/roles/${data}`, "msg", "Role created. Closebook starts at Edit with Prepare on; every other area at No access. Set the levels below."));
}

// Piece R3a-1: one save for the whole role (name, levels, Letters boxes, Closebook switches), in one database
// transaction (save_role). The database gives only what the saver holds and refuses a save that leaves no Admin.
export async function saveRole(formData: FormData) {
  const roleId = String(formData.get("role_id"));
  const page = `/admin/roles/${roleId}`;
  const supabase = await createClient();
  const levels: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("level:")) levels[key.slice(6)] = String(value);
  }
  const on = (k: string) => formData.get(k) === "on";
  const { error } = await supabase.rpc("save_role", {
    p_role_id: roleId,
    p_name: String(formData.get("name") ?? ""),
    p_description: String(formData.get("description") ?? ""),
    p_levels: levels,
    p_letters: { t1: on("can_t1_letters"), corporate: on("can_corporate_letters"), final: on("can_final_letters") },
    p_switches: Object.fromEntries(CB_SWITCHES.map((c) => [c.key, on(`cb:${c.key}`)])),
  });
  if (error) redirect(withMessage(page, "error", friendly(error.message)));
  revalidatePath("/admin/team");
  redirect(withMessage(page, "msg", "Role saved."));
}

export async function deleteRole(formData: FormData) {
  const roleId = String(formData.get("role_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_role", { p_role_id: roleId });
  if (error) redirect(withMessage(`/admin/roles/${roleId}`, "error", friendly(error.message)));
  revalidatePath("/admin/team");
  redirect(withMessage("/admin/team?tab=roles", "msg", "Role deleted."));
}

function friendly(message: string) {
  if (message.includes("roles_name_key")) return "A role with that name already exists.";
  if (message.includes("roles_name_check")) return "Role name must be 1 to 60 characters.";
  return message;
}
