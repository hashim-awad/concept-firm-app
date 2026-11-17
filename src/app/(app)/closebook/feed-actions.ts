"use server";
// Round 31, step 4 (Hashim, Nov 17, 2026): the actions behind the Bank transactions page (QuickBooks Online). Each returns
// { ok: true } or { ok: false, error } in plain words; the database checks every rule again. The page keeps its own list,
// so nothing here reloads it: a posting rebuilds the trial balance, and the page updates its counts and cards itself.
import { randomUUID } from "node:crypto";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { plainError } from "@/lib/plain-error";
import { reportXlsx } from "@/lib/closebook/xlsx-write";
import type { PostItem, BankRule } from "@/lib/closebook/bank-feed";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const no = (error: string): { ok: false; error: string } => ({ ok: false, error: plainError(error) });
async function editor(): Promise<string | null> {
  const a = await getAccess();
  return !a || !canEdit(a, "closebook") ? "You need Edit on Closebook to code transactions." : null;
}
const ID = /^[0-9a-f-]{36}$/i;
const ids = (xs: string[]) => xs.filter((x) => ID.test(x)).slice(0, 5000);

// The account, sales tax or transfer chosen on a Pending line (kept, nothing posts).
export async function fillLines(fileId: string, items: { id: string; account: string | null; tax: string | null; transfer_account: string | null }[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_fill_lines", { p_file: fileId, p_items: items });
  return error ? no(error.message) : { ok: true };
}

export async function postLines(fileId: string, items: PostItem[]): Promise<R<{ posted: number }>> {
  const e = await editor(); if (e) return no(e);
  if (!items.length) return no("Nothing to post.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_post_lines", { p_file: fileId, p_items: items });
  if (error) return no(error.message);
  const tb = await rebuildTb(supabase, fileId);
  if (tb) return no(tb);
  return { ok: true, posted: Number(data ?? 0) };
}

export async function unpostLines(fileId: string, lineIds: string[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_unpost_lines", { p_file: fileId, p_ids: ids(lineIds) });
  if (error) return no(error.message);
  const tb = await rebuildTb(supabase, fileId);
  return tb ? no(tb) : { ok: true };
}

export async function excludeLines(fileId: string, lineIds: string[], reason: "duplicate" | "recorded" | "other", note: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_exclude_lines", { p_file: fileId, p_ids: ids(lineIds), p_reason: reason, p_note: note });
  return error ? no(error.message) : { ok: true };
}

export async function restoreLines(fileId: string, lineIds: string[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_restore_lines", { p_file: fileId, p_ids: ids(lineIds) });
  return error ? no(error.message) : { ok: true };
}

export async function askClientLines(fileId: string, lineIds: string[], question: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_ask_client_lines", { p_file: fileId, p_ids: ids(lineIds), p_question: question });
  return error ? no(error.message) : { ok: true };
}

export async function setClientAnswer(lineId: string, answer: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_set_client_answer", { p_line: lineId, p_answer: answer });
  return error ? no(error.message) : { ok: true };
}

export async function setMemo(lineId: string, memo: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_set_line_memo", { p_line: lineId, p_memo: memo, p_confirm: true });
  return error ? no(error.message) : { ok: true };
}

// The accounting date (📅): within the file's year; the bank's own date never changes. A posted line's posting moves.
export async function setDate(fileId: string, lineId: string, date: string, posted: boolean): Promise<R> {
  const e = await editor(); if (e) return no(e);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return no("Enter a date.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_set_line_date", { p_line: lineId, p_date: date, p_confirm: true });
  if (error) return no(error.message);
  if (posted) { const tb = await rebuildTb(supabase, fileId); if (tb) return no(tb); }
  return { ok: true };
}

export async function pairChoice(fileId: string, a: string, b: string, kind: "chosen" | "rejected"): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_pair_choice", { p_file: fileId, p_a: a, p_b: b, p_kind: kind });
  return error ? no(error.message) : { ok: true };
}

export async function saveSplits(lineId: string, rows: { account: string; tax: string; amount: string; memo: string }[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_save_splits", { p_line: lineId, p_rows: rows });
  return error ? no(error.message) : { ok: true };
}

export async function clearSplits(lineId: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_clear_splits", { p_line: lineId });
  return error ? no(error.message) : { ok: true };
}

// ---------- Rules
export async function saveRule(fileId: string, id: string | null, rule: Omit<BankRule, "id" | "priority" | "active"> & { account: string | null; tax: string | null }): Promise<R<{ id: string }>> {
  const e = await editor(); if (e) return no(e);
  const { data, error } = await (await createClient()).rpc("cb_save_rule", { p_file: fileId, p_id: id, p_rule: rule });
  return error ? no(error.message) : { ok: true, id: data as string };
}
export async function ruleAction(fileId: string, id: string, action: "disable" | "enable" | "delete" | "copy"): Promise<R<{ id: string }>> {
  const e = await editor(); if (e) return no(e);
  const { data, error } = await (await createClient()).rpc("cb_rule_action", { p_file: fileId, p_id: id, p_action: action });
  return error ? no(error.message) : { ok: true, id: data as string };
}
export async function reorderRules(fileId: string, order: string[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_reorder_rules", { p_file: fileId, p_ids: ids(order) });
  return error ? no(error.message) : { ok: true };
}

export async function excludedReviewed(fileId: string, on: boolean): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_excluded_reviewed", { p_file: fileId, p_on: on });
  return error ? no(error.message) : { ok: true };
}

// ---------- Receipts (📎)
const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|heic|heif|webp))$/;
export async function attachReceipt(fd: FormData): Promise<R<{ id: string; name: string }>> {
  const e = await editor(); if (e) return no(e);
  const fileId = String(fd.get("fileId") ?? ""), lineId = String(fd.get("lineId") ?? "");
  const f = fd.get("file");
  if (!ID.test(fileId) || !ID.test(lineId) || !(f instanceof File) || !f.size) return no("Choose a file.");
  if (f.size > 20 * 1024 * 1024) return no("The file is over 20 MB.");
  if (!OK_TYPES.test(f.type)) return no("Attach a PDF or a photo (JPG, PNG or HEIC).");
  const ext = (f.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "pdf").toLowerCase();
  const path = `closebook/${fileId}/lines/${lineId}/${randomUUID()}.${ext}`;
  const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type, upsert: false });
  if (up.error) return no(`The file was not saved: ${up.error.message}`);
  const { data, error } = await (await createClient()).rpc("cb_add_line_file", { p_line: lineId, p_path: path, p_name: f.name, p_size: f.size });
  if (error) { await createAdminClient().storage.from("documents").remove([path]); return no(error.message); }
  return { ok: true, id: data as string, name: f.name };
}
export async function receiptUrl(id: string): Promise<R<{ url: string }>> {
  const a = await getAccess();
  if (!a) return no("Sign in again.");
  const { data } = await (await createClient()).from("cb_line_files").select("path").eq("id", id).maybeSingle();
  if (!data) return no("File not found.");
  const s = await createAdminClient().storage.from("documents").createSignedUrl(data.path as string, 600);
  return s.error || !s.data ? no("The file could not be opened.") : { ok: true, url: s.data.signedUrl };
}

// ---------- Export (⤓): the list on screen, in Excel
export async function exportList(title: string, columns: string[], rows: (string | number | null)[][]): Promise<R<{ base64: string }>> {
  const a = await getAccess();
  if (!a) return no("Sign in again.");
  const numeric = columns.map((c) => c === "Spent" || c === "Received" || c === "ITC");
  const buf = reportXlsx({ title, columns, numeric, rows: rows.slice(0, 50000).map((cells) => ({ cells })) }, [], "");
  return { ok: true, base64: Buffer.from(buf).toString("base64") };
}

// The lines again after a change, as the database has them (only those lines, not the page).
export async function getLines(fileId: string, lineIds: string[]): Promise<R<{ lines: import("@/lib/closebook/bank-feed").FeedLine[]; splits: Record<string, import("@/lib/closebook/feed-server").FeedSplit[]> }>> {
  const a = await getAccess();
  if (!a) return no("Sign in again.");
  const { readLines } = await import("@/lib/closebook/feed-server");
  return { ok: true, ...(await readLines(await createClient(), fileId, ids(lineIds))) };
}

// ---------- Round 35: step 7's working list (QuickBooks Online Accountant's Reclassify; TaxDome's Mark reviewed)
// Another account and sales tax on posted lines, in place: the posting changes at once (the trial balance is rebuilt).
export async function recodeLines(fileId: string, items: { id: string; account: string; tax: string }[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  if (!items.length) return no("Choose the lines.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_recode_lines", { p_file: fileId, p_items: items });
  if (error) return no(error.message);
  const tb = await rebuildTb(supabase, fileId);
  return tb ? no(tb) : { ok: true };
}

// Mark reviewed (the file's reviewer or an owner): the flag clears; the posting does not change.
export async function reviewLines(fileId: string, lineIds: string[], undo = false): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc(undo ? "cb_unreview_lines" : "cb_review_lines", { p_file: fileId, p_ids: ids(lineIds) });
  return error ? no(error.message) : { ok: true };
}

// A posted line split again, in place.
export async function resplitLine(fileId: string, lineId: string, rows: { account: string; tax: string; amount: string; memo: string }[]): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_resplit_line", { p_line: lineId, p_rows: rows.map((r) => ({ ...r, amount: Number(String(r.amount).replace(/[,$\s]/g, "")) })) });
  if (error) return no(error.message);
  const tb = await rebuildTb(supabase, fileId);
  return tb ? no(tb) : { ok: true };
}

// An account for the reviewer's decision, marked reviewed with its note: the reviewer's flag, a type on another
// line's type, or a balance on the other side (the last two use their own confirmations).
export async function reviewAccount(fileId: string, accountId: string, kind: "reviewer" | "type" | "side", note: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const supabase = await createClient();
  const { error } = kind === "type" ? await supabase.rpc("cb_confirm_type", { p_account: accountId, p_reason: note })
    : kind === "side" ? await supabase.rpc("cb_confirm_side", { p_account: accountId, p_reason: note })
    : await supabase.rpc("cb_review_account", { p_account: accountId, p_note: note });
  void fileId;
  return error ? no(error.message) : { ok: true };
}

// A review note on a line (the reviewer's).
export async function noteOnLine(fileId: string, lineId: string, body: string): Promise<R> {
  const e = await editor(); if (e) return no(e);
  const { error } = await (await createClient()).rpc("cb_add_note", { p_file: fileId, p_step: "code", p_target_type: "bank_line", p_target: lineId, p_body: body });
  return error ? no(error.message) : { ok: true };
}
