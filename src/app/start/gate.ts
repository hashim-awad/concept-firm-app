import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";

// The start page is closed to the public until an owner opens it (Settings). Signed-in staff can
// always open it, to test; they see a "Preview" note.
export async function startGate(): Promise<{ open: boolean; preview: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("start_page_open");
  if (data === true) return { open: true, preview: false };
  const access = await getAccess();
  return { open: !!access, preview: !!access };
}
