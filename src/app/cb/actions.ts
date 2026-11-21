"use server";
// CB2-1: Books actions. Every change goes through a database function, which checks rights, the firm and the rules.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f-]{36}$/;
export type AccountResult = { ok: true; id: string } | { ok: false; error: string } | { ok: false; merge: { id: string; label: string } };

export async function saveAccount(clientId: string, a: { id?: string; number: string; name: string; type: string; line: string; tax: string }, merge = false): Promise<AccountResult> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId)) return { ok: false, error: "Client not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_books_save_account", { p_client: clientId, p_id: a.id || null, p_number: a.number, p_name: a.name, p_type: a.type,
    p_line: a.line, p_tax: a.tax, p_merge: merge });
  if (error) {
    const m = /^MERGE\|([0-9a-f-]{36})\|(.*)$/.exec(error.message);
    if (m) return { ok: false, merge: { id: m[1], label: m[2] } };
    return { ok: false, error: error.message };
  }
  revalidatePath(`/cb/${clientId}`, "layout");
  return { ok: true, id: data as string };
}

export async function setAccountActive(clientId: string, accountId: string, active: boolean): Promise<{ error?: string }> {
  await requireAccess("closebook", "edit");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_books_set_active", { p_account: accountId, p_active: active });
  revalidatePath(`/cb/${clientId}`, "layout");
  return error ? { error: error.message } : {};
}

export type EntryLineIn = { account: string; amount: number; memo: string; tax_code?: string | null; is_tax?: boolean };
export type EntryIn = { id?: string | null; date: string; journalNo: string; reclass: boolean; memo: string; lines: EntryLineIn[]; origin?: string | null; attachments?: string[] };

export async function saveEntry(clientId: string, entry: EntryIn): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId)) return { ok: false, error: "Client not found." };
  let e = entry;
  const supabase = await createClient();
  // Sales tax lines post to GST/HST payable (21500) or PST payable (21550): the client's own account with that number,
  // added to the client's chart from the template when it has none.
  for (const n of ["21500", "21550"]) {
    if (!e.lines.some((l) => l.account === `tax:${n}`)) continue;
    const { data: have } = await supabase.from("cb_client_accounts").select("id").eq("cb_client_id", clientId).eq("number", n).is("merged_into", null).maybeSingle();
    let id = (have as { id: string } | null)?.id;
    if (!id) {
      const { data: t } = await supabase.from("cb_chart_accounts").select("name, account_type, line_no").eq("number", n).maybeSingle();
      if (!t) return { ok: false, error: `Add account ${n} for the sales tax to the chart of accounts first.` };
      const r = await supabase.rpc("cb_books_save_account", { p_client: clientId, p_id: null, p_number: n, p_name: t.name, p_type: t.account_type, p_line: t.line_no, p_tax: null, p_merge: false });
      if (r.error) return { ok: false, error: r.error.message };
      id = r.data as string;
    }
    e = { ...e, lines: e.lines.map((l) => (l.account === `tax:${n}` ? { ...l, account: id! } : l)) };
  }
  // An edit keeps the entry's attachments and adds the new ones.
  let attachments = e.attachments ?? [];
  if (e.id && UUID.test(e.id)) {
    const { data: cur } = await supabase.from("cb_entries").select("attachments").eq("id", e.id).maybeSingle();
    attachments = [...(((cur as { attachments: string[] | null } | null)?.attachments) ?? []), ...attachments].slice(0, 10);
  }
  const { data, error } = await supabase.rpc("cb_books_save_entry", { p_client: clientId, p_entry: e.id && UUID.test(e.id) ? e.id : null, p_date: e.date, p_journal_no: e.journalNo,
    p_reclass: e.reclass, p_memo: e.memo, p_lines: e.lines, p_attachments: attachments, p_origin: e.origin ?? null });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/cb/${clientId}`, "layout");
  return { ok: true, id: data as string };
}

export async function deleteEntry(clientId: string, entryId: string): Promise<{ error?: string }> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(entryId)) return { error: "Entry not found." };
  const supabase = await createClient();
  // The entry must be this client's (the database checks the firm and the rights).
  const { data: e } = await supabase.from("cb_entries").select("id, origin, file:file_id(cb_client_id)").eq("id", entryId).maybeSingle();
  if (!e || (e.file as unknown as { cb_client_id: string } | null)?.cb_client_id !== clientId) return { error: "Entry not found." };
  if (["opening_balances", "opening_difference", "tb_import"].includes((e as { origin?: string | null }).origin ?? "")) return { error: "Change this entry in the old Closebook until the switch-over." };
  const { error } = await supabase.rpc("cb_delete_entry", { p_entry: entryId });
  revalidatePath(`/cb/${clientId}`, "layout");
  return error ? { error: error.message } : {};
}

export async function addClient(name: string, province: string, studio: string | null): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAccess("closebook", "edit");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_books_add_client", { p_name: name, p_province: province, p_studio: studio && UUID.test(studio) ? studio : null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/cb", "layout");
  return { ok: true, id: data as string };
}

// Attachments for a journal entry, stored before the entry saves (the entry keeps their paths). Up to 10 files.
export async function uploadEntryFiles(clientId: string, fd: FormData): Promise<{ paths: string[] } | { error: string }> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId)) return { error: "Client not found." };
  const files = fd.getAll("files").filter((x): x is File => x instanceof File && x.size > 0).slice(0, 10);
  const paths: string[] = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) return { error: `${file.name} is over 20 MB.` };
    const path = `closebook/books/${clientId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) return { error: `${file.name} was not saved: ${up.error.message}` };
    paths.push(path);
  }
  return { paths };
}
