import type { Metadata } from "next";
import { ClientShell } from "@/components/ds/client";
import { FIRM } from "@/components/ds/brand";
import { todayToronto } from "@/lib/dates";
import { longDate, pieceText } from "@/lib/t1-quote/render";
import { C } from "@/lib/t1-quote/wording";
import { loadQuoteByToken } from "@/lib/t1-quote/server";
import { clientParts } from "@/lib/t1-quote/sign";
import { SignForm } from "./sign-form";

export const metadata: Metadata = { title: "Concept Accounting & Advisory", robots: { index: false, follow: false } };

const PORTAL = "https://portal.conceptaccounting.ca/en-us/signup";

// The client's quote and engagement letter, from their private link (batch sections 6, 7 and 9;
// Appendix A Part C). Never a watermark, never a line price.
export default async function ClientQuotePage({ params }: PageProps<"/q/[token]">) {
  const { token } = await params;
  const found = await loadQuoteByToken(token);
  const say = (title: string, text: string) => (
    <ClientShell><div className="mx-auto max-w-xl text-center"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-3 text-ink-2">{text}</p></div></ClientShell>
  );
  if (!found) return say("This link does not work", `Please check the link in your email, or call us at ${FIRM.phone}.`);
  const { quote, signers, me } = found;
  if (quote.status === "draft") return say("Your quote is almost ready", "Please try the link again in a few minutes.");
  const signed = quote.status === "signed";
  if (!signed && quote.valid_until && quote.valid_until < todayToronto()) {
    return say("This quote has expired", `It was valid until ${longDate(quote.valid_until)}. Please contact us at ${FIRM.phone} or ${FIRM.email} and we will send you a new one.`);
  }
  const texts = quote.wording ?? {};
  const parts = await clientParts(quote, signers);
  const other = signers.find((s) => s.person !== me.person);
  const labels = { fullName: pieceText(texts, C.fullName), typed: pieceText(texts, C.typed), agree: pieceText(texts, C.agree), sign: pieceText(texts, C.signButton) };

  // After signing: the download and the portal (section 9). Couples: only when both have signed.
  const done = signed && (
    <section className="card border-success/30 bg-success-soft">
      <h2 className="text-xl font-semibold">{pieceText(texts, C.signed, me.first_name)}</h2>
      <p className="mt-2 text-ink-2">{pieceText(texts, C.afterSign)}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href={`/q/${token}/pdf`} className="btn-secondary">{pieceText(texts, C.download)}</a>
        <a href={PORTAL} className="btn">{pieceText(texts, C.portal)}</a>
      </div>
    </section>
  );
  // One spouse signed, the other has not (section 7).
  const waiting = !signed && me.signed_at && other && !other.signed_at && (
    <section className="card grid gap-4">
      <p className="font-medium">{pieceText(texts, C.waiting, me.first_name, other.first_name)}</p>
      <details className="rounded-lg border border-sand-200 p-4">
        <summary className="cursor-pointer font-medium">{pieceText(texts, C.sameDevice, other.first_name)}</summary>
        <div className="mt-4"><SignForm token={token} forOther who={`${other.first_name} ${other.last_name}`} labels={labels} /></div>
      </details>
    </section>
  );

  return (
    <ClientShell>
      <div className="mx-auto grid max-w-3xl gap-6">
        {done}
        {parts.slice(0, 2).map((p) => <section key={p.label} className="card"><div dangerouslySetInnerHTML={{ __html: p.html }} /></section>)}
        <section className="card grid gap-4" id="sign">
          <div dangerouslySetInnerHTML={{ __html: parts[2].html }} />
          {signers.length > 1 && !signed && (
            <p className="text-sm text-ink-2">{signers.map((s) => `${s.first_name}: ${s.signed_at ? "signed" : "not signed yet"}`).join(" · ")}</p>
          )}
          {me.signed_at
            ? <p className="text-sm text-success">{`Signed by ${me.first_name}.`}</p>
            : <SignForm token={token} forOther={false} who={`${me.first_name} ${me.last_name}`} labels={labels} />}
        </section>
        {waiting}
      </div>
    </ClientShell>
  );
}
