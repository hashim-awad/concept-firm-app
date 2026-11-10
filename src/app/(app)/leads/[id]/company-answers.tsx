// A company lead's answers for staff (batch sections 10 and 12): every answer, the routing, and the
// staff-only flags. Pure presentation; the lead page passes the stored answers.
import { BOOKS, COUNTS, FLAGS, MONTHS, NEED, PEOPLE, REVENUE, UPTODATE, type CorpAnswers } from "@/lib/corporate/quote";

type Stored = Partial<CorpAnswers> & { partial?: boolean; route?: "auto" | "call"; call_reasons?: string[] };

export function CompanyAnswers({ answers, yearEnd }: { answers: Stored; yearEnd: string | null }) {
  if (answers.partial) return <p className="mt-4 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">The client gave their details and stopped before the questions. Follow up by email.</p>;
  if (answers.form !== "corporate-v1") return <p className="mt-4 text-sm text-muted">No answers.</p>;
  const a = answers as CorpAnswers & Stored;
  const rows: [string, string][] = [
    ["What do you need?", NEED[a.need]],
    ["Do you also need any of these?", [a.extras.gst && "GST/HST return", a.extras.slips && "Tax slips for people the company paid"].filter(Boolean).join(", ") || "None"],
    ["How are your company's books kept today?", BOOKS[a.books]],
    ...(a.books === "statements" ? COUNTS.map(([k, label]) => [label, String(a.counts[k])] as [string, string]) : []),
    ["When does your company's year end?", a.ye ? `${MONTHS[a.ye.month - 1]} ${a.ye.day}` : "I'm not sure"],
    ["What does your company do?", a.business],
    ["Do any of these apply?", FLAGS.filter(([k]) => a.flags[k]).map(([, l]) => l).join("; ") || "None"],
    ...(a.monthly ? [
      ["Roughly how much does the company earn in a year, before expenses?", REVENUE[a.monthly.revenue]],
      ["How many people does the company pay?", PEOPLE[a.monthly.people]],
      ["Are your books up to date today?", UPTODATE[a.monthly.uptodate]],
    ] as [string, string][] : []),
  ];
  return (
    <div className="mt-4 grid gap-3">
      <ul className="grid gap-1 rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">
        <li><b>First year with Concept.</b> Add the TaxDome tag <code>1st-yr client</code> when the account is created.</li>
        <li><b>Business type:</b> {a.business}. Set the TaxDome tags to match (for example PREC or RE Team for real estate).</li>
        {!a.ye && <li className="text-warning"><b>Year-end not known.</b> Confirm it with the client and enter it on this lead before the quote goes out.</li>}
        {a.ye && !yearEnd && <li><b>Year-end:</b> confirm {MONTHS[a.ye.month - 1]} {a.ye.day} and enter it on this lead.</li>}
        {a.route === "call" && <li className="text-warning"><b>Needs a call:</b> {(a.call_reasons ?? []).join("; ")}.</li>}
      </ul>
      <dl className="grid gap-2 text-sm">{rows.map(([q, v]) => <div key={q}><dt className="text-muted">{q}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}
