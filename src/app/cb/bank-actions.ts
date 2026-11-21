"use server";
// CB2-1 PR B: Bank transactions, Upload from file, Rules and Reconcile. Every change goes through a database function,
// which checks rights, the firm, the year lock and the rules.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { historyOf, suggest, type BooksRule } from "@/lib/books/bank";
import { dupKey } from "@/lib/books/csv";

const UUID = /^[0-9a-f-]{36}$/;
type Res = { ok: true; n?: number } | { ok: false; error: string };
const done = (clientId: string, n?: number): Res => { revalidatePath(`/cb/${clientId}`, "layout"); return { ok: true, n }; };

export type ConfirmItem = { id: string; kind: "code" | "split" | "transfer" | "pair" | "entry"; account?: string; tax?: string | null; memo?: string;
  rows?: { account: string; tax: string; amount: number; memo?: string }[]; transfer?: string; other?: string; entry?: string; source?: string; rule_id?: string | null };

export async function confirmLines(clientId: string, items: ConfirmItem[]): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId) || !items.length || items.some((i) => !UUID.test(i.id))) return { ok: false, error: "Nothing to confirm." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_books_confirm", { p_client: clientId, p_items: items });
  return error ? { ok: false, error: error.message } : done(clientId, data as number);
}

// The year file each line belongs to (the old engine's functions work one year file at a time).
async function byFile(ids: string[]): Promise<Map<string, { id: string; matched_entry: string | null }[]>> {
  const supabase = await createClient();
  const { data } = await supabase.from("cb_bank_lines").select("id, file_id, matched_entry").in("id", ids);
  const m = new Map<string, { id: string; matched_entry: string | null }[]>();
  for (const r of (data ?? []) as { id: string; file_id: string; matched_entry: string | null }[]) m.set(r.file_id, [...(m.get(r.file_id) ?? []), r]);
  return m;
}

export async function excludeLines(clientId: string, ids: string[], reason: string, note: string): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!ids.length || ids.some((i) => !UUID.test(i))) return { ok: false, error: "Nothing to exclude." };
  const supabase = await createClient();
  let n = 0;
  for (const [file, ls] of await byFile(ids)) {
    const { data, error } = await supabase.rpc("cb_exclude_lines", { p_file: file, p_ids: ls.map((l) => l.id), p_reason: reason, p_note: note });
    if (error) return { ok: false, error: error.message };
    n += data as number;
  }
  return done(clientId, n);
}

// Excluded: Undo puts the line back For review.
export async function restoreLines(clientId: string, ids: string[]): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!ids.length || ids.some((i) => !UUID.test(i))) return { ok: false, error: "Nothing to undo." };
  const supabase = await createClient();
  let n = 0;
  for (const [file, ls] of await byFile(ids)) {
    const { data, error } = await supabase.rpc("cb_restore_lines", { p_file: file, p_ids: ls.map((l) => l.id) });
    if (error) return { ok: false, error: error.message };
    n += data as number;
  }
  return done(clientId, n);
}

// Categorized: Undo puts the line back For review (a match to a journal entry is undone; the entry stays).
export async function undoLines(clientId: string, ids: string[]): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!ids.length || ids.some((i) => !UUID.test(i))) return { ok: false, error: "Nothing to undo." };
  const supabase = await createClient();
  let n = 0;
  for (const [file, ls] of await byFile(ids)) {
    for (const l of ls.filter((x) => x.matched_entry)) {
      const { error } = await supabase.rpc("cb_books_unmatch_entry", { p_line: l.id });
      if (error) return { ok: false, error: error.message };
      n++;
    }
    const rest = ls.filter((x) => !x.matched_entry).map((x) => x.id);
    if (rest.length) {
      const { error } = await supabase.rpc("cb_unpost_lines", { p_file: file, p_ids: rest });
      if (error) return { ok: false, error: error.message };
      n += rest.length;
    }
  }
  return done(clientId, n);
}

// Categorized: change in place (account and tax code, a split, or the memo).
export async function changeLine(clientId: string, lineId: string, change: { account?: string; tax?: string | null; memo?: string;
  splits?: { account: string; tax: string; amount: number; memo?: string }[] }): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(lineId)) return { ok: false, error: "Line not found." };
  const files = await byFile([lineId]);
  const file = [...files.keys()][0];
  if (!file) return { ok: false, error: "Line not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_change_line", { p_file: file, p_line: lineId, p_change: change });
  return error ? { ok: false, error: error.message } : done(clientId);
}

// Upload from file, then the rules set to "Automatically confirm" confirm the new lines they apply to.
export async function uploadBankFile(clientId: string, ident: string, fileName: string, rows: { date: string; description: string; amount: number }[],
  opening: number | null, closing: number | null, mapping: unknown): Promise<{ ok: true; lines: number; auto: number } | { ok: false; error: string }> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId)) return { ok: false, error: "Client not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_books_upload", { p_client: clientId, p_ident: ident, p_file_name: fileName, p_rows: rows,
    p_opening: opening, p_closing: closing, p_mapping: mapping });
  if (error) return { ok: false, error: error.message };
  const lines = (data as { lines: number }).lines;
  const auto = await autoConfirm(clientId, ident);
  revalidatePath(`/cb/${clientId}`, "layout");
  return { ok: true, lines, auto };
}

async function autoConfirm(clientId: string, ident: string): Promise<number> {
  const supabase = await createClient();
  const { data: ruleRows } = await supabase.from("cb_books_rules").select("id, name, priority, direction, accounts, match_all, conditions, chart_account, splits, tax_code, memo, auto_confirm, active")
    .eq("cb_client_id", clientId).eq("auto_confirm", true).eq("active", true).order("priority");
  const rules = (ruleRows ?? []) as BooksRule[];
  if (!rules.length) return 0;
  // Every rule by priority decides; only an "Automatically confirm" rule that wins posts by itself.
  const { data: all } = await supabase.from("cb_books_rules").select("id, name, priority, direction, accounts, match_all, conditions, chart_account, splits, tax_code, memo, auto_confirm, active")
    .eq("cb_client_id", clientId).order("priority");
  const { data: files } = await supabase.from("cb_files").select("id").eq("cb_client_id", clientId);
  const { data: accts } = await supabase.from("cb_bank_accounts").select("id, kind, number, chart_account").in("file_id", ((files ?? []) as { id: string }[]).map((f) => f.id));
  const mine = ((accts ?? []) as { id: string; kind: "bank" | "card"; number: string | null; chart_account: string }[]).filter((a) => (a.number || a.chart_account) === ident);
  if (!mine.length) return 0;
  const { data: lines } = await supabase.from("cb_bank_lines").select("id, description, amount").in("account_id", mine.map((a) => a.id)).eq("status", "new").limit(20000);
  const { data: chart } = await supabase.from("cb_client_accounts").select("number, tax_code").eq("cb_client_id", clientId);
  const { data: firm } = await supabase.from("cb_chart_accounts").select("number, tax_default");
  const taxOf = new Map(((firm ?? []) as { number: string; tax_default: string | null }[]).map((r) => [r.number, r.tax_default]));
  for (const c of (chart ?? []) as { number: string; tax_code: string | null }[]) if (c.tax_code) taxOf.set(c.number, c.tax_code);
  const items: ConfirmItem[] = [];
  for (const l of (lines ?? []) as { id: string; description: string; amount: number }[]) {
    const cents = Math.round(l.amount * 100);
    const s = suggest({ id: l.id, description: l.description, cents }, ident, mine[0].kind, (all ?? []) as BooksRule[], historyOf([]));
    if (!s?.auto || !s.ruleId) continue;
    if (s.splits?.length) items.push({ id: l.id, kind: "split", rows: s.splits.map((r) => ({ account: r.account, tax: r.tax, amount: r.cents / 100 })), memo: s.memo, source: "rule", rule_id: s.ruleId });
    else if (s.account) items.push({ id: l.id, kind: "code", account: s.account, tax: s.tax ?? taxOf.get(s.account) ?? null, memo: s.memo, source: "rule", rule_id: s.ruleId });
  }
  if (!items.length) return 0;
  const { data } = await supabase.rpc("cb_books_confirm", { p_client: clientId, p_items: items });
  return (data as number) ?? 0;
}

export type RuleIn = { name: string; direction: "in" | "out" | "any"; accounts: string[]; match_all: boolean; conditions: BooksRule["conditions"];
  chart_account: string | null; splits: { account: string; tax: string; percent: number }[] | null; tax_code: string | null; memo: string; auto_confirm: boolean; active: boolean };
export async function saveRule(clientId: string, id: string | null, rule: RuleIn): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId) || (id && !UUID.test(id))) return { ok: false, error: "Rule not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_books_save_rule", { p_client: clientId, p_id: id, p_rule: rule });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/cb/${clientId}`, "layout");
  return { ok: true, id: data as string };
}
export async function ruleAction(clientId: string, id: string, action: "copy" | "delete"): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(id)) return { ok: false, error: "Rule not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_books_rule_action", { p_rule: id, p_action: action });
  return error ? { ok: false, error: error.message } : done(clientId);
}

export async function finishReconcile(clientId: string, ident: string, date: string, ending: number, lines: string[], opening = 0): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(clientId) || lines.some((i) => !UUID.test(i))) return { ok: false, error: "Client not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_books_reconcile", { p_client: clientId, p_ident: ident, p_date: date, p_ending: ending, p_lines: lines, p_opening: opening });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/cb/${clientId}`, "layout");
  return { ok: true, id: data as string };
}
export async function undoReconcile(clientId: string, id: string): Promise<Res> {
  await requireAccess("closebook", "edit");
  if (!UUID.test(id)) return { ok: false, error: "Reconciliation not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_books_undo_reconcile", { p_rec: id });
  return error ? { ok: false, error: error.message } : done(clientId);
}

// The lines already uploaded for an account (date, amount and description), to flag duplicates in a new file.
export async function existingKeys(clientId: string, ident: string): Promise<string[]> {
  await requireAccess("closebook", "view");
  if (!UUID.test(clientId)) return [];
  const supabase = await createClient();
  const { data: files } = await supabase.from("cb_files").select("id").eq("cb_client_id", clientId);
  const { data: accts } = await supabase.from("cb_bank_accounts").select("id, number, chart_account").in("file_id", ((files ?? []) as { id: string }[]).map((f) => f.id));
  const ids = ((accts ?? []) as { id: string; number: string | null; chart_account: string }[]).filter((a) => (a.number || a.chart_account) === ident).map((a) => a.id);
  if (!ids.length) return [];
  const { data } = await supabase.from("cb_bank_lines").select("txn_date, amount, description").in("account_id", ids).limit(100000);
  return ((data ?? []) as { txn_date: string; amount: number; description: string }[]).map((r) => dupKey({ date: r.txn_date, cents: Math.round(r.amount * 100), description: r.description }));
}
