import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { CorporateLetterScreen } from "@/components/studio/corporate-letter-screen";
import { corporations, openDocument, screenSetup } from "@/lib/studio/page-data";
import { todayToronto } from "@/lib/dates";
import { saveClientAction, saveDocumentAction } from "../actions";

export default async function CorporateLetterPage({ searchParams }: PageProps<"/documents/corporate-letter">) {
  const access = await requireAccess("documents", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, env } = await screenSetup(supabase, access, "letter");
  const open = await openDocument(supabase, typeof sp.doc === "string" ? sp.doc : undefined, "corporate_letter");
  const today = todayToronto();
  // Reopening an issued letter makes a revised letter: dated today, replacing the one issued.
  const initial = open ? {
    f: open.lastMode === "final" ? { ...open.inputs.f, revOf: open.inputs.f.letterDate, letterDate: today, reviewed: false } : open.inputs.f,
    fees: open.inputs.fees ?? [], clientId: open.clientId, documentId: open.documentId,
  } : undefined;
  return (
    <>
      <PageHeader eyebrow="Documents" title="Corporate Letter" description="One letter per corporate client. Tick the services; each adds its own section." />
      <CorporateLetterScreen env={env} clients={corporations(data.clients)} isOwner={access.is_owner} today={today} initial={initial}
        handlers={{ saveDocument: saveDocumentAction, saveClient: saveClientAction }} />
    </>
  );
}
