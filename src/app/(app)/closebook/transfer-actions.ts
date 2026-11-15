"use server";
// Step 4, round 20 (Hashim, Nov 15, 2026): transfers between the file's own accounts, as the QuickBooks
// Online bank feed records a transfer. The database checks every rule again (edit permission, a locked
// file, both lines still to code, same amount, 5 days, one out and one in, one transfer per line).
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { rebuildTb } from "@/lib/closebook/tb-build-server";

export async function acceptTransferInline(fileId: string, lineId: string, otherId: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook to code transactions.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_accept_transfer", { p_file: fileId, p_line: lineId, p_other: otherId });
  if (error) return error.message;
  const tb = await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  return tb;
}

export async function undoTransferInline(fileId: string, lineId: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_undo_transfer", { p_file: fileId, p_line: lineId });
  if (error) return error.message;
  const tb = await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  return tb;
}
