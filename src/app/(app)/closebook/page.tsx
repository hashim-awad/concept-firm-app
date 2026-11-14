import Link from "next/link";
import { BookCheck, FilePlus2 } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, buttonClass } from "@/components/ds/primitives";
import { loadFileList, staffNames } from "@/lib/closebook/server";
import { fileBy } from "@/lib/closebook/files";
import { todayToronto } from "@/lib/dates";
import { FileList } from "./file-list";

// Closebook, My files (Phase 3 batch, section 2; mockup Main): the signed-in person's files, oldest
// deadline first, with each file's "Next:" line.
export default async function MyFilesPage() {
  const access = await requireAccess("closebook", "view");
  const supabase = await createClient();
  const [files, names] = await Promise.all([loadFileList(supabase, access.staff_id), staffNames(supabase)]);
  const today = todayToronto();
  const in30 = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
  const due = files.filter((f) => fileBy(f.year_end) <= in30).length;
  const chip = (label: string, n: number, tone: string) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}><span className="tabular-nums">{n}</span>{label}</span>
  );
  return (
    <>
      <PageHeader title="My files"
        actions={canEdit(access, "closebook") ? <Link href="/closebook/new" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New file</Link> : undefined} />
      {files.length === 0 ? (
        <section className="card"><EmptyState icon={<BookCheck />} title="No files for you yet" /></section>
      ) : (
        <>
          <div className="mb-3 flex gap-2">{chip("Assigned", files.length, "bg-sand-100 text-ink-2")}{chip("Due in 30 days", due, due ? "bg-warning/15 text-warning" : "bg-sand-100 text-ink-2")}</div>
          <FileList files={files} names={names} />
        </>
      )}
    </>
  );
}
