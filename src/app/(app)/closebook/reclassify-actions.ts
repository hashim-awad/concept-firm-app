"use server";
// Round 38: Reclassify transactions. Apply moves every ticked line in one step (the database checks each line again);
// Undo puts them back. The trial balance is rebuilt after each.
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { plainError } from "@/lib/plain-error";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const no = (error: string): { ok: false; error: string } => ({ ok: false, error: plainError(error) });
const ID = /^[0-9a-f-]{36}$/;
async function editor(): Promise<string | null> {
  const access = await getAccess();
  return access && canEdit(access, "closebook") ? null : "You need Edit on Closebook.";
}

export async function reclassifyLines(fileId: string, items: { kind: "bank" | "entry"; id: string }[], account: string, tax: string, total: number): Promise<R<{ batch: string }>> {
  const e = await editor(); if (e) return no(e);
  const list = items.filter((x) => (x.kind === "bank" || x.kind === "entry") && ID.test(x.id)).slice(0, 5000);
  if (!list.length) return no("Tick the lines to reclassify.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_reclassify", { p_file: fileId, p_items: list, p_account: account || null, p_tax: tax || null, p_total: Math.round(total * 100) / 100 });
  if (error) return no(error.message);
  const tb = await rebuildTb(supabase, fileId);
  return tb ? no(tb) : { ok: true, batch: data as string };
}

export async function undoReclassify(fileId: string, batch: string): Promise<R<{ n: number }>> {
  const e = await editor(); if (e) return no(e);
  if (!ID.test(batch)) return no("Not found.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_reclassify_undo", { p_batch: batch });
  if (error) return no(error.message);
  const tb = await rebuildTb(supabase, fileId);
  return tb ? no(tb) : { ok: true, n: Number(data ?? 0) };
}
