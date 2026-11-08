import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { T1LetterScreen } from "@/components/studio/t1-letter-screen";
import { individuals, openDocument, screenSetup } from "@/lib/studio/page-data";
import { todayToronto } from "@/lib/dates";
import { saveClientAction, saveDocumentAction } from "../actions";

export default async function T1LetterPage({ searchParams }: PageProps<"/documents/t1-letter">) {
  const access = await requireAccess("documents", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, env } = await screenSetup(supabase, access, "letter");
  const open = await openDocument(supabase, typeof sp.doc === "string" ? sp.doc : undefined, "t1_letter");
  const today = todayToronto();
  const startClientId = typeof sp.client === "string" ? sp.client : undefined;
  const initial = open ? {
    f: open.lastMode === "final" ? { ...open.inputs.f, letterDate: today, reviewed: false } : open.inputs.f, clientId: open.clientId, documentId: open.documentId,
  } : undefined;
  return (
    <>
      <PageHeader eyebrow="Documents" title="Personal Tax Letter (T1)" description="Personal tax engagement letters for individuals and families." />
      <T1LetterScreen env={env} clients={individuals(data.clients)} isOwner={access.is_owner} today={today} initial={initial} startClientId={startClientId}
        handlers={{ saveDocument: saveDocumentAction, saveClient: saveClientAction }} />
    </>
  );
}
