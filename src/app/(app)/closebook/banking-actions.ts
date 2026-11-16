"use server";
// Step 3 "Banking" (round 23, Hashim, Nov 16, 2026): signing a sub-step (3.1, 3.2, 3.3), and one CSV for an
// account from the upload window. Round 24 (control rules): a statement is never deleted. View statements offers
// Replace file, Exclude statement, Restore and (owners, Wrong client) Purge; a line takes an accounting date and a
// memo. A signed 3.2 or 3.3 asks first ("This removes the sign-off on 3.3. Continue?"): the first call returns
// { confirm }, the second, with confirm, goes ahead. The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { balanceCheck, dollars, looksReversed, readBankUpload, REVERSED, typedCents } from "@/lib/closebook/bank-upload";
import { BUCKET, storedBytes } from "@/lib/statements/server";
import { signedCents, type ReadResult } from "@/lib/statements/types";
import { digitsOnly } from "@/lib/closebook/step3";
import { discardStatement } from "../statements/actions";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const PAPER: Record<string, string> = { "3.1": "accounts", "3.2": "feeds", "3.3": "reconcile" };

export type Guarded<T = object> = ({ ok: true } & T) | { ok: false; error: string; confirm?: string };
// A refusal that only asks to remove a sign-off comes back as a question; any other refusal as an error.
const refused = (message: string): { ok: false; error: string; confirm?: string } =>
  /^This removes the sign-off on/.test(message) ? { ok: false, error: message, confirm: message } : { ok: false, error: message };
async function editor(): Promise<string | null> {
  const a = await getAccess();
  return a && canEdit(a, "closebook") ? null : "You need Edit on Closebook.";
}

export async function signSubstep(f: FormData) {
  const id = s(f, "file_id"), sub = s(f, "sub"), role = s(f, "role");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `/closebook/${id}?step=records`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_sign_substep", { p_file: id, p_sub: sub, p_role: role });
  revalidatePath(`/closebook/${id}`);
  if (error) redirect(withMessage(back, "error", error.message));
  // After the preparer signs, the next sub-step opens (step 4 after 3.3).
  if (role === "prepared") {
    const next = sub === "3.1" ? "3.2" : sub === "3.2" ? "3.3" : null;
    redirect(withMessage(next ? `/closebook/${id}?step=records&paper=${PAPER[next]}` : `/closebook/${id}?step=code`, "msg", `${sub} signed.${next ? ` Next: ${next}.` : " Next: step 4."}`));
  }
  redirect(withMessage(back, "msg", `${sub} signed as reviewed.`));
}

export async function unsignSubstep(f: FormData) {
  const id = s(f, "file_id");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `/closebook/${id}?step=records`;
  const { error } = await (await createClient()).rpc("cb_unsign_substep", { p_file: id, p_sub: s(f, "sub"), p_role: s(f, "role") });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Your sign-off is taken back."));
}

// "Upload statements" while 3.2 or 3.3 is signed: the button asked first; this removes the sign-off.
export async function unlockFeed(fileId: string): Promise<Guarded> {
  const no = await editor(); if (no) return { ok: false, error: no };
  const { error } = await (await createClient()).rpc("cb_feed_unlock", { p_file: fileId });
  revalidatePath(`/closebook/${fileId}`);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// One CSV (Concept's template: Date, Description, Amount) for an account, with the statement's opening and
// closing balances. Refused unless opening + lines = closing, to the cent. Round 24: to the bank feed only.
export async function importCsv(fileId: string, account: string, fileName: string, text: string, opening: string, closing: string, confirm = false): Promise<
  { ok: true; lines: number; outside: number } | { ok: false; error: string; confirm?: string }> {
  const no = await editor(); if (no) return { ok: false, error: "You need Edit on Closebook to import." };
  const read = readBankUpload(text);
  if (read.errors.length) return { ok: false, error: `Refused: ${read.errors.slice(0, 3).join(" ")}` };
  const o = typedCents(opening), c = typedCents(closing);
  if (o === null || c === null) return { ok: false, error: "Enter the opening and closing balances from the statement." };
  const chk = balanceCheck(o, c, read.rows);
  if (!chk.ok) return { ok: false, error: looksReversed(o, c, read.rows) ? `Refused. ${REVERSED}`
    : `Refused: opening ${dollars(o)} + lines ${dollars(chk.totalCents)} = ${dollars(chk.expectedCents)}, but the closing balance is ${dollars(c)} (${dollars(chk.differenceCents)} off).` };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_import_csv", { p_file: fileId, p_account: account, p_file_name: fileName, p_opening: o / 100, p_closing: c / 100,
    p_rows: read.rows.map((r) => ({ line: r.line, date: r.date, description: r.description, amount: r.cents / 100 })), p_confirm: confirm });
  if (error) return refused(`Refused: ${error.message}`.replace(/^Refused: (This removes)/, "$1"));
  revalidatePath(`/closebook/${fileId}`);
  const d = data as { lines: number; outside: number };
  return { ok: true, lines: Number(d.lines), outside: Number(d.outside) };
}

// ---------- Exclude, Restore, Purge (rules 9 to 11)
export type Blocker = { id: string; date: string; description: string; amount: number; kind: "coded" | "transfer" | "outstanding" };
export async function excludeStatement(fileId: string, statement: string, reason: string, note: string, confirm = false): Promise<Guarded<{ lines: number }> | { ok: false; error: string; blockers: Blocker[] }> {
  const no = await editor(); if (no) return { ok: false, error: no };
  const { data, error } = await (await createClient()).rpc("cb_exclude_statement", { p_statement: statement, p_reason: reason, p_note: note, p_confirm: confirm });
  if (error) return refused(error.message);
  const d = data as { ok: boolean; lines?: number; blockers?: Blocker[] };
  if (!d.ok) return { ok: false, error: "Not excluded: some of its lines are in the books.", blockers: d.blockers ?? [] };
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true, lines: Number(d.lines ?? 0) };
}

export async function restoreStatement(fileId: string, statement: string, confirm = false): Promise<Guarded> {
  const no = await editor(); if (no) return { ok: false, error: no };
  const { error } = await (await createClient()).rpc("cb_restore_statement", { p_statement: statement, p_confirm: confirm });
  if (error) return refused(error.message);
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true };
}

// Owners only, a statement excluded as Wrong client: the file and its lines are erased (the stored PDF too).
export async function purgeStatement(fileId: string, statement: string): Promise<Guarded> {
  const a = await getAccess();
  if (!a?.is_owner) return { ok: false, error: "Only an owner can purge." };
  const { data, error } = await (await createClient()).rpc("cb_purge_statement", { p_statement: statement });
  if (error) return { ok: false, error: error.message };
  const d = data as { documents: string[]; reads: string[] };
  const admin = createAdminClient().storage;
  if (d.documents?.length) await admin.from("documents").remove(d.documents);
  if (d.reads?.length) await admin.from(BUCKET).remove(d.reads);
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true };
}

// ---------- Replace file (rule 8): a clearer copy of the same statement
export async function markReplacement(fileId: string, statement: string, imports: string[]): Promise<Guarded> {
  const no = await editor(); if (no) return { ok: false, error: no };
  const { error } = await (await createClient()).rpc("cb_mark_replacement", { p_imports: imports, p_statement: statement });
  return error ? { ok: false, error: error.message } : { ok: true };
}

const MISMATCH = "This file doesn't match the imported statement. To change its lines, exclude it and upload the right one.";
export async function replaceStatementFile(fileId: string, statement: string, upload: string, confirm = false): Promise<Guarded> {
  const no = await editor(); if (no) return { ok: false, error: no };
  const supabase = await createClient();
  const [{ data: st }, { data: row }] = await Promise.all([
    supabase.from("cb_bank_statements").select("id, account_id, period_start, period_end, account:account_id(last4)").eq("id", statement).maybeSingle(),
    supabase.from("cb_statement_imports").select("id, file_id, status, media_type, storage_path, result, edited").eq("id", upload).maybeSingle(),
  ]);
  if (!st || !row || row.file_id !== fileId) return { ok: false, error: "Statement not found." };
  if (!["ready", "needs_look"].includes(row.status as string)) return { ok: false, error: "The new file is not read yet." };
  const data = (row.edited ?? row.result) as ReadResult | null;
  const last4 = digitsOnly(((st.account as unknown as { last4: string | null } | null)?.last4) ?? "");
  // The account on the new file: the one with the account's last digits and the statement's period.
  const acc = data?.accounts.find((x) => x.periodStart === st.period_start && x.periodEnd === st.period_end && digitsOnly(x.last4).slice(-4) === last4.slice(-4))
    ?? (data?.accounts.length === 1 ? data.accounts[0] : null);
  if (!acc) { await discardStatement(upload); return { ok: false, error: MISMATCH }; }
  const rows = acc.lines.map((l, i) => ({ line: i + 1, date: l.date, amount: signedCents(l) / 100 }));
  const bytes = await storedBytes(row.storage_path as string);
  if (!bytes) return { ok: false, error: "The uploaded file is missing. Upload it again." };
  const ext = (row.storage_path as string).split(".").pop() ?? "pdf";
  const attachment = `closebook/${fileId}/statements/${upload}.${ext}`;
  const docs = createAdminClient().storage.from("documents");
  const up = await docs.upload(attachment, bytes, { contentType: row.media_type as string, upsert: true });
  if (up.error) return { ok: false, error: `The file could not be attached (${up.error.message}).` };
  const { error } = await supabase.rpc("cb_replace_statement_file", { p_statement: statement, p_import: upload, p_last4: acc.last4 ?? "", p_period_start: acc.periodStart,
    p_period_end: acc.periodEnd, p_opening: acc.opening / 100, p_closing: acc.closing / 100, p_rows: rows, p_attachment: attachment, p_confirm: confirm });
  if (error) {
    await docs.remove([attachment]);
    if (error.message.startsWith("This file doesn")) { await discardStatement(upload); return { ok: false, error: MISMATCH }; }
    return refused(error.message);
  }
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true };
}

// ---------- A line: accounting date and memo (rules 5, 6)
export async function setLineDate(fileId: string, line: string, date: string, confirm = false): Promise<Guarded> {
  const no = await editor(); if (no) return { ok: false, error: no };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Enter a date." };
  const supabase = await createClient();
  const { data: l } = await supabase.from("cb_bank_lines").select("status, chart_account").eq("id", line).maybeSingle();
  const { error } = await supabase.rpc("cb_set_line_date", { p_line: line, p_date: date, p_confirm: confirm });
  if (error) return refused(error.message);
  // A coded line's posting moves to the new date.
  if (l?.chart_account) await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true };
}

export async function setLineMemo(fileId: string, line: string, memo: string, confirm = false): Promise<Guarded> {
  const no = await editor(); if (no) return { ok: false, error: no };
  const { error } = await (await createClient()).rpc("cb_set_line_memo", { p_line: line, p_memo: memo, p_confirm: confirm });
  if (error) return refused(error.message);
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true };
}
