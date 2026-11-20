import Link from "next/link";
import { LinkSelect } from "@/components/link-select";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { NewMenu } from "../clients/[id]/new-menu";
import { EmptyCell } from "@/components/empty-cell";
import { QUOTE_KIND, QUOTE_STATUS, QUOTE_STATUS_CLASS, quoteTotal, type QuoteKind, type QuoteStatus } from "@/lib/quotes";

type Row = { id: string; kind: QuoteKind; status: QuoteStatus; client: string; client_id: string | null; lead_id: string | null; source: string; total_cents: number | null;
  options: number; sent_at: string | null; valid_until: string | null; signed_at: string | null; document_id: string | null };

const TYPES: [string, string][] = [["all", "All types"], ...(Object.entries(QUOTE_KIND) as [string, string][])];
const STATUSES = Object.keys(QUOTE_STATUS) as QuoteStatus[];

// Quotes (front office batch, section 3; mockup 2-Quotes): every offer in one list, from draft to
// signed. Totals only for staff with Pricing; clients see one total, never line prices.
export default async function QuotesPage({ searchParams }: PageProps<"/quotes">) {
  const access = await requireAccess("leads", "view");
  const sp = await searchParams;
  const type = TYPES.some(([k]) => k === sp.type) ? String(sp.type) : "all";
  const status = STATUSES.includes(sp.status as QuoteStatus) ? (sp.status as QuoteStatus) : "";
  const source = typeof sp.source === "string" ? sp.source : "";
  const supabase = await createClient();
  await supabase.rpc("expire_quotes");
  const { data, error } = await supabase.rpc("quote_list");
  const all = (data ?? []) as Row[];
  // UI1 (front office): filter by where the quote came from, as the leads list does.
  const sources = [...new Set(all.map((r) => r.source).filter(Boolean))].sort();
  const rows = all.filter((r) => (type === "all" || r.kind === type) && (!status || r.status === status) && (!source || r.source === source));
  const pricing = canView(access, "pricing");
  const canPropose = canEdit(access, "documents") && pricing;
  // Round 19: "New quote" offers the three kinds, each only to people who may make it (same rules as "+ New").
  const newQuote = [
    ...(canEdit(access, "leads") ? [{ label: QUOTE_KIND.t1, href: "/leads/phone?form=personal" }, { label: QUOTE_KIND.corporate, href: "/leads/phone?form=company" }] : []),
    ...(canPropose ? [{ label: QUOTE_KIND.proposal, href: "/quotes/proposal" }] : []),
  ];

  const link = (k: "type" | "status" | "source", v: string) => {
    const p = new URLSearchParams();
    const t = k === "type" ? v : type, s = k === "status" ? v : status, o = k === "source" ? v : source;
    if (t !== "all") p.set("type", t);
    if (s) p.set("status", s);
    if (o) p.set("source", o);
    return "/quotes" + (p.size ? "?" + p : "");
  };
  const chip = (href: string, on: boolean, text: string) => (
    <Link key={text} href={href} aria-current={on ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[13px] ${on ? "border-navy-700 bg-navy-700 text-white" : "border-sand-200 bg-surface text-ink-2 hover:border-navy-300"}`}>{text}</Link>
  );
  const open = (r: Row) => r.kind === "proposal" ? (r.status === "draft" ? `/quotes/proposal?quote=${r.id}` : r.document_id && !r.sent_at ? `/quotes/proposal?doc=${r.document_id}` : `/quotes/${r.id}`) : r.lead_id ? `/leads/${r.lead_id}/quote` : "/quotes";
  const typeLabel = (r: Row) => QUOTE_KIND[r.kind];
  // Q7: a monthly quote has its fee in each option; the list says how many options it holds.
  const amount = (r: Row) => r.kind === "proposal" ? (r.options > 0 ? `${r.options} option${r.options === 1 ? "" : "s"}` : <EmptyCell />) : r.total_cents === null ? <EmptyCell /> : quoteTotal(r.total_cents);

  return (
    <>
      <PageHeader title="Quotes" description="Every quote in one list: T1, year-end and monthly quotes, from draft to signed."
        actions={newQuote.length ? <NewMenu label="New quote" items={newQuote} /> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error) ?? (error ? error.message : undefined)} />
      <div className="mb-2 flex flex-wrap items-center gap-2" aria-label="Type">{TYPES.map(([k, l]) => chip(link("type", k), type === k, l))}</div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkSelect label="Status" value={status} options={[{ value: "", label: "Any status", href: link("status", "") }, ...STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS[s], href: link("status", s) }))]} />
        {sources.length > 1 && <LinkSelect label="Source" value={source} options={[{ value: "", label: "Any source", href: link("source", "") }, ...sources.map((s) => ({ value: s, label: s, href: link("source", s) }))]} />}
      </div>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No quotes match.</p> : (
          <table className="table">
            <thead><tr><th>Client</th><th>Type</th><th>Source</th>{pricing && <th className="text-right">Amount</th>}<th>Sent</th><th>Expires</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={open(r)} className="font-medium text-navy-700 hover:underline">{r.client}</Link></td>
                <td>{typeLabel(r)}</td>
                <td>{r.source}</td>
                {pricing && <td className="text-right tabular-nums">{amount(r)}</td>}
                <td className="whitespace-nowrap">{r.sent_at ? formatDate(r.sent_at) : <EmptyCell label="Not sent" />}</td>
                <td className="whitespace-nowrap">{r.valid_until && r.status !== "signed" && r.status !== "declined" ? formatDate(r.valid_until) : <EmptyCell />}</td>
                <td><span className={`px-2 py-0.5 text-xs font-medium whitespace-nowrap ${QUOTE_STATUS_CLASS[r.status]}`}>{QUOTE_STATUS[r.status]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      <p className="mt-2 text-xs text-muted">{pricing ? "Amounts are before tax. Monthly quotes show their fee in each option. Clients see one total, never line prices." : "Amounts show only to staff with the Pricing permission."} A quote expires 21 days after it is sent.</p>
    </>
  );
}
