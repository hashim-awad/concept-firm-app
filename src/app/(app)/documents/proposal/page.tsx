import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceHeader } from "@/components/studio/kit";
import { ProposalScreen } from "@/components/studio/proposal-screen";
import { corporations, openDocument, screenSetup } from "@/lib/studio/page-data";
import { formatDate, todayToronto } from "@/lib/dates";
import { saveClientAction, saveDocumentAction } from "../actions";

export default async function ProposalPage({ searchParams }: PageProps<"/documents/proposal">) {
  const access = await requireAccess("documents", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, env } = await screenSetup(supabase, access, "proposal");
  const open = await openDocument(supabase, typeof sp.doc === "string" ? sp.doc : undefined, "proposal");
  const today = todayToronto();
  const startClientId = typeof sp.client === "string" ? sp.client : undefined;
  const initial = open ? { f: open.inputs.f, opts: open.inputs.opts, rec: open.inputs.rec ?? 0, clientId: open.clientId, documentId: open.documentId } : undefined;
  // Approved GST/HST rate per province the screen offers (decision 22). OTHER never has one.
  const approvedTax: Record<string, string> = {};
  for (const pv of ["ON", "AB", "BC"]) {
    const { data: r } = await supabase.rpc("approved_tax_rate", { p_province: pv });
    const row = (r as { tax: string; rate_percent: number }[] | null)?.[0];
    if (row) approvedTax[pv] = `${Number(row.rate_percent)}% ${row.tax}`;
  }
  const { data: recent } = await supabase.from("proposals").select("id, title, date_sent, valid_until, status, chosen_option").order("date_sent", { ascending: false }).limit(12);
  const list = (recent ?? []).length ? (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Proposal</th><th>Sent</th><th>Valid until</th><th>Status</th><th>Option</th></tr></thead>
        <tbody>
          {(recent ?? []).map((r) => (
            <tr key={r.id}><td>{r.title}</td><td>{r.date_sent ? formatDate(r.date_sent) : ""}</td><td>{r.valid_until ? formatDate(r.valid_until) : ""}</td><td>{r.status}</td><td>{r.chosen_option}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[13px]"><Link href="/documents?tab=proposals" className="text-navy-700 underline">Mark results under Documents</Link></p>
    </div>
  ) : <p className="text-sm text-ink-3">No proposals recorded yet.</p>;
  return (
    <>
      <WorkspaceHeader title="Proposal" description="Up to three options. The client picks one, and it becomes the Corporate Letter." />
      <ProposalScreen env={env} clients={corporations(data.clients)} isOwner={access.is_owner} today={today} initial={initial} startClientId={startClientId} approvedTax={approvedTax} recent={list}
        handlers={{ saveDocument: saveDocumentAction, saveClient: saveClientAction }} />
    </>
  );
}
