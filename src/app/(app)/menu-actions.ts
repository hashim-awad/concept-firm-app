"use server";

import { createClient } from "@/lib/supabase/server";

// Round 36b: each person's choice for the left menus (pinned open or folded), kept across pages and sign-ins.
export async function setMenuPin(menu: "menu" | "steps", pinned: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (menu !== "menu" && menu !== "steps") return { ok: false, error: "Unknown menu." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_menu_pin", { p_menu: menu, p_pinned: !!pinned });
  if (error) { console.error(`[menu pin] ${error.message}`); return { ok: false, error: "The choice was not saved. It applies on this page only." }; }
  return { ok: true };
}
