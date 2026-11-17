import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClientShell } from "@/components/ds/client";
import { clientCards, cookieName, findLink, sessionOk } from "@/lib/closebook/client-questions-server";
import { longDate } from "@/lib/closebook/questions";
import { CodeScreen } from "./code-screen";
import { QuestionsBoard } from "./questions-board";

// Never indexed (round 32, E).
export const metadata: Metadata = { title: "Questions about your transactions · Concept Accounting & Advisory", robots: { index: false, follow: false, nocache: true } };

// Round 32 (Hashim, Nov 18, 2026): the client answers our questions about their bank and card lines.
// Benchmark: TaxDome's client transactions page (screens 06 and 07), with a 6-digit code instead of a portal login.
export default async function ClientQuestionsPage({ params }: PageProps<"/cq/[token]">) {
  const { token } = await params;
  const cq = await findLink(token);
  if (!cq || !cq.live) {
    return (
      <ClientShell>
        <div className="mx-auto max-w-xl text-center" data-cq-gone>
          <h1 className="text-2xl font-semibold tracking-tight">This link is no longer active.</h1>
          <p className="mt-3 text-ink-2">Contact Concept Accounting for a new one.</p>
        </div>
      </ClientShell>
    );
  }
  const email = await sessionOk(cq.link.id, (await cookies()).get(cookieName(cq.link.id))?.value);
  if (!email) return <ClientShell><CodeScreen token={token} masked={cq.masked} /></ClientShell>;
  const cards = await clientCards(cq);
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
