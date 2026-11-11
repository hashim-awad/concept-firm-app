import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { QUOTE_STATUS, QUOTE_STATUS_CLASS, WAITING, type QuoteStatus } from "@/lib/quotes";
import { firmSignature } from "@/lib/t1-quote/server";
import { proposalView, type ProposalRow } from "@/lib/proposal/server";
import { renderProposalEmail } from "@/lib/proposal/email";
import { CopyButton } from "../../leads/[id]/quote/copy-button";
import { declineQuote } from "../actions";

// A sent proposal (front office batch, section 5): the email to send from Outlook with the private
// link, where signing stands, and the signed PDF. Personal tax and year-end quotes open on their lead.
export default async function QuotePage({ params, searchParams }: PageProps<"/quotes/[id]">) {
  const access = await requireAccess("leads", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!canView(access, "pricing")) redirect("/quotes?error=Quotes%20open%20for%20staff%20with%20the%20Pricing%20permission.");
  const editable = canEdit(access, "leads");
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("id, lead_id, kind, status, sent_at, valid_until, sender, signer, wording, wording_label, company_name, proposal, chosen_option, title, signed_at, tax_year, couple, lines, total_cents, year_end, details").eq("id", id).maybeSingle();
  if (!q) notFound();
  if (q.kind !== "proposal") redirect(q.lead_id ? `/leads/${q.lead_id}/quote` : "/quotes");
  if (q.status === "draft") redirect(`/quotes/proposal?quote=${id}`);
  const quote = q as unknown as ProposalRow & { status: QuoteStatus; signed_at: string | null; document_id?: string | null };
  // Recorded in the old Proposals list (before Quotes): what was recorded, and the PDF in the vault.
  if (!Array.isArray(quote.proposal?.opts)) {
    const legacy = ((q.proposal as { legacy?: Record<string, unknown> } | null)?.legacy ?? {}) as { prospect?: string; chosen?: string; summary?: string };
    const { data: doc } = await supabase.from("quotes").select("document_id").eq("id", id).maybeSingle();
    return (
      <>
        <Link href="/quotes?type=proposal" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Quotes</Link>
        <PageHeader eyebrow="Monthly proposal · recorded before Quotes" title={quote.title ?? legacy.prospect ?? "Proposal"} description={`Sent ${formatDate(quote.sent_at)}. Status: ${QUOTE_STATUS[quote.status]}.${legacy.chosen ? ` Option chosen: ${legacy.chosen}.` : ""}`} />
        <section className="card text-sm">
          <p>This proposal was issued as a PDF before proposals were signed online. {doc?.document_id ? <Link href={`/quotes/proposal?doc=${doc.document_id}`} className="text-navy-700 underline">Open it in the proposal builder</Link> : "Its PDF is in the document vault."}</p>
          {editable && WAITING.includes(quote.status) && (
            <form action={declineQuote} className="mt-3">
              <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/quotes/${id}`} />
              <button type="submit" className="text-sm text-danger underline">The client said no: mark declined</button>
            </form>
          )}
        </section>
      </>
    );
  }
  const { data: s } = await supabase.from("quote_signers").select("first_name, last_name, email, token, signed_at, signed_title").eq("quote_id", id);
  const signer = (s ?? [])[0] as { first_name: string; last_name: string; email: string; token: string; signed_at: string | null; signed_title: string | null } | undefined;
  const view = proposalView(quote, await firmSignature());
  const link = signer ? `${env.siteUrl()}/q/${signer.token}` : "";
  const email = renderProposalEmail(quote.wording ?? {}, { first: signer?.first_name ?? "", validUntil: quote.valid_until ?? "", options: view.options.length },
    quote.sender ?? { name: access.full_name, phone: "", email: "" }, link);
  const chosen = quote.chosen_option !== null ? view.options[quote.chosen_option] : null;

  return (
    <>
      <Link href="/quotes?type=proposal" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Quotes</Link>
      <PageHeader eyebrow={`Monthly proposal · ${view.options.length} option${view.options.length === 1 ? "" : "s"}`} title={quote.company_name ?? quote.title ?? "Proposal"}
        description={`Sent ${formatDateTime(quote.sent_at)} by ${quote.sender?.name ?? ""}. Valid until ${formatDate(quote.valid_until)}.${quote.wording_label ? ` Wording ${quote.wording_label}.` : ""}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="card grid content-start gap-4">
          <p className="text-sm">Status: <span className={`rounded px-2 py-0.5 text-xs font-semibold ${QUOTE_STATUS_CLASS[quote.status]}`}>{QUOTE_STATUS[quote.status]}</span></p>
          <h2 className="font-semibold">1. The email</h2>
          <div className="text-sm">
            <p><span className="text-muted">To: </span>{signer?.email}</p>
            <p><span className="text-muted">Subject: </span>{email.subject}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton label="Copy the email" html={email.html} text={email.text} />
            <CopyButton label="Copy the subject" text={email.subject} />
            <CopyButton label="Copy the address" text={signer?.email ?? ""} />
          </div>
          <div className="rounded-lg border border-sand-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: email.html }} />
          <p className="text-xs text-muted">Send it from Outlook. The link is the client&rsquo;s own: do not share it with anyone else.</p>
          <h2 className="font-semibold">2. Signing</h2>
          {quote.status === "signed" && chosen ? (
            <>
              <p className="text-sm">Signed {formatDateTime(signer?.signed_at ?? quote.signed_at)} by {signer?.first_name} {signer?.last_name}{signer?.signed_title ? `, ${signer.signed_title}` : ""}. Option chosen: <b>{chosen.name}</b>.</p>
              <a href={`/quotes/${id}/pdf`} target="_blank" rel="noreferrer" className="btn-secondary w-fit">Open the signed PDF (with the signing record)</a>
            </>
          ) : (
            <p className="text-sm text-muted">{quote.status === "viewed" ? "The client opened the proposal and has not signed yet." : quote.status === "sent" ? "Not opened yet." : QUOTE_STATUS[quote.status] + "."}</p>
          )}
          {editable && WAITING.includes(quote.status) && (
            <form action={declineQuote}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/quotes/${id}`} />
              <button type="submit" className="text-sm text-danger underline">The client said no: mark declined</button>
            </form>
          )}
        </section>
        <section className="grid content-start gap-4">
          <h2 className="font-semibold">The proposal (client&rsquo;s copy)</h2>
          <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-6 py-8 shadow-sm sm:px-12 sm:py-12" dangerouslySetInnerHTML={{ __html: view.partA }} />
          {view.options.map((o, i) => (
            <details key={i} open={quote.chosen_option === i} className="rounded-lg border border-sand-200 bg-white">
              <summary className="cursor-pointer px-5 py-3 font-medium">Engagement letter for {o.name}{quote.chosen_option === i ? " (signed)" : ""}</summary>
              <div className="px-6 pb-8 sm:px-12" dangerouslySetInnerHTML={{ __html: o.letter }} />
            </details>
          ))}
        </section>
      </div>
    </>
  );
}
