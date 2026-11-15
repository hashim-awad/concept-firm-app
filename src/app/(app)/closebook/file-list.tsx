import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { dataSourceLabel, fileBy } from "@/lib/closebook/files";
import { fileSteps, SIGNED_STEPS, STEP_KEYS } from "@/lib/closebook/steps";
import { accountCoverage, missingText } from "@/lib/closebook/coverage";
import type { ListedFile } from "@/lib/closebook/server";

// The work queue table: client, year-end, file by, the step (of 10) with its bar, and the next job.
// Oldest deadline first. The Next line is its first sentence only (round 15); the full text is on hover.
const short = (s: string) => s.split(/(?<=\.)\s/)[0].replace(/\.$/, "");
// Clicking a file opens it on its current step (Nov 13, 2026).
// Round 16: My files shows the signed-in person's role on each file. With open review notes, the next
// action is the person's own: the preparer fixes a note, the reviewer clears one marked fixed.
export function FileList({ files, names, showPeople, me }: { files: ListedFile[]; names: Map<string, string>; showPeople?: boolean; me?: string }) {
  const rows = [...files].sort((a, b) => fileBy(a.year_end).localeCompare(fileBy(b.year_end)));
  return (
    <section className="card overflow-x-auto p-0">
      <table className="table table-compact min-w-[900px]">
        <thead><tr><th>Client</th><th>Year-end</th><th>File by</th>{me && <th>My role</th>}<th>Step</th><th>Next job</th>{showPeople && <th>Preparer / reviewer</th>}</tr></thead>
        <tbody>{rows.map((f) => {
          const people = { preparer: names.get(f.preparer_id) ?? "", reviewer: names.get(f.reviewer_id) ?? "" };
          const accts = f.accts ?? [];
          // The list checks statement periods only (not the months without transactions), to stay light.
          const bankGaps = missingText((f.baccts ?? []).map((a) => ({ name: a.name,
            gaps: accountCoverage(f.year_start, f.year_end, (f.stmts ?? []).filter((x) => x.account_id === a.id).map((x) => ({ ...x, opening: Number(x.opening), closing: Number(x.closing) }))).gaps })));
          const { steps, current, next } = fileSteps({ bankGaps,
            books: f.books, docs: f.docs, statements: f.stmts?.length ?? 0, imported: (f.imps ?? []).some((i) => i.target === "this_year"), accounts: accts.length,
            unmatched: accts.filter((a) => !a.line_no && !a.needs_reviewer).length, waiting: accts.filter((a) => a.needs_reviewer).length, entries: f.ents?.length ?? 0, people,
            signs: Object.fromEntries(SIGNED_STEPS.map((k) => { const x = f.signs?.find((y) => y.step === k);
              return [k, { prepared: !!x?.prepared_at, reviewed: !!x?.reviewed_at, notes: (f.rnotes ?? []).filter((n) => n.step === k && n.status !== "cleared").length }]; })),
          });
          const openNotes = (f.rnotes ?? []).filter((n) => n.status !== "cleared").length;
          const isPrep = me === f.preparer_id, isRev = me === f.reviewer_id;
          const role = isPrep && isRev ? "Preparer and reviewer" : isPrep ? "Preparer" : isRev ? "Reviewer" : "";
          const noteOf = (status: string) => (f.rnotes ?? []).find((n) => n.status === status);
          const stepNo = (k: string) => steps.find((x) => x.key === k)?.n;
          const toFix = isPrep ? noteOf("open") : undefined, toClear = isRev ? noteOf("fixed") : undefined;
          const nextJob = toFix ? `Fix the review note on step ${stepNo(toFix.step)}` : toClear ? `Clear the review note on step ${stepNo(toClear.step)}` : short(next);
          const cur = steps.find((s) => s.key === current)!;
          return (
            <tr key={f.id}>
              <td><Link href={`/closebook/${f.id}`} className="font-medium text-navy-700 hover:underline">{f.client?.legal_name ?? "Client"}</Link>
                <span className="block text-[11px] text-ink-3">{dataSourceLabel(f)}</span></td>
              <td className="tabular-nums whitespace-nowrap">{formatDate(f.year_end)}</td>
              <td className="tabular-nums whitespace-nowrap">{formatDate(fileBy(f.year_end))}</td>
              {me && <td><span className="rounded bg-navy-50 px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-navy-700">{role}</span></td>}
              <td className="min-w-[180px]">
                <span className="block text-sm">{cur.n} of {STEP_KEYS.length} · {cur.name}</span>
                <span className="mt-1.5 grid grid-cols-10 gap-0.5" aria-hidden>
                  {steps.map((s) => <span key={s.key} className={`h-1.5 rounded-full ${s.state === "done" ? "bg-success" : s.key === current ? "bg-navy-700" : "bg-sand-200"}`} />)}
                </span>
              </td>
              <td className="max-w-[320px] truncate text-sm" title={next}>{nextJob}
                {openNotes > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-xs font-semibold text-white" title="Review notes open">{openNotes}<span className="sr-only"> review notes open</span></span>}</td>
              {showPeople && <td className="whitespace-nowrap">{people.preparer} / {people.reviewer}</td>}
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}
