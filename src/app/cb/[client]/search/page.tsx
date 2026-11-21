import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { bracketAmount, parseAmount } from "@/lib/closebook/amount";
import { acctLabel, getBooks } from "../../data";
import { txnOf } from "../reports/compute";

// CB2-1 Part 2.5: QBO's search. Finds transactions by amount, date, description, account number or name, and entry number.
// One click opens the result.
const isoOf = (q: string): string | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  if (!/[a-z]/i.test(q) || !/\d/.test(q)) return null;
  const d = new Date(`${q} 12:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export default async function SearchPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ q?: string }> }) {
  const { client } = await params;
  const { q: raw = "" } = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const q = raw.trim();
  const t = q.toLowerCase();
  const cents = q && /\d/.test(q) ? parseAmount(q) : null;
  const iso = q ? isoOf(q) : null;
  type Hit = { ref: string; date: string; type: string; no: string; text: string; href: string; amount: number; accounts: Set<string> };
  const hits = new Map<string, Hit>();
  if (q) {
    const byRef = new Map<string, typeof b.books.postings>();
    for (const p of b.books.postings) if (p.ref) byRef.set(p.ref, [...(byRef.get(p.ref) ?? []), p]);
    for (const [ref, ps] of byRef) {
      const tx = txnOf(b, ps[0]);
      if (!tx) continue;
      const names = ps.map((p) => { const a = b.byIdent.get(p.ident); return a ? acctLabel(a) : p.ident.replace(/^name:/, ""); });
      const text = `${tx.no} ${tx.text} ${ps[0].label} ${names.join(" ")}`.toLowerCase();
      const match = text.includes(t) || (cents !== null && cents !== 0 && ps.some((p) => Math.abs(p.cents) === Math.abs(cents))) || (iso !== null && ps[0].date === iso);
      if (!match) continue;
      const total = ps.filter((p) => p.cents > 0).reduce((n, p) => n + p.cents, 0);
      hits.set(ref, { ref, date: ps[0].date, type: tx.type, no: tx.no, text: tx.text || ps[0].label, href: tx.href, amount: total, accounts: new Set(names) });
    }
  }
  const list = [...hits.values()].sort((a, c) => c.date.localeCompare(a.date)).slice(0, 200);
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <h1 className="text-[22px] font-bold">Search</h1>
      <form method="get" className="flex gap-2"><label className="relative w-full max-w-lg"><span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input name="q" defaultValue={q} autoFocus placeholder="Amount, date, description, account or entry number" className="input w-full pl-8" data-search-input /></label>
        <button type="submit" className="btn">Search</button></form>
      {q && <p className="text-[13px] text-ink-3">{hits.size} result{hits.size === 1 ? "" : "s"}{hits.size > 200 ? " (the first 200)" : ""}</p>}
      {list.length > 0 && <div className="card overflow-x-auto p-0"><table className="table" data-search-results>
        <thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Description</th><th>Accounts</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{list.map((h) => (
          <tr key={h.ref} className="hover:bg-sand-50" data-search-hit>
            <td className="whitespace-nowrap"><Link href={`${h.href}?back=${encodeURIComponent(`/cb/${client}/search?q=${encodeURIComponent(q)}`)}`} className="text-navy-700 hover:underline">{formatDate(h.date)}</Link></td>
            <td>{h.type}</td><td>{h.no}</td>
            <td className="min-w-[14rem]"><Link href={`${h.href}?back=${encodeURIComponent(`/cb/${client}/search?q=${encodeURIComponent(q)}`)}`} className="hover:underline">{h.text}</Link></td>
            <td className="text-[12.5px] text-ink-2">{[...h.accounts].join(", ")}</td><td className="text-right tabular-nums">{bracketAmount(h.amount)}</td>
          </tr>))}</tbody></table></div>}
    </div>
  );
}
