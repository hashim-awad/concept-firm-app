// Round 32 (Hashim, Nov 18, 2026): the Reporting tab, as QuickBooks Online's Reports page: groups of reports, each with
// a one-line description, and a report opens full page with "‹ Reporting" at the top left.
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BarChart3, MessageCircleQuestion } from "lucide-react";
import { loadQuestions } from "@/lib/closebook/questions-server";
import { QuestionsReport } from "./questions-report";

const CLIENT: [string, string, string][] = [["questions", "Client questions", "Every transaction you asked the client about, from all accounts."]];
const FINANCIAL: [string, string, string][] = [
  ["tb", "Trial balance", "Every account's balance at year end, with last year beside it."],
  ["bs", "Balance sheet", "What the company owns and owes at year end."],
  ["pl", "Income statement", "Revenue and expenses for the year."],
  ["gl", "General ledger", "Every posting to every account."],
  ["journal", "Journal", "Every entry, in date order."],
  // Piece 8: read from the ledger; the reviewer answers its questions in step 7.
  ["sh", "Shareholder loans", "Each shareholder account's balance for the year and what is owed at year-end."],
];

// Round 35: a report opened from step 7 (an account's ledger) goes back to "‹ Review"; round 38: from step 7's
// lead sheets, to "‹ Lead sheets".
export function ReportingBack({ fileId, back }: { fileId: string; back?: string | null }) {
  const review = !!back && /[?&]step=review\b/.test(back);
  const lead = review && /[?&]view=lead\b/.test(back!);
  // Piece 8: a ledger opened from the Shareholder loans report goes back to it.
  const sh = !review && !!back && back.startsWith(`/closebook/${fileId}?`) && /[?&]report=sh\b/.test(back);
  return <Link href={review || sh ? back! : `/closebook/${fileId}?area=reporting`} className="mb-2 inline-block text-[12.5px] font-semibold text-navy-700 hover:underline" data-reporting-back>{lead ? "‹ Lead sheets" : review ? "‹ Review" : sh ? "‹ Shareholder loans" : "‹ Reporting"}</Link>;
}

export function ReportingList({ fileId }: { fileId: string }) {
  const group = (title: string, icon: React.ReactNode, rows: [string, string, string][]) => (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase">{icon}{title}</h2>
      <ul className="divide-y divide-sand-100 overflow-hidden rounded-[10px] border border-sand-200 bg-surface">
        {rows.map(([k, name, about]) => (
          <li key={k}>
            <Link href={`/closebook/${fileId}?area=reporting&report=${k}`} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-sand-50 sm:flex-row sm:items-baseline sm:gap-4" data-report-link={k}>
              <span className="w-56 shrink-0 text-[13.5px] font-semibold text-navy-700">{name}</span>
              <span className="text-[13px] text-ink-2">{about}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="max-w-4xl" data-reporting-list>
      <h1 className="mb-4 text-xl font-bold text-ink">Reporting</h1>
      {group("Client", <MessageCircleQuestion className="h-4 w-4" aria-hidden />, CLIENT)}
      {group("Financial", <BarChart3 className="h-4 w-4" aria-hidden />, FINANCIAL)}
    </div>
  );
}

export async function questionsReport({ supabase, fileId, editable, sp }: { supabase: SupabaseClient; fileId: string; editable: boolean; sp: { acct?: string; status?: string } }) {
  const q = await loadQuestions(supabase, fileId);
  if (!q) return <p className="text-sm text-ink-2">File not found.</p>;
  return <><ReportingBack fileId={fileId} /><QuestionsReport data={q} editable={editable && !q.locked} initialAccount={sp.acct ?? ""} initialStatus={sp.status ?? "open"} /></>;
}
