import { QUOTE_STATUS, QUOTE_STATUS_CLASS, WAITING } from "@/lib/quotes";
import { declineQuote } from "../../../quotes/actions";
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
import { LETTERHEAD_URL, money, renderEmail, renderQuote } from "@/lib/t1-quote/render";
import { provinceName } from "@/lib/leads/provinces";
import { letterSigner, loadQuoteForStaff, toCorpData, toQuoteData, firmSignature } from "@/lib/t1-quote/server";
import { depositAndBalance, renderCorpEmail, renderCorpQuote } from "@/lib/corporate/render";
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

  const [{ data: me }, { data: cw }, signer, { data: lead }] = await Promise.all([
    supabase.from("staff").select("full_name, phone, email").eq("id", access.staff_id).maybeSingle(),
    supabase.rpc("current_wording"),
    letterSigner(),
    supabase.from("leads").select("province").eq("id", id).maybeSingle(),
  ]);
  const province = lead?.province ?? "";
  const { data: taxRows } = await supabase.rpc("t1_invoice_tax", { p_province: province });
  const tax = ((taxRows ?? []) as { tax: string; rate_percent: number }[])[0];
  const signedAll = quote.status === "signed";
  const invoiceLine = `PTX-100 Personal tax return services, ${quote.tax_year}`;
  // A sent quote keeps the wording and signer it was sent with; a draft uses today's published wording.
  const texts = sent ? (quote.wording ?? {}) : (((cw as { texts?: Record<string, string> } | null)?.texts) ?? {});
  const sender = quote.sender ?? { name: me?.full_name ?? access.full_name, phone: me?.phone ?? "", email: me?.email ?? "" };
  const corp = quote.kind === "corporate";
  const data = toQuoteData(quote, signers, { preparedBy: sender.name, signer });
  const corpData = corp ? toCorpData(quote, signers, { preparedBy: sender.name, signer }) : null;
  const split = depositAndBalance(quote.total_cents);
  const links = signers.map((s) => `${env.siteUrl()}/q/${s.token}`);
  const email = corpData ? renderCorpEmail(texts, corpData, sender, links[0]) : renderEmail(texts, data, sender, links);
  const look = { watermark: !sent, letterhead: LETTERHEAD_URL, signature: await firmSignature() };
  const parts = corpData ? renderCorpQuote(texts, corpData, look) : renderQuote(texts, data, look);
  const expired = sent && quote.valid_until !== null && quote.valid_until < todayToronto();

  return (
    <>
      <Link href={`/leads/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Back to the lead</Link>
      <PageHeader eyebrow={corp ? `Year-end quote · ${quote.company_name ?? ""}` : `T1 quote · ${quote.tax_year}`} title={signers.map((s) => `${s.first_name} ${s.last_name}`).join(" and ")}
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
            <div className="grid gap-2 text-sm">
              <p>Marked as sent {formatDateTime(quote.sent_at)}. <span className={`ml-1 rounded px-2 py-0.5 text-xs font-semibold ${QUOTE_STATUS_CLASS[quote.status]}`}>{QUOTE_STATUS[quote.status]}</span></p>
              {editable && WAITING.includes(quote.status) && (
                <form action={declineQuote}>
                  <input type="hidden" name="id" value={quote.id} /><input type="hidden" name="back" value={`/leads/${id}/quote`} />
                  <button type="submit" className="text-sm text-danger underline">The client said no: mark declined</button>
                </form>
              )}
            </div>
          ) : editable ? (
            <form action={markQuoteSent} className="grid gap-2 text-sm">
              <input type="hidden" name="lead_id" value={id} /><input type="hidden" name="quote_id" value={quote.id} />
              <p className="text-muted">Click once the email is sent. The quote is then valid for 21 days, its links open for the client, and the lead shows Quote sent. The email above already shows that date.</p>
              <button type="submit" className="btn w-fit">Mark as sent</button>
            </form>
          ) : <p className="text-sm text-muted">Someone with Edit on Pricing and Leads marks it as sent.</p>}
          <p className="text-xs text-muted">Each person signs through their own private link. Do not forward one person&rsquo;s link to the other.</p>

          <h2 className="font-semibold">3. Signing</h2>
          <ul className="grid gap-1 text-sm">
            {signers.map((s) => (
              <li key={s.person}>{s.first_name} {s.last_name}: {s.signed_at ? <span className="text-success">signed {formatDateTime(s.signed_at)}</span> : <span className="text-muted">not signed yet</span>}</li>
            ))}
          </ul>
          {signedAll ? (
            <>
              <a href={`/leads/${id}/quote/pdf`} target="_blank" rel="noreferrer" className="btn-secondary w-fit">Open the signed PDF (with the signing record)</a>
              {corp ? (
                <>
                  <h2 className="font-semibold">4. TaxDome invoices (section 11: half after signing, half at your approval)</h2>
                  <div className="rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">
                    <p><span className="text-muted">Deposit, now: </span>{money(split.deposit)} plus {tax ? `${tax.tax} ${Number(tax.rate_percent)}%` : "GST/HST"}</p>
                    <p><span className="text-muted">Balance, when the client approves the statements and return: </span>{money(split.balance)} plus {tax ? `${tax.tax} ${Number(tax.rate_percent)}%` : "GST/HST"}</p>
                    <p className="text-xs text-muted">Quote total before tax: {money(quote.total_cents)}. Use the year-end items in TaxDome; the total is split in two.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton label="Copy the deposit" text={(split.deposit / 100).toFixed(2)} />
                    <CopyButton label="Copy the balance" text={(split.balance / 100).toFixed(2)} />
                  </div>
                  <p className="text-sm"><b>First year with Concept:</b> add the TaxDome tag <code>1st-yr client</code> when the account is created, then tick it on the lead.</p>
                </>
              ) : (<>
              <h2 className="font-semibold">4. TaxDome invoice (after the organizer and documents are in)</h2>
              <div className="rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">
                <p><span className="text-muted">Item: </span>{invoiceLine}</p>
                <p><span className="text-muted">Amount: </span>{money(quote.total_cents)} (the quote total before tax)</p>
                <p><span className="text-muted">Tax: </span>{tax ? `${tax.tax} ${Number(tax.rate_percent)}% (${provinceName(province)})` : <span className="text-warning">No approved GST/HST rate for {provinceName(province) || "this province"}. Check Settings, GST/HST rates.</span>}</p>
              </div>
              <CopyButton label="Copy the invoice line" text={`${invoiceLine}\t${(quote.total_cents / 100).toFixed(2)}${tax ? `\t${tax.tax} ${Number(tax.rate_percent)}%` : ""}`} />
              </>)}
            </>
          ) : sent && <p className="text-xs text-muted">The quote counts as signed when everyone has signed. Then the signed PDF and the TaxDome invoice line show here.</p>}
        </section>

        <section className="grid content-start gap-4">
          <h2 className="font-semibold">The quote and engagement letter{sent ? " (client's copy)" : ""}</h2>
          {/* One letter page, as the client reads it. */}
          <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-6 py-8 shadow-sm sm:px-12 sm:py-12">
            <div dangerouslySetInnerHTML={{ __html: parts[0].html }} />
            <hr className="my-8 border-sand-200" />
            <div dangerouslySetInnerHTML={{ __html: parts[1].html }} />
            <hr className="my-8 border-sand-200" />
            <div dangerouslySetInnerHTML={{ __html: parts[2].html }} />
          </article>
        </section>
      </div>
    </>
  );
}
