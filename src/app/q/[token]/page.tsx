import type { Metadata } from "next";
import { ClientShell } from "@/components/ds/client";
import { FIRM } from "@/components/ds/brand";
import { todayToronto } from "@/lib/dates";
import { longDate, renderQuote } from "@/lib/t1-quote/render";
import { letterSigner, loadQuoteByToken, toQuoteData } from "@/lib/t1-quote/server";

export const metadata: Metadata = { title: "Concept Accounting & Advisory", robots: { index: false, follow: false } };

// The client's quote and engagement letter, opened from their private link (batch sections 6 and 7).
// Never a watermark, never a line price. Signing (Part C) is built in Phase 2 step 8.
export default async function ClientQuotePage({ params }: PageProps<"/q/[token]">) {
  const { token } = await params;
  const found = await loadQuoteByToken(token);
  const say = (title: string, text: string) => (
    <ClientShell><div className="mx-auto max-w-xl text-center"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-3 text-ink-2">{text}</p></div></ClientShell>
  );
  if (!found) return say("This link does not work", `Please check the link in your email, or call us at ${FIRM.phone}.`);
  const { quote, signers, me } = found;
  if (quote.status === "draft") return say("Your quote is almost ready", "Please try the link again in a few minutes.");
  if (quote.valid_until && quote.valid_until < todayToronto() && quote.status !== "signed") {
    return say("This quote has expired", `It was valid until ${longDate(quote.valid_until)}. Please contact us at ${FIRM.phone} or ${FIRM.email} and we will send you a new one.`);
  }
  const data = toQuoteData(quote, signers, { preparedBy: quote.sender?.name ?? "", signer: await letterSigner() });
  const parts = renderQuote(quote.wording ?? {}, data);
  return (
    <ClientShell>
      <div className="mx-auto grid max-w-3xl gap-6">
        {parts.map((p, i) => (
          <section key={p.label} className="card">
            <div dangerouslySetInnerHTML={{ __html: p.html }} />
            {i === 2 && <p className="mt-3 rounded-lg bg-sand-50 p-3 text-sm text-ink-2">Online signing for {me.first_name} opens here shortly. We will let you know when it is ready.</p>}
          </section>
        ))}
      </div>
    </ClientShell>
  );
}
