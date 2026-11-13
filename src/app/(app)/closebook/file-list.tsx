import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { fileBy, FILE_TYPE, firstName } from "@/lib/closebook/files";
import { fileSteps } from "@/lib/closebook/steps";
import { accountCoverage, missingText } from "@/lib/closebook/coverage";
import type { ListedFile } from "@/lib/closebook/server";

// The work queue table: client, year-end, file by, the step (of 9) with its bar, and the next job.
// Oldest deadline first. Clicking a file opens it on its current step (Nov 13, 2026).
export function FileList({ files, names, showPeople }: { files: ListedFile[]; names: Map<string, string>; showPeople?: boolean }) {
  const rows = [...files].sort((a, b) => fileBy(a.year_end).localeCompare(fileBy(b.year_end)));
  return (
    <section className="card overflow-x-auto p-0">
      <table className="table min-w-[900px]">
        <thead><tr><th>Client</th><th>Year-end</th><th>File by</th><th>Step</th><th>Next job</th>{showPeople && <th>Preparer / reviewer</th>}</tr></thead>
        <tbody>{rows.map((f) => {
          const people = { preparer: firstName(names.get(f.preparer_id) ?? ""), reviewer: firstName(names.get(f.reviewer_id) ?? "") };
          const accts = f.accts ?? [];
          // The list checks statement periods only (not the months without transactions), to stay light.
          const bankGaps = missingText((f.baccts ?? []).map((a) => ({ name: a.name,
            gaps: accountCoverage(f.year_start, f.year_end, (f.stmts ?? []).filter((x) => x.account_id === a.id).map((x) => ({ ...x, opening: Number(x.opening), closing: Number(x.closing) }))).gaps })));
          const { steps, current, next } = fileSteps({ bankGaps,
            books: f.books, docs: f.docs, statements: f.stmts?.length ?? 0, imported: (f.imps ?? []).some((i) => i.target === "this_year"), accounts: accts.length,
            unmatched: accts.filter((a) => !a.line_no && !a.needs_reviewer).length, waiting: accts.filter((a) => a.needs_reviewer).length, entries: f.ents?.length ?? 0, people,
          });
          const cur = steps.find((s) => s.key === current)!;
          return (
            <tr key={f.id}>
              <td><Link href={`/closebook/${f.id}`} className="font-medium text-navy-700 hover:underline">{f.client?.legal_name ?? "Client"}</Link>
                <span className="block text-xs text-muted">{FILE_TYPE[f.file_type]} file</span></td>
              <td className="tabular-nums whitespace-nowrap">{formatDate(f.year_end)}</td>
              <td className="tabular-nums whitespace-nowrap">{formatDate(fileBy(f.year_end))}</td>
              <td className="min-w-[180px]">
                <span className="block text-sm">{cur.n} of 9 · {cur.name}</span>
                <span className="mt-1.5 grid grid-cols-9 gap-0.5" aria-hidden>
                  {steps.map((s) => <span key={s.key} className={`h-1.5 rounded-full ${s.state === "done" ? "bg-success" : s.key === current ? "bg-navy-700" : "bg-sand-200"}`} />)}
                </span>
              </td>
              <td className="text-sm">{next.replace(/ You can start coding.*$/, "").replace(/\. You can start getting.*$/, "")}</td>
              {showPeople && <td className="whitespace-nowrap">{people.preparer} / {people.reviewer}</td>}
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}
