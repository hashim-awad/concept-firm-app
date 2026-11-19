"use server";
// Piece 10 (Hashim, Nov 19, 2026): step 6 "Compare to last year" and its items in step 7. Each returns the database's
// message, or null when saved. Every rule is checked again in the database.
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

async function call(fileId: string, fn: string, args: Record<string, unknown>): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc(fn, { p_file: fileId, ...args });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

export async function confirmNewAccount(fileId: string, account: string, on: boolean) {
  return call(fileId, "cb_confirm_new_account", { p_account: account, p_on: on });
}
export async function reviewNewAccount(fileId: string, account: string, on: boolean) {
  return call(fileId, "cb_review_new_account", { p_account: account, p_on: on });
}
export async function seenUnused(fileId: string, on: boolean) {
  return call(fileId, "cb_seen_unused", { p_on: on });
}
export async function answerYearChange(fileId: string, question: string, answer: boolean | null, note: string) {
  return call(fileId, "cb_answer_year_change", { p_question: question, p_answer: answer, p_note: note });
}
export async function reviewYearChange(fileId: string, question: string, on: boolean) {
  return call(fileId, "cb_review_year_change", { p_question: question, p_on: on });
}
