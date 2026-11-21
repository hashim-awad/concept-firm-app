import { notFound } from "next/navigation";
import { canEdit, requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { staffNames } from "@/lib/closebook/server";
import type { BooksRule } from "@/lib/books/bank";
import { getBankAccounts, getBooks } from "../../data";
import { loadPickers } from "../bank/load";
import { RulesView } from "./view";

// CB2-1 PR B part i: QBO's Rules. Name, applies to, conditions; then account, tax code, memo or a split by percentage;
// "Automatically confirm" (off by default). Each rule's ⋯ menu: Edit, Copy, Delete, History.
export default async function RulesPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess("closebook", "view");
  const { client } = await params;
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const cards = await getBankAccounts(client);
  const supabase = await createClient();
  const hid = sp.history && /^[0-9a-f-]{36}$/.test(sp.history) ? sp.history : null;
  const [pick, { data: rules }, hist] = await Promise.all([
    loadPickers(b, cards),
    supabase.from("cb_books_rules").select("id, name, priority, direction, accounts, match_all, conditions, chart_account, splits, tax_code, memo, auto_confirm, active").eq("cb_client_id", client).order("priority"),
    hid ? supabase.from("cb_books_history").select("id, action, detail, old_value, new_value, created_at, actor_id").eq("rule_id", hid).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
  ]);
  const names = hist.data ? await staffNames(supabase) : new Map<string, string>();
  return <RulesView clientId={client} rules={(rules ?? []) as BooksRule[]} {...pick} canEdit={canEdit(access, "closebook")} panel={sp.panel ?? null} historyFor={hid}
    history={((hist.data ?? []) as { id: string; action: string; detail: string; old_value: string | null; new_value: string | null; created_at: string; actor_id: string | null }[])
      .map((h) => ({ ...h, who: h.actor_id ? names.get(h.actor_id) ?? "" : "" }))} />;
}
