import type { Metadata } from "next";
import { headers } from "next/headers";
import { ClientShell } from "@/components/ds/client";
import { clientCards, CqReadError, ERROR_TEXT, findLink, recordOpen, reportLinkError, type CqCard, type CqLink } from "@/lib/closebook/client-questions-server";
import { longDate } from "@/lib/closebook/questions";
import { QuestionsBoard } from "./questions-board";

// Never indexed (round 32, E).
export const metadata: Metadata = { title: "Questions about your transactions · Concept Accounting & Advisory", robots: { index: false, follow: false, nocache: true } };

// Round 32 (Hashim, Nov 18, 2026): the client answers our questions about their bank and card lines.
// Benchmark: TaxDome's client transactions page (screens 06 and 07). No code (firm decision, Nov 17, 2026): the link opens
// the questions directly, as DocuSign's default link does. Only the asked lines show: date, description, amount, account.
export default async function ClientQuestionsPage({ params }: PageProps<"/cq/[token]">) {
  const { token } = await params;
  // A database problem is never shown as "no longer active" (round 32 fix): it is recorded in History and the bell.
  let cq: CqLink | null, cards: CqCard[] = [];
  try {
    cq = await findLink(token);
    if (cq?.live) {
      cards = await clientCards(cq);
      // Every opening goes in History (date, time, device). It changes nothing about the link.
      await recordOpen(cq, (await headers()).get("user-agent") ?? "");
    }
  } catch (e) {
    if (!(e instanceof CqReadError)) throw e;
    await reportLinkError(token, e.message);
    return (
      <ClientShell>
        <div className="mx-auto max-w-xl text-center" data-cq-busy>
          <p className="text-lg text-ink">{ERROR_TEXT}</p>
        </div>
      </ClientShell>
    );
  }
  if (!cq || !cq.live) {
    return (
      <ClientShell>
        <div className="mx-auto max-w-xl text-center" data-cq-gone data-reason={cq?.reason ?? "not_found"}>
          <h1 className="text-2xl font-semibold tracking-tight">This link is no longer active.</h1>
          <p className="mt-3 text-ink-2">Contact Concept Accounting for a new one.</p>
        </div>
      </ClientShell>
    );
  }
  return (
    <ClientShell wide>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">Questions about your transactions</h1>
        <p className="mt-1 text-[17px] font-medium text-ink">{cq.legalName}</p>
        <p className="text-ink-2">Year ended {longDate(cq.yearEnd)}</p>
        {cq.link.reply_by && <p className="mt-2 inline-block rounded-lg bg-warning-soft px-3 py-1.5 text-sm font-medium text-warning">Please answer by {longDate(cq.link.reply_by)}.</p>}
      </header>
      <QuestionsBoard token={token} cards={cards} />
    </ClientShell>
  );
}
