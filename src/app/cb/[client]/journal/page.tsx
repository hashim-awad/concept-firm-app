import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { canEdit, requireAccess } from "@/lib/access";
import { formatDate } from "@/lib/dates";
import { bracketAmount } from "@/lib/closebook/amount";
import { getBooks, rangeOf } from "../../data";

// CB2-1 Part 3c: the journal entry list. Number, date, memo, total, Reclass tick, created from. Filter by date range;
// search. A row opens the entry's window. No row menus.
const FROM: Record<string, string> = { schedule: "Schedule", expenses_personal: "Schedule", opening_balances: "Opening balances", opening_difference: "Opening balances", tb_import: "Trial balance import" };

export default async function JournalList({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess("closebook", "view");
  const { client } = await params;
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const { from, to } = rangeOf(b, sp);
  const q = (sp.q ?? "").trim().toLowerCase();
  type Row = { id: string; href: string; no: string; date: string; memo: string; total: number; reclass: boolean; from: string };
  const rows: Row[] = [
    ...b.entries.map((e) => ({ id: e.id, href: `/cb/${client}/journal/${e.id}`, no: e.no, date: e.date, memo: e.note,
      total: Math.round(e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0) * 100), reclass: e.is_reclass ?? e.kind === "RJE", from: FROM[e.origin ?? ""] ?? "Typed" })),
    // Worked out from the stored figures until someone saves a change to them.
    ...b.books.generated.map((g) => ({ id: g.id, href: `/cb/${client}/journal/${encodeURIComponent(g.id)}`, no: "", date: g.date, memo: g.memo,
      total: g.lines.filter((l) => l.cents > 0).reduce((n, l) => n + l.cents, 0), reclass: false, from: FROM[g.origin] })),
  ].filter((r) => r.date >= from && r.date <= to && (!q || `${r.no} ${r.memo} ${bracketAmount(r.total)} ${r.date}`.toLowerCase().includes(q)))
    .sort((a, b2) => b2.date.localeCompare(a.date) || b2.no.localeCompare(a.no, "en", { numeric: true }));
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-[22px] font-bold">Journal entries</h1><span className="flex-1" />
        {canEdit(access, "closebook") && <Link href={`/cb/${client}/journal/new`} className="btn" data-je-new><Plus className="h-4 w-4" />New journal entry</Link>}</div>
      <form method="get" className="card flex flex-wrap items-end gap-3 p-3" data-je-filter>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-3">From<input type="date" name="from" defaultValue={from} className="input input-compact" /></label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-3">To<input type="date" name="to" defaultValue={to} className="input input-compact" /></label>
        <label className="grid min-w-[14rem] flex-1 gap-1 text-[12px] font-semibold text-ink-3">Search<input name="q" defaultValue={sp.q ?? ""} placeholder="Number, memo or amount" className="input input-compact" /></label>
        <button type="submit" className="btn btn-compact">Apply</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="table" data-je-list>
          <thead><tr><th>No.</th><th>Date</th><th>Memo</th><th className="text-right">Total</th><th className="text-center">Reclass</th><th>Created from</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-sand-50" data-je-row={r.no || r.id}>
              <td className="whitespace-nowrap"><Link href={r.href} className="font-semibold text-navy-700 hover:underline">{r.no || "–"}</Link></td>
              <td className="whitespace-nowrap"><Link href={r.href} className="block">{formatDate(r.date)}</Link></td>
              <td className="min-w-[16rem]"><Link href={r.href} className="block">{r.memo}</Link></td>
              <td className="text-right tabular-nums"><Link href={r.href} className="block">{bracketAmount(r.total)}</Link></td>
              <td className="text-center">{r.reclass && <Check className="mx-auto h-4 w-4 text-navy-700" aria-label="Reclass entry" />}</td>
              <td><Link href={r.href} className="block">{r.from}</Link></td>
            </tr>
          ))}
            {!rows.length && <tr><td colSpan={6} className="text-ink-3">No journal entry in this range.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
