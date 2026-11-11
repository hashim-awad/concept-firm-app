import Link from "next/link";
import { FolderOpen, FilePlus2 } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadFileList, staffNames } from "@/lib/closebook/server";
import { FileList } from "../file-list";

// Closebook, All files: every year-end file in the firm, with New file (batch section 1).
export default async function AllFilesPage({ searchParams }: PageProps<"/closebook/files">) {
  const access = await requireAccess("closebook", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  const [files, names] = await Promise.all([loadFileList(supabase), staffNames(supabase)]);
  return (
    <>
      <PageHeader title="All files" description="Every year-end file in the firm: who has it, what is next, and the deadline."
        actions={canEdit(access, "closebook") ? <Link href="/closebook/new" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New file</Link> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {files.length === 0
        ? <section className="card"><EmptyState icon={<FolderOpen />} title="No files yet" description="Start the first one with New file." /></section>
        : <FileList files={files} names={names} showPeople />}
    </>
  );
}
