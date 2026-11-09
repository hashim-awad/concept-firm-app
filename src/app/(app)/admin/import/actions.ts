"use server";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { floorCorrections, regeneratePast, runImport, type ImportResult } from "@/lib/import/run";

export type ImportState = ImportResult | { ok: false; error: string } | null;

// Owner only. The file is read in memory, checked, and (if not a dry run) written. Never stored.
export async function importCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const access = await getAccess();
  if (!access?.is_owner) return { ok: false, error: "Only an owner can import." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the CSV file exported from Notion." };
  if (file.size > 3.5 * 1024 * 1024) return { ok: false, error: "The file is over 3.5 MB. Export the database again without page content." };
  const dryRun = formData.get("mode") !== "import";
  if (!dryRun && formData.get("reviewed") !== "on") return { ok: false, error: "Run the check first, then tick the box to confirm you reviewed it." };
  const text = await file.text();
  const r = await runImport(await createClient(), file.name, text, dryRun);
  revalidatePath("/admin/import");
  return r;
}

export async function regenerateAction(): Promise<{ ok: boolean; message: string }> {
  const access = await getAccess();
  if (!access?.is_owner) return { ok: false, message: "Only an owner can do this." };
  const r = await regeneratePast(await createClient(), access, 15);
  revalidatePath("/admin/import");
  return { ok: r.problems.length === 0, message: `Regenerated ${r.done} PDF${r.done === 1 ? "" : "s"}. ${r.left > 0 ? `${r.left} left: press again.` : "None left."}${r.problems.length ? " Problems: " + r.problems.join("; ") : ""}` };
}

export async function applyFloorCorrections(): Promise<{ ok: boolean; message: string }> {
  const access = await getAccess();
  if (!access?.is_owner) return { ok: false, message: "Only an owner can do this." };
  const supabase = await createClient();
  const { patches, missing } = await floorCorrections(supabase);
  for (const p of patches) {
    const { error } = await supabase.from("offers").update(p.patch).eq("offer", p.offer);
    if (error) return { ok: false, message: `${p.offer}: ${error.message}` };
  }
  revalidatePath("/admin/import");
  return { ok: true, message: `Applied ${patches.length} change${patches.length === 1 ? "" : "s"}. Each is in the activity log.${missing.length ? " Not found: " + missing.join(", ") + "." : ""}` };
}
