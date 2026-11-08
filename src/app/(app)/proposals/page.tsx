import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { PageTabs } from "@/components/page-tabs";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { T1PricingScreen } from "@/components/studio/t1-pricing-screen";
import { screenSetup } from "@/lib/studio/page-data";
import { markProposal } from "../documents/history-actions";

// One page for every proposal: business proposals (Studio's proposal builder) and T1 instant
// quotes (Phase 2). The T1 pricing calculator lives here too.
const TYPES = [["all", "All types"], ["business", "Business proposal"], ["t1", "T1 instant quote"]] as const;
const STATUSES = ["Draft", "Sent", "Accepted", "Declined", "Expired"];

export default async function ProposalsPage({ searchParams }: PageProps<"/proposals">) {
  const access = await requireAccess("documents", "view");
  const sp = await searchParams;
  const editable = canEdit(access, "documents");
  const tab = sp.tab === "calculator" && editable ? "calculator" : "list";
  const type = TYPES.some(([k]) => k === sp.type) ? String(sp.type) : "all";
  const status = STATUSES.includes(String(sp.status)) ? String(sp.status) : "";
  const supabase = await createClient();

  const header = (
    <>
      <PageHeader title="Proposals" description="Business proposals and T1 instant quotes in one list. Sent proposals are waiting for the client's signature."
        actions={editable ? <Link href="/documents/proposal" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New business proposal</Link> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <PageTabs label="Proposals" current={tab} tabs={[
        { key: "list", href: "/proposals", label: "All proposals" },
        ...(editable ? [{ key: "calculator", href: "/proposals?tab=calculator", label: "T1 pricing calculator" }] : []),
      ]} />
    </>
  );

  if (tab === "calculator") {
    const { env } = await screenSetup(supabase, access, "letter");
    return (<>{header}<p className="mb-4 text-sm text-ink-2">Price a standalone personal tax return from the client&rsquo;s scope answers. Prices come from the Catalogue. One fee, charged once, before tax.</p><T1PricingScreen env={env} /></>);
  }

  // Business proposals are the only kind stored today; T1 instant quotes start with Phase 2.
  let rows: { id: string; title: string; date_sent: string | null; valid_until: string | null; status: string; chosen_option: string; options_data: unknown }[] = [];
  if (type !== "t1") {
    let q = supabase.from("proposals").select("id, title, date_sent, valid_until, status, chosen_option, options_data").order("date_sent", { ascending: false, nullsFirst: false }).limit(300);
    if (status) q = q.eq("status", status);
    rows = (await q).data ?? [];
  }
  const filterLink = (k: string, v: string) => {
    const p = new URLSearchParams();
    const t = k === "type" ? v : type, s = k === "status" ? v : status;
    if (t !== "all") p.set("type", t);
    if (s) p.set("status", s);
    return "/proposals" + (p.size ? "?" + p : "");
  };
  const chip = (href: string, on: boolean, text: string) => (
    <Link key={text} href={href} aria-current={on ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[13px] ${on ? "border-navy-700 bg-navy-700 text-white" : "border-sand-200 bg-surface text-ink-2 hover:border-navy-300"}`}>{text}</Link>
  );

  return (
    <>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filters">
        {TYPES.map(([k, l]) => chip(filterLink("type", k), type === k, l))}
        <span className="mx-1 h-5 w-px bg-sand-200" aria-hidden />
        {chip(filterLink("status", ""), !status, "Any status")}
        {STATUSES.map((s) => chip(filterLink("status", s), status === s, s === "Sent" ? "Awaiting signature" : s))}
      </div>
      <section className="card overflow-x-auto p-0">
        {type === "t1" ? <p className="p-5 text-sm text-muted">T1 instant quotes start with Phase 2 (public start page and screening). Until then, price a T1 with the T1 pricing calculator tab.</p>
          : rows.length === 0 ? <p className="p-5 text-sm text-muted">No proposals match.</p> : (
          <table className="table">
            <thead><tr><th>Proposal</th><th>Type</th><th>Sent</th><th>Valid until</th><th>Status</th><th>Option</th><th></th></tr></thead>
            <tbody>{rows.map((r) => {
              const opts = ((r.options_data as { o?: { n: string }[] } | null)?.o ?? []);
              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.title}</td>
                  <td><span className="rounded bg-navy-50 px-1.5 py-0.5 text-xs text-navy-800">Business proposal</span></td>
                  <td>{formatDate(r.date_sent)}</td><td>{formatDate(r.valid_until)}</td>
                  <td>{r.status === "Sent" ? "Awaiting signature" : r.status}</td><td>{r.chosen_option}</td>
                  <td className="text-right text-sm">
                    {editable && r.status === "Sent" && opts.length > 0 && (
                      <form action={markProposal} className="flex justify-end gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <select name="result" aria-label="Mark result" className="input h-8 w-auto text-sm" defaultValue="">
                          <option value="" disabled>Mark result</option>
                          {opts.map((o, i) => <option key={i} value={`acc:${i}`}>Accepted: {o.n}</option>)}
                          <option value="decl">Declined</option><option value="exp">Expired</option>
                        </select>
                        <button className="btn h-8 px-3 text-sm" type="submit">Save</button>
                      </form>
                    )}
                    {editable && r.status === "Accepted" && <Link href={`/engagement-letters?type=corporate&proposal=${r.id}`} className="text-navy-700 underline">Create Corporate Letter</Link>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
