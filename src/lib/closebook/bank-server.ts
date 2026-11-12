// Loads a file's bank and card accounts, their statements and (for one account) the transactions.
import type { SupabaseClient } from "@supabase/supabase-js";

export type BankAccount = { id: string; name: string; kind: "bank" | "card" };
export type BankStatement = { id: string; account_id: string; file_name: string; first_date: string; last_date: string; opening: number; closing: number;
  lines: number; plus_total: number; minus_total: number; uploaded_at: string; who: { full_name: string } | null };
export type BankLine = { id: string; row_no: number; txn_date: string; description: string; amount: number; statement_id: string };
export type BankData = { accounts: BankAccount[]; statements: BankStatement[]; lines: BankLine[]; selected: string; error: string | null };

export async function loadBank(supabase: SupabaseClient, fileId: string, account?: string): Promise<BankData> {
  const [{ data: accs, error: e1 }, { data: sts, error: e2 }] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, name, kind").eq("file_id", fileId).order("name"),
    supabase.from("cb_bank_statements").select("id, account_id, file_name, first_date, last_date, opening, closing, lines, plus_total, minus_total, uploaded_at, who:uploaded_by(full_name)")
      .eq("file_id", fileId).order("first_date"),
  ]);
  const accounts = (accs ?? []) as BankAccount[];
  const selected = accounts.some((a) => a.id === account) ? account! : accounts[0]?.id ?? "";
  let lines: BankLine[] = [], e3 = null;
  if (selected) {
    const r = await supabase.from("cb_bank_lines").select("id, row_no, txn_date, description, amount, statement_id").eq("account_id", selected).order("txn_date").order("row_no").limit(5000);
    lines = ((r.data ?? []) as BankLine[]).map((l) => ({ ...l, amount: Number(l.amount) }));
    e3 = r.error;
  }
  const num = (s: BankStatement) => ({ ...s, opening: Number(s.opening), closing: Number(s.closing), plus_total: Number(s.plus_total), minus_total: Number(s.minus_total) });
  const err = e1 ?? e2 ?? e3;
  return { accounts, statements: ((sts ?? []) as unknown as BankStatement[]).map(num), lines, selected, error: err ? `Bank statements could not be read: ${err.message}` : null };
}
