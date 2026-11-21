import { notFound } from "next/navigation";
import { canEdit, requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { staffNames } from "@/lib/closebook/server";
import { acctLabel, getBankAccounts, getBooks } from "../../data";
import { ReconcileView, type RecLine, type PastRec } from "./view";

// CB2-1 PR B part j: QBO's Reconcile. Choose the account, the statement ending date and balance; tick the cleared lines;
// the difference shows as you tick. Finish works with a difference (a warning) and the difference is recorded. Past
// reconciliations each have a report and an Undo.
export default async function ReconcilePage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess("closebook", "view");
  const { client } = await params;
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const cards = await getBankAccounts(client);
  const card = cards.find((c) => c.ident === sp.account) ?? cards[0] ?? null;
  const supabase = await createClient();
  const { data: recs } = card
    ? await supabase.from("cb_books_reconciliations").select("id, statement_date, beginning, ending, cleared, difference, lines, status, created_by, created_at, undone_at")
      .eq("cb_client_id", client).eq("ident", card.ident).order("statement_date", { ascending: false }).order("created_at", { ascending: false })
    : { data: [] };
  type R = { id: string; statement_date: string; beginning: number; ending: number; cleared: number; difference: number; lines: string[]; status: string; created_by: string | null; created_at: string; undone_at: string | null };
  const all = (recs ?? []) as R[];
  const finished = all.filter((r) => r.status === "finished");
  const done = new Set(finished.flatMap((r) => r.lines));
  // The first reconciliation starts from the account's opening balance in Books (QBO): everything before the first year.
  const first = b.books.years[0]?.yearStart ?? "9999-12-31";
  let open = 0;
  if (card) {
    for (const x of b.books.postings) if (x.ident === card.ident && x.date < first) open += x.cents;
    for (const g of b.books.generated) if (g.date < first) for (const l of g.lines) if (l.ident === card.ident) open += l.cents;
  }
  const opening = card?.kind === "card" ? -open : open;   // a card's balance owed is positive, like its charges
  const beginning = finished.length ? Math.round(Number(finished[0].ending) * 100) : opening;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  const lines: RecLine[] = [];
  let pending = 0;
  if (card && date) {
    const { data } = await supabase.from("cb_bank_lines").select("id, txn_date, description, amount, status, chart_account, is_split, transfer_account")
      .in("account_id", card.ids).lte("txn_date", date).neq("status", "excluded").order("txn_date").order("row_no").limit(50000);
    for (const l of (data ?? []) as { id: string; txn_date: string; description: string; amount: number; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null }[]) {
      if (done.has(l.id)) continue;
      const isPending = l.status === "new" || l.status === "ask_client" || (l.status === "reviewer" && !l.chart_account && !l.is_split && !l.transfer_account);
      if (isPending) { pending++; continue; }
      lines.push({ id: l.id, date: l.txn_date, description: l.description, cents: Math.round(l.amount * 100) });
    }
  }
  const names = await staffNames(supabase);
  const past: PastRec[] = all.map((r) => ({ id: r.id, date: r.statement_date, ending: Math.round(Number(r.ending) * 100), cleared: Math.round(Number(r.cleared) * 100),
    difference: Math.round(Number(r.difference) * 100), lines: r.lines.length, status: r.status as PastRec["status"], who: r.created_by ? names.get(r.created_by) ?? "" : "", at: r.created_at,
    latest: r.id === finished[0]?.id }));
  return <ReconcileView clientId={client} accounts={cards.map((c) => ({ value: c.ident, label: acctLabel({ number: c.ident, name: c.name }), kind: c.kind }))}
    ident={card?.ident ?? ""} date={date} ending={sp.ending ?? ""} beginning={beginning} opening={opening} lines={lines} pending={pending} past={past} canEdit={canEdit(access, "closebook")} />;
}
