"use server";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

// My day: mark a T2 deadline done (filed, or balance paid). Recorded with who and when.
export async function markDeadlineDone(formData: FormData): Promise<void> {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return;
  const kind = formData.get("kind") === "filing" ? "filing" : "balance";
  const year_end = String(formData.get("year_end") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(year_end)) return;
  const supabase = await createClient();
  await supabase.from("t2_deadline_done").insert({ client_id: String(formData.get("client_id") ?? ""), year_end, kind });
  revalidatePath("/");
}
