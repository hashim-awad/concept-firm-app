import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Round 36b: each person's saved choice for the left menus. Never chosen: the main menu as before (null:
// open on most pages, folded inside a Closebook file); the steps panel pinned.
export type MenuPins = { menu: boolean | null; steps: boolean };

export async function readMenuPins(supabase: SupabaseClient, staffId: string): Promise<MenuPins> {
  const { data, error } = await supabase.from("staff_ui_prefs").select("menu_pinned, steps_pinned").eq("staff_id", staffId).maybeSingle();
  if (error) { console.error(`[menu pins] ${error.message}`); return { menu: null, steps: true }; }
  return { menu: (data?.menu_pinned as boolean | null | undefined) ?? null, steps: (data?.steps_pinned as boolean | undefined) ?? true };
}
