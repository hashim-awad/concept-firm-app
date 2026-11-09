import "server-only";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

// Shared by the Settings pages: who is looking, whether they can change settings, and the stored values.
export async function loadSettings(ownerOnly = false) {
  const access = await requireAccess("settings", "view");
  if (ownerOnly && !access.is_owner) {
    const { redirect } = await import("next/navigation");
    redirect("/?error=owners-only");
  }
  const editable = canEdit(access, "settings");
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");
  const byKey = new Map((data ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value]));
  return { access, editable, byKey, supabase };
}

export const readOnlyNote = (editable: boolean) => editable ? "Changes are recorded in the activity log." : "You can view this setting. Only people with Edit can change it.";
