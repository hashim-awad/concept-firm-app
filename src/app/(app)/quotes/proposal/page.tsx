import { redirect } from "next/navigation";
import { requireAccessWithPricing } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceHeader } from "@/components/studio/kit";
import { ProposalScreen } from "@/components/studio/proposal-screen";
import { corporations, openDocument, screenSetup } from "@/lib/studio/page-data";
import { todayToronto } from "@/lib/dates";
import { saveClientAction, saveDocumentAction } from "../../documents/actions";
import { proposalPrefill, type LeadForProposal } from "@/lib/corporate/suggest";
import { deleteProposalAction, saveProposalAction, sendProposalAction } from "./actions";

export default async function ProposalPage({ searchParams }: PageProps<"/quotes/proposal">) {
  const access = await requireAccessWithPricing("documents", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, env } = await screenSetup(supabase, access, "proposal");
  const open = await openDocument(supabase, typeof sp.doc === "string" ? sp.doc : undefined, "proposal");
  // A proposal in Quotes (front office batch): a saved draft reopens here; a sent one opens its quote page.
  const quoteId = typeof sp.quote === "string" && /^[0-9a-f-]{36}$/.test(sp.quote) ? sp.quote : undefined;
  let saved: { f: Record<string, string>; opts: unknown[]; rec: number; clientId?: string; leadId?: string } | undefined;
  if (quoteId) {
    const { data: q } = await supabase.from("quotes").select("id, kind, status, proposal, client_id, lead_id").eq("id", quoteId).maybeSingle();
    if (!q || q.kind !== "proposal") redirect("/quotes?error=Proposal%20not%20found.");
    if (q.status !== "draft") redirect(`/quotes/${quoteId}`);
    const p = (q.proposal ?? {}) as { f?: Record<string, string>; opts?: unknown[]; rec?: number };
    if (p.f && Array.isArray(p.opts)) saved = { f: p.f, opts: p.opts, rec: p.rec ?? 0, clientId: q.client_id ?? undefined, leadId: q.lead_id ?? undefined };
  }
  const leadId = saved?.leadId ?? (typeof sp.lead === "string" && /^[0-9a-f-]{36}$/.test(sp.lead) ? sp.lead : undefined);
  const today = todayToronto();
  const startClientId = typeof sp.client === "string" ? sp.client : undefined;
  // From a monthly company lead (section 12): the draft starts with the lead's details and answers.
  let prefill: ReturnType<typeof proposalPrefill> | undefined;
  if (!open && !saved && typeof sp.lead === "string" && /^[0-9a-f-]{36}$/.test(sp.lead)) {
    const { data: l } = await supabase.from("leads").select("first_name, last_name, email, province, company_name, client_kind, answers").eq("id", sp.lead).eq("route", "company").maybeSingle();
    if (l) prefill = proposalPrefill(l as LeadForProposal, env.floors as Parameters<typeof proposalPrefill>[1]);
  }
  const initial = saved ? { f: saved.f, opts: saved.opts, rec: saved.rec, clientId: saved.clientId }
    : open ? { f: open.inputs.f, opts: open.inputs.opts, rec: open.inputs.rec ?? 0, clientId: open.clientId, documentId: open.documentId } : undefined;
  // Approved GST/HST rate per province the screen offers (decision 22). OTHER never has one.
  const approvedTax: Record<string, string> = {};
  for (const pv of ["ON", "AB", "BC"]) {
    const { data: r } = await supabase.rpc("approved_tax_rate", { p_province: pv });
    const row = (r as { tax: string; rate_percent: number }[] | null)?.[0];
    if (row) approvedTax[pv] = `${Number(row.rate_percent)}% ${row.tax}`;
  }
  return (
    <>
      <WorkspaceHeader title="Proposal" description="Up to three options. It saves as a draft in Quotes. The client picks an option and signs its engagement letter online." />
      {prefill && (
        <div className="mb-4 rounded-lg border border-navy-200 bg-navy-50 p-4 text-sm">
          <p className="font-medium">Filled in from the lead. Check every field before you send.</p>
          <p className="mt-1 text-ink-2">Email: {prefill.email}. {prefill.suggestion ? `Suggested package: ${prefill.suggestion.label} (${prefill.suggestion.why}).` : "No package suggestion: Hashim sets the price."}
            {prefill.suggestion && !prefill.offer && " No single price book offer matched it, so choose the offer yourself."} The &ldquo;What we heard&rdquo; lines are the client&rsquo;s answers: rewrite them after the call.</p>
        </div>
      )}
      <ProposalScreen env={env} prefill={prefill ? { f: prefill.f, offer: prefill.offer } : undefined} clients={corporations(data.clients)} isOwner={access.is_owner} today={today} initial={initial} startClientId={startClientId} approvedTax={approvedTax} live={{ quoteId, leadId, save: saveProposalAction, send: sendProposalAction, remove: deleteProposalAction }}
        handlers={{ saveDocument: saveDocumentAction, saveClient: saveClientAction }} />
    </>
  );
}
