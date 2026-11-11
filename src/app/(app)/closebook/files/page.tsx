import { FolderOpen } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { PageHeader, EmptyState } from "@/components/ds/primitives";

// Closebook, All files: every year-end file in the firm. New file arrives with build step 1, part 2.
export default async function AllFilesPage() {
  await requireAccess("closebook", "view");
  return (
    <>
      <PageHeader title="All files" description="Every year-end file in the firm: who has it, what is next, and the deadline." />
      <section className="card"><EmptyState icon={<FolderOpen />} title="No files yet" description="New file (pick the client, confirm the year-end, choose the file type, assign the preparer and reviewer) is being built next." /></section>
    </>
  );
}
