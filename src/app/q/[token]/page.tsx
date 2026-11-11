import type { Metadata } from "next";
import { ClientShell } from "@/components/ds/client";
import { FIRM } from "@/components/ds/brand";
import { todayToronto } from "@/lib/dates";
import { longDate, pieceText } from "@/lib/t1-quote/render";
import { C, CORP } from "@/lib/t1-quote/wording";
import { loadQuoteByToken } from "@/lib/t1-quote/server";
import { clientParts } from "@/lib/t1-quote/sign";
import { SignForm } from "./sign-form";
import { SignDock } from "./sign-dock";

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
  const labels = { fullName: pieceText(texts, C.fullName), typed: pieceText(texts, C.typed), agree: pieceText(texts, C.agree), sign: pieceText(texts, C.signButton),
    ...(quote.kind === "corporate" ? { title: pieceText(texts, CORP.signerTitle) } : {}) };

  const download = { href: `/q/${token}/pdf`, label: pieceText(texts, C.download) };
  const portal = { href: PORTAL, label: pieceText(texts, C.portal), primary: true };

  // The panel: sign, wait for the spouse, or done (download and portal). Couples: done only when both signed.
  let panel: React.ReactNode, bar: { text: string; button?: string; links?: typeof download[] };
  if (signed) {
    panel = (
      <div className="grid gap-4">
        <h2 className="text-xl font-semibold">{pieceText(texts, C.signed, me.first_name)}</h2>
        <p className="text-ink-2">{pieceText(texts, C.afterSign)}</p>
        <div className="grid gap-2">
          <a href={portal.href} className="btn">{portal.label}</a>
          <a href={download.href} className="btn-secondary">{download.label}</a>
        </div>
      </div>
    );
    bar = { text: "Signed", links: [download, portal] };
  } else if (me.signed_at) {
    // One spouse signed, the other has not (section 7).
    panel = (
      <div className="grid gap-4">
        <p className="font-medium">{other ? pieceText(texts, C.waiting, me.first_name, other.first_name) : `Signed by ${me.first_name}.`}</p>
        {other && !other.signed_at && (
          <details className="rounded-lg border border-sand-200 p-4">
            <summary className="cursor-pointer font-medium">{pieceText(texts, C.sameDevice, other.first_name)}</summary>
            <div className="mt-4"><SignForm token={token} forOther who={`${other.first_name} ${other.last_name}`} labels={labels} /></div>
          </details>
        )}
      </div>
    );
    bar = { text: other ? `Waiting for ${other.first_name}` : "Signed", button: "Open" };
  } else {
    panel = (
      <div className="grid gap-4">
        <div className="[&_h2]:mt-0" dangerouslySetInnerHTML={{ __html: parts[2].html }} />
        {signers.length > 1 && <p className="text-sm text-ink-2">{signers.map((s) => `${s.first_name}: ${s.signed_at ? "signed" : "not signed yet"}`).join(" · ")}</p>}
        <SignForm token={token} forOther={false} who={`${me.first_name} ${me.last_name}`} labels={labels} />
      </div>
    );
    bar = { text: "Ready to sign?", button: pieceText(texts, C.signButton) };
  }

  return (
    <ClientShell wide>
      {/* Phone: room at the bottom for the sign bar. Computer: the letter and the sign panel side by side. */}
      <div className="mx-auto grid max-w-6xl gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:pb-0">
        {/* The quote and the terms as one letter page, on the firm's letterhead. */}
        <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-5 py-7 shadow-sm sm:px-12 sm:py-12">
          <div dangerouslySetInnerHTML={{ __html: parts[0].html }} />
          <hr className="my-8 border-sand-200" />
          <div dangerouslySetInnerHTML={{ __html: parts[1].html }} />
        </article>
        <SignDock barText={bar.text} barButton={bar.button} barLinks={bar.links}>{panel}</SignDock>
      </div>
    </ClientShell>
  );
}
