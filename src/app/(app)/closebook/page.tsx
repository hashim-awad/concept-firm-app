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
  const tile = (label: string, n: number) => (
    <div className="card py-4"><p className="text-sm text-ink-2">{label}</p><p className="text-2xl font-semibold tabular-nums">{n}</p></div>
  );
  return (
    <>
      <PageHeader title="My files" description="Your year-end files, oldest deadline first. Open a file and follow its Next line."
        actions={canEdit(access, "closebook") ? <Link href="/closebook/new" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New file</Link> : undefined} />
      {files.length === 0 ? (
        <section className="card"><EmptyState icon={<BookCheck />} title="No files for you yet" description="Files you prepare or review show here. Start one from All files, New file." /></section>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">{tile("Assigned to you", files.length)}{tile("Due in 30 days", due)}</div>
          <FileList files={files} names={names} />
        </>
      )}
    </>
  );
}
