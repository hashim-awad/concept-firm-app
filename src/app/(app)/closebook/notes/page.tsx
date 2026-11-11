import { MessageSquareWarning } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { PageHeader, EmptyState } from "@/components/ds/primitives";

// Closebook, Review notes: every open note across the firm's files (build step 3).
export default async function ReviewNotesPage() {
  await requireAccess("closebook", "view");
  return (
    <>
      <PageHeader title="Review notes" description="Every open review note, by file and document." />
      <section className="card"><EmptyState icon={<MessageSquareWarning />} title="No review notes" description="Notes appear here when a reviewer adds one to a document in a file." /></section>
    </>
  );
}
