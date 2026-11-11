import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { QUOTE_KIND, QUOTE_STATUS, QUOTE_STATUS_CLASS, quoteTotal, type QuoteKind, type QuoteStatus } from "@/lib/quotes";

type Row = { id: string; kind: QuoteKind; status: QuoteStatus; client: string; client_id: string | null; lead_id: string | null; source: string; total_cents: number | null;
  options: number; sent_at: string | null; valid_until: string | null; signed_at: string | null; document_id: string | null };

const TYPES: [string, string][] = [["all", "All types"], ["t1", "Personal tax"], ["corporate", "Company year-end"], ["proposal", "Monthly proposal"]];
const STATUSES = Object.keys(QUOTE_STATUS) as QuoteStatus[];

// Quotes (front office batch, section 3; mockup 2-Quotes): every offer in one list, from draft to
// signed. Totals only for staff with Pricing; clients see one total, never line prices.
export default async function QuotesPage({ searchParams }: PageProps<"/quotes">) {
  const access = await requireAccess("leads", "view");
  const sp = await searchParams;
  const type = TYPES.some(([k]) => k === sp.type) ? String(sp.type) : "all";
  const status = STATUSES.includes(sp.status as QuoteStatus) ? (sp.status as QuoteStatus) : "";
  const supabase = await createClient();
  await supabase.rpc("expire_quotes");
  const { data, error } = await supabase.rpc("quote_list");
  const all = (data ?? []) as Row[];
  const rows = all.filter((r) => (type === "all" || r.kind === type) && (!status || r.status === status));
  const pricing = canView(access, "pricing");
  const canPropose = canEdit(access, "documents") && pricing;

  const link = (k: "type" | "status", v: string) => {
    const p = new URLSearchParams();
    const t = k === "type" ? v : type, s = k === "status" ? v : status;
    if (t !== "all") p.set("type", t);
    if (s) p.set("status", s);
    return "/quotes" + (p.size ? "?" + p : "");
  };
  const chip = (href: string, on: boolean, text: string) => (
    <Link key={text} href={href} aria-current={on ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[13px] ${on ? "border-navy-700 bg-navy-700 text-white" : "border-sand-200 bg-surface text-ink-2 hover:border-navy-300"}`}>{text}</Link>
  );
  const open = (r: Row) => r.kind === "proposal" ? (r.document_id ? `/quotes/proposal?doc=${r.document_id}` : `/quotes/proposal?quote=${r.id}`) : r.lead_id ? `/leads/${r.lead_id}/quote` : "/quotes";
  const typeLabel = (r: Row) => r.kind === "proposal" && r.options > 1 ? `${QUOTE_KIND.proposal} (${r.options} options)` : QUOTE_KIND[r.kind];

  return (
    <>
      <PageHeader title="Quotes" description="Every quote in one list: personal tax, company year-end and monthly proposals, from draft to signed."
        actions={canPropose ? <Link href="/quotes/proposal" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New proposal</Link> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error) ?? (error ? error.message : undefined)} />
      <div className="mb-2 flex flex-wrap items-center gap-2" aria-label="Type">{TYPES.map(([k, l]) => chip(link("type", k), type === k, l))}</div>
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Status">
        {chip(link("status", ""), !status, "Any status")}
        {STATUSES.map((s) => chip(link("status", s), status === s, QUOTE_STATUS[s]))}
      </div>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No quotes match.</p> : (
          <table className="table">
            <thead><tr><th>Client</th><th>Type</th><th>Source</th>{pricing && <th className="text-right">Total</th>}<th>Sent</th><th>Expires</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={open(r)} className="font-medium text-navy-700 hover:underline">{r.client}</Link></td>
                <td>{typeLabel(r)}</td>
                <td>{r.source}</td>
                {pricing && <td className="text-right tabular-nums whitespace-nowrap">{r.kind === "proposal" ? <span className="text-ink-3">In the proposal</span> : quoteTotal(r.total_cents)}</td>}
                <td className="whitespace-nowrap">{r.sent_at ? formatDate(r.sent_at) : ""}</td>
                <td className="whitespace-nowrap">{r.valid_until && r.status !== "signed" && r.status !== "declined" ? formatDate(r.valid_until) : ""}</td>
                <td><span className={`rounded px-2 py-0.5 text-xs font-semibold ${QUOTE_STATUS_CLASS[r.status]}`}>{QUOTE_STATUS[r.status]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      <p className="mt-2 text-xs text-muted">{pricing ? "Totals are before tax. Clients see one total, never line prices." : "Totals show only to staff with the Pricing permission."} A quote expires 21 days after it is sent.</p>
    </>
  );
}
