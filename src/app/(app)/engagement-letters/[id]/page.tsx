import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { QUOTE_STATUS, QUOTE_STATUS_CLASS, WAITING, type QuoteStatus } from "@/lib/quotes";
import { firmSignature } from "@/lib/t1-quote/server";
import { letterHtml, type LetterRow } from "@/lib/letters/server";
import { renderLetterEmail } from "@/lib/letters/email";
import { CopyButton } from "../../leads/[id]/quote/copy-button";
import { declineQuote } from "../../quotes/actions";
import { sendLetterEmailNow } from "../actions";
import { signingEmailOn } from "@/lib/email/signing";

type Signer = { person: number; first_name: string; last_name: string; email: string; token: string; signed_at: string | null; signed_title: string | null };

// A New letter sent for online signing (front office batch, section 7): the email to send from
// Outlook with the private link(s), where signing stands, the letter as the client reads it, and the
// signed PDF. Quotes and proposals open on their own pages.
export default async function LetterPage({ params, searchParams }: PageProps<"/engagement-letters/[id]">) {
  const access = await requireAccess("documents", "view");
  // Owners only (round 8 item 7), like the list.
  if (!access.is_owner) redirect("/?error=owners-only");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("id, kind, status, sent_at, valid_until, signed_at, sender, signer, wording, wording_label, company_name, title, details, lead_id").eq("id", id).maybeSingle();
  if (!q) notFound();
  if (q.kind === "proposal") redirect(`/quotes/${id}`);
  if (q.kind !== "letter") redirect(q.lead_id ? `/leads/${q.lead_id}/quote` : "/engagement-letters");
  const letter = q as unknown as LetterRow & { status: QuoteStatus; signed_at: string | null };
  const { data: s } = await supabase.from("quote_signers").select("person, first_name, last_name, email, token, signed_at, signed_title").eq("quote_id", id).order("person");
  const signers = (s ?? []) as Signer[];
  const html = letterHtml(letter, await firmSignature());
  const email = renderLetterEmail(letter.wording ?? {}, { names: signers.map((x) => x.first_name), validUntil: letter.valid_until ?? "" },
    letter.sender ?? { name: access.full_name, phone: "", email: "" }, signers.map((x) => `${env.siteUrl()}/q/${x.token}`));
  const to = [...new Set(signers.map((x) => x.email))].join("; ");
  const editable = canEdit(access, "documents");
  const details = letter.details as { label?: string; document_id?: string; version_id?: string; email?: { ok: boolean; at: string; from: string; to: string[]; skipped?: string[]; error?: string } } | null;
  const sending = await signingEmailOn("letters");
  const sent = details?.email;

  return (
    <>
      <Link href="/engagement-letters" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Engagement letters</Link>
      <PageHeader eyebrow={`New letter · ${details?.label ?? "Engagement letter"}`} title={letter.company_name ?? signers.map((x) => `${x.first_name} ${x.last_name}`).join(" and ")}
        description={`Sent for signing ${formatDateTime(letter.sent_at)} by ${letter.sender?.name ?? ""}. Sign by ${formatDate(letter.valid_until)}.${letter.wording_label ? ` Wording ${letter.wording_label}.` : ""}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="card grid content-start gap-4">
          <p className="text-sm">Status: <span className={`rounded px-2 py-0.5 text-xs font-semibold ${QUOTE_STATUS_CLASS[letter.status]}`}>{letter.status === "sent" || letter.status === "viewed" ? "Waiting for signature" : QUOTE_STATUS[letter.status]}</span></p>
          <h2 className="font-semibold">1. The email</h2>
          {sent && (sent.ok
            ? <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">Sent from {sent.from} to {sent.to.join(", ")}, {formatDateTime(sent.at)}.{sent.skipped?.length ? ` Not sent to ${sent.skipped.join(", ")} (Test app).` : ""}</p>
            : <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">Not sent, {formatDateTime(sent.at)}: {sent.error} Copy the email below and send it from Outlook.</p>)}
          {sending && editable && WAITING.includes(letter.status) && (
            <form action={sendLetterEmailNow}><input type="hidden" name="id" value={id} />
              <button type="submit" className="btn-secondary h-8 px-3 text-sm">{sent?.ok ? "Send the email again" : "Send the email now"}</button></form>
          )}
          <div className="text-sm"><p><span className="text-muted">To: </span>{to}</p><p><span className="text-muted">Subject: </span>{email.subject}</p></div>
          <div className="flex flex-wrap gap-2">
            <CopyButton label="Copy the email" html={email.html} text={email.text} />
            <CopyButton label="Copy the subject" text={email.subject} />
            <CopyButton label="Copy the address" text={to} />
          </div>
          <div className="rounded-lg border border-sand-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: email.html }} />
          <p className="text-xs text-muted">{sending ? "Studio sends it from your own mailbox; a copy is in your Sent folder. If sending fails, copy it and send it from Outlook." : "Send it from Outlook. Each person signs through their own link."}</p>
          <h2 className="font-semibold">2. Signing</h2>
          <ul className="grid gap-1 text-sm">{signers.map((x) => (
            <li key={x.person}>{x.first_name} {x.last_name}: {x.signed_at ? <span className="text-success">signed {formatDateTime(x.signed_at)}{x.signed_title ? `, ${x.signed_title}` : ""}</span> : <span className="text-muted">not signed yet</span>}</li>
          ))}</ul>
          {letter.status === "signed" && <a href={`/engagement-letters/${id}/pdf`} target="_blank" rel="noreferrer" className="btn-secondary w-fit">Open the signed PDF (with the signing record)</a>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/letter-preview/${id}`} className="text-navy-700 underline">Preview as client</Link>
            {details?.version_id && <a href={`/documents/file/${details.version_id}?download=1`} className="text-navy-700 underline">Download the issued PDF</a>}
            {details?.document_id && <Link href={`/engagement-letters/new?doc=${details.document_id}`} className="text-navy-700 underline">Open in the Letter Builder</Link>}
          </div>
          {editable && WAITING.includes(letter.status) && (
            <form action={declineQuote}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/engagement-letters/${id}`} />
              <button type="submit" className="text-sm text-danger underline">The client said no: mark declined</button>
            </form>
          )}
        </section>
        <section className="grid content-start gap-4">
          <h2 className="font-semibold">The letter (client&rsquo;s copy)</h2>
          <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-6 py-8 shadow-sm sm:px-12 sm:py-12" dangerouslySetInnerHTML={{ __html: html }} />
        </section>
      </div>
    </>
  );
}
