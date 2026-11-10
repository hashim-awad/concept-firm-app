import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { requireAccessWithPricing, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime, todayToronto } from "@/lib/dates";
import { env } from "@/lib/env";
import { renderEmail, renderQuote } from "@/lib/t1-quote/render";
import { letterSigner, loadQuoteForStaff, toQuoteData } from "@/lib/t1-quote/server";
import { markQuoteSent } from "../../quote-actions";
import { CopyButton } from "./copy-button";

// The T1 quote for a lead (batch sections 6 to 8): the email to send from Outlook, then Mark as sent.
// Unsent quotes show DRAFT FOR REVIEW; the client's copy never does.
export default async function QuotePage({ params, searchParams }: PageProps<"/leads/[id]/quote">) {
  const access = await requireAccessWithPricing("leads", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const loaded = await loadQuoteForStaff(supabase, id);
  if (!loaded) redirect(`/leads/${id}`);
  const { quote, signers } = loaded;
  const editable = canEdit(access, "pricing") && canEdit(access, "leads");
  const sent = quote.status !== "draft";

  const [{ data: me }, { data: cw }, signer] = await Promise.all([
    supabase.from("staff").select("full_name, phone, email").eq("id", access.staff_id).maybeSingle(),
    supabase.rpc("current_wording"),
    letterSigner(),
  ]);
  // A sent quote keeps the wording and signer it was sent with; a draft uses today's published wording.
  const texts = sent ? (quote.wording ?? {}) : (((cw as { texts?: Record<string, string> } | null)?.texts) ?? {});
  const sender = quote.sender ?? { name: me?.full_name ?? access.full_name, phone: me?.phone ?? "", email: me?.email ?? "" };
  const data = toQuoteData(quote, signers, { preparedBy: sender.name, signer });
  const links = signers.map((s) => `${env.siteUrl()}/q/${s.token}`);
  const email = renderEmail(texts, data, sender, links);
  const parts = renderQuote(texts, data, { watermark: !sent });
  const expired = sent && quote.valid_until !== null && quote.valid_until < todayToronto();

  return (
    <>
      <Link href={`/leads/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Back to the lead</Link>
      <PageHeader eyebrow={`T1 quote · ${quote.tax_year}`} title={signers.map((s) => `${s.first_name} ${s.last_name}`).join(" and ")}
        description={sent ? `Sent ${formatDateTime(quote.sent_at)} by ${quote.sender?.name ?? ""}. Valid until ${formatDate(quote.valid_until)}.${expired ? " Expired." : ""}${quote.wording_label ? ` Wording ${quote.wording_label}.` : ""}` : "Not sent yet. Copy the email below, send it from your Outlook, then click Mark as sent."} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="card grid content-start gap-4">
          <h2 className="font-semibold">1. The email</h2>
          <div className="text-sm">
            <p><span className="text-muted">To: </span>{signers.map((s) => s.email).join("; ")}</p>
            <p><span className="text-muted">Subject: </span>{email.subject}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton label="Copy the email" html={email.html} text={email.text} />
            <CopyButton label="Copy the subject" text={email.subject} />
            <CopyButton label="Copy the address" text={signers.map((s) => s.email).join("; ")} />
          </div>
          <div className="rounded-lg border border-sand-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: email.html }} />
          <h2 className="font-semibold">2. Mark as sent</h2>
          {sent ? (
            <p className="text-sm">Marked as sent {formatDateTime(quote.sent_at)}. {signers.map((s) => `${s.first_name}: ${s.signed_at ? `signed ${formatDateTime(s.signed_at)}` : "not signed yet"}`).join(". ")}.</p>
          ) : editable ? (
            <form action={markQuoteSent} className="grid gap-2 text-sm">
              <input type="hidden" name="lead_id" value={id} /><input type="hidden" name="quote_id" value={quote.id} />
              <p className="text-muted">Click once the email is sent. The quote is then valid for 21 days, its links open for the client, and the lead shows Quote sent. The email above already shows that date.</p>
              <button type="submit" className="btn w-fit">Mark as sent</button>
            </form>
          ) : <p className="text-sm text-muted">Someone with Edit on Pricing and Leads marks it as sent.</p>}
          <p className="text-xs text-muted">Each person signs through their own private link. Do not forward one person&rsquo;s link to the other. Online signing is the next build step.</p>
        </section>

        <section className="grid content-start gap-4">
          <h2 className="font-semibold">The quote and engagement letter{sent ? " (client's copy)" : ""}</h2>
          {parts.map((p) => (
            <div key={p.label} className="card overflow-hidden">
              <p className="mb-3 text-xs font-semibold tracking-wide text-ink-3 uppercase">{p.label}</p>
              <div dangerouslySetInnerHTML={{ __html: p.html }} />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
