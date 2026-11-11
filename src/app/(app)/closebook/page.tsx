import { BookCheck } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { PageHeader, EmptyState } from "@/components/ds/primitives";

// Closebook, My files (Phase 3 batch, section 1): the signed-in person's year-end files, oldest
// deadline first, with each file's "Next:" line. Files arrive with build step 1, part 2.
export default async function MyFilesPage() {
  await requireAccess("closebook", "view");
  return (
    <>
      <PageHeader title="My files" description="Your year-end files, oldest deadline first, with what to do next." />
      <section className="card"><EmptyState icon={<BookCheck />} title="No files yet" description="Year-end files start from All files, New file. That step is being built next." /></section>
    </>
  );
}
