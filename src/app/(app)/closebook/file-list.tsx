import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { currentPhase, fileBy, FILE_TYPE, firstName, nextLine, PHASE_NAME, progress } from "@/lib/closebook/files";
import type { ListedFile } from "@/lib/closebook/server";

// The work queue table (mockup Main): client, file type, year-end, file by, phase, next. Oldest
// deadline first.
export function FileList({ files, names, showPeople }: { files: ListedFile[]; names: Map<string, string>; showPeople?: boolean }) {
  const rows = [...files].sort((a, b) => fileBy(a.year_end).localeCompare(fileBy(b.year_end)));
  return (
    <section className="card overflow-x-auto p-0">
      <table className="table min-w-[860px]">
        <thead><tr><th>Client</th><th>File type</th><th>Year-end</th><th>File by</th><th>Phase</th><th>Next</th>{showPeople && <th>Preparer / reviewer</th>}</tr></thead>
        <tbody>{rows.map((f) => {
          const phase = currentPhase(f.docs);
          const p = phase === "locked" ? null : progress(f.docs, phase);
          const people = { preparer: firstName(names.get(f.preparer_id) ?? ""), reviewer: firstName(names.get(f.reviewer_id) ?? "") };
          return (
            <tr key={f.id}>
              <td><Link href={`/closebook/${f.id}`} className="font-medium text-navy-700 hover:underline">{f.client?.legal_name ?? "Client"}</Link></td>
              <td>{FILE_TYPE[f.file_type]}</td>
              <td className="tabular-nums">{formatDate(f.year_end)}</td>
              <td className="tabular-nums">{formatDate(fileBy(f.year_end))}</td>
              <td>{PHASE_NAME[phase]}{p ? ` ${p.signed}/${p.total}` : ""}</td>
              <td>{(() => { const t = nextLine(f.docs, people).text.replace(/^Next: /, ""); return t.charAt(0).toUpperCase() + t.slice(1); })()}</td>
              {showPeople && <td>{people.preparer} / {people.reviewer}</td>}
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}
