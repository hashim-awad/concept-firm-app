import { requireAccessWithPricing } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceHeader } from "@/components/studio/kit";
import { CorporateLetterScreen } from "@/components/studio/corporate-letter-screen";
import { corporations, openDocument, screenSetup } from "@/lib/studio/page-data";
import { todayToronto } from "@/lib/dates";
import { saveClientAction, saveDocumentAction } from "../actions";

export default async function CorporateLetterPage({ searchParams }: PageProps<"/documents/corporate-letter">) {
  const access = await requireAccessWithPricing("documents", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, env } = await screenSetup(supabase, access, "letter");
  const open = await openDocument(supabase, typeof sp.doc === "string" ? sp.doc : undefined, "corporate_letter");
  const today = todayToronto();
  const startClientId = typeof sp.client === "string" ? sp.client : undefined;
  // Reopening an issued letter makes a revised letter: dated today, replacing the one issued.
  const initial = open ? {
    f: open.lastMode === "final" ? { ...open.inputs.f, revOf: open.inputs.f.letterDate, letterDate: today, reviewed: false } : open.inputs.f,
    fees: open.inputs.fees ?? [], clientId: open.clientId, documentId: open.documentId,
  } : undefined;
  // From an accepted proposal (Studio pToLetter).
  let proposalPick: { option: unknown; prospect: unknown } | undefined;
  let fromProposalClient: string | undefined;
  if (!initial && typeof sp.proposal === "string" && /^[0-9a-f-]{36}$/.test(sp.proposal)) {
    const { data: p } = await supabase.from("proposals").select("options_data, chosen_option, client_id").eq("id", sp.proposal).maybeSingle();
    const od = p?.options_data as { c: unknown; o: { n: string }[] } | null;
    if (od?.o?.length) {
      proposalPick = { option: od.o.find((x) => x.n === p!.chosen_option) ?? od.o[0], prospect: od.c };
      fromProposalClient = p!.client_id ?? undefined;
    }
  }
  return (
    <>
      <WorkspaceHeader title="Corporate Letter" description="One letter per corporate client. Tick the services; each adds its own section." />
      <CorporateLetterScreen env={env} clients={corporations(data.clients)} isOwner={access.is_owner} today={today} initial={initial} startClientId={fromProposalClient ?? startClientId} proposalPick={proposalPick as never}
        handlers={{ saveDocument: saveDocumentAction, saveClient: saveClientAction }} />
    </>
  );
}
