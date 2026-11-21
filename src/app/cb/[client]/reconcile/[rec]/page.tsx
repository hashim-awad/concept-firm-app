import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { staffNames } from "@/lib/closebook/server";
import { bracketAmount } from "@/lib/closebook/amount";
import { formatDate, formatDateTime } from "@/lib/dates";
import { isOut } from "@/lib/books/bank";
import { acctLabel, getBankAccounts, getBooks } from "../../../data";

// CB2-1 PR B part j: a reconciliation's report (QBO's Reconciliation report): the summary, the difference recorded, and the
// cleared lines.
const money = (c: number) => `$${bracketAmount(c)}`;
type Rec = { id: string; ident: string; statement_date: string; beginning: number; ending: number; cleared: number; difference: number; lines: string[]; status: string;
  created_by: string | null; created_at: string; undone_by: string | null; undone_at: string | null };

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-4 border-b border-sand-100 py-1.5"><span>{label}</span><span className={`tabular-nums ${strong ? "font-bold" : ""}`}>{value}</span></div>;
}

export default async function RecReport({ params }: { params: Promise<{ client: string; rec: string }> }) {
  await requireAccess("closebook", "view");
  const { client, rec } = await params;
  if (!/^[0-9a-f-]{36}$/.test(rec)) notFound();
  const b = await getBooks(client);
  if (!b) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cb_books_reconciliations").select("id, ident, statement_date, beginning, ending, cleared, difference, lines, status, created_by, created_at, undone_by, undone_at")
    .eq("id", rec).eq("cb_client_id", client).maybeSingle();
  const r = data as Rec | null;
  if (!r) notFound();
  const card = (await getBankAccounts(client)).find((c) => c.ident === r.ident);
  const kind = card?.kind ?? "bank";
  const { data: ls } = r.lines.length ? await supabase.from("cb_bank_lines").select("id, txn_date, description, amount").in("id", r.lines).order("txn_date") : { data: [] };
  const lines = ((ls ?? []) as { id: string; txn_date: string; description: string; amount: number }[]).map((l) => ({ ...l, cents: Math.round(l.amount * 100) }));
  const names = await staffNames(supabase);
  const c = (n: number) => Math.round(Number(n) * 100);
  const out = lines.filter((l) => isOut(kind, l.cents)), inn = lines.filter((l) => !isOut(kind, l.cents));
  const sum = (x: typeof lines) => x.reduce((n, l) => n + Math.abs(l.cents), 0);
  const outWord = kind === "card" ? "Charges" : "Payments", inWord = kind === "card" ? "Payments and credits" : "Deposits";
  return (
    <div className="mx-auto grid max-w-4xl gap-4" data-rec-report>
      <div><Link href={`/cb/${client}/reconcile?account=${encodeURIComponent(r.ident)}`} className="text-[13px] font-semibold text-navy-700 hover:underline">‹ Reconcile</Link></div>
      <div>
        <h1 className="text-[22px] font-bold">Reconciliation report</h1>
        <p className="text-[14px]">{b.client.name} · {acctLabel({ number: r.ident, name: card?.name ?? "" })} · Statement ending {formatDate(r.statement_date)}</p>
        <p className="text-[12px] text-ink-3">Reconciled {formatDateTime(r.created_at)}{r.created_by ? ` by ${names.get(r.created_by) ?? ""}` : ""}.
          {r.status === "undone" && ` Undone ${formatDateTime(r.undone_at)}${r.undone_by ? ` by ${names.get(r.undone_by) ?? ""}` : ""}.`}</p>
      </div>
      <div className="card p-4 text-[14px]">
        <Row label="Beginning balance" value={money(c(r.beginning))} />
        <Row label={`${outWord} cleared (${out.length})`} value={money(sum(out))} />
        <Row label={`${inWord} cleared (${inn.length})`} value={money(sum(inn))} />
        <Row label="Cleared balance" value={money(c(r.beginning) + c(r.cleared))} strong />
        <Row label="Statement ending balance" value={money(c(r.ending))} strong />
        <div className={`flex justify-between gap-4 py-1.5 ${c(r.difference) ? "font-bold text-danger" : ""}`} data-rec-report-diff><span>Difference</span><span className="tabular-nums">{money(c(r.difference))}</span></div>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead className="border-b border-sand-200 bg-sand-50 text-left text-[12px] text-ink-3"><tr><th className="px-3 py-2">Date</th><th className="px-2 py-2">Description</th>
            <th className="px-2 py-2 text-right">{outWord}</th><th className="px-2 py-2 text-right">{inWord}</th></tr></thead>
          <tbody>
            {!lines.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-3">No line was ticked as cleared.</td></tr>}
            {lines.map((l) => <tr key={l.id} className="border-b border-sand-100"><td className="whitespace-nowrap px-3 py-1.5">{formatDate(l.txn_date)}</td><td className="px-2 py-1.5">{l.description}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{isOut(kind, l.cents) ? money(Math.abs(l.cents)) : ""}</td><td className="px-2 py-1.5 text-right tabular-nums">{isOut(kind, l.cents) ? "" : money(Math.abs(l.cents))}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
