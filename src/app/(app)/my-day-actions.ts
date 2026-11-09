"use server";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

// My day: mark T2 deadlines done (filed, or balance paid). One ("one" button) or the ticked ones
// ("items"). Recorded with who and when.
export async function markDeadlinesDone(formData: FormData): Promise<void> {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return;
  const one = formData.get("one");
  const keys = one ? [String(one)] : formData.getAll("items").map(String);
  const rows = keys.slice(0, 500).map((k) => k.split("|")).filter(([c, y, kind]) => /^[0-9a-f-]{36}$/.test(c ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(y ?? "") && (kind === "filing" || kind === "balance"))
    .map(([client_id, year_end, kind]) => ({ client_id, year_end, kind }));
  if (!rows.length) return;
  const supabase = await createClient();
  await supabase.from("t2_deadline_done").upsert(rows, { onConflict: "client_id,year_end,kind", ignoreDuplicates: true });
  revalidatePath("/");
}
