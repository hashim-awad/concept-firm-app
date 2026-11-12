import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadStudioData } from "@/lib/studio/data";
import { allTemplates, templateKeys } from "@/lib/studio/samples";
import { PIECE, toFriendly } from "@/lib/studio/wording-pieces";
import { changedKeys, loadWordingState } from "@/lib/studio/wording-state";
import { discardChanges, publishChanges } from "../actions";
import { UndoButton } from "./undo-button";

type T = { k: string; name: string; status: string };

export default async function PublishPage({ searchParams }: PageProps<"/admin/templates/publish">) {
  const access = await requireAccess("engagement_terms", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  const [state, data] = await Promise.all([loadWordingState(supabase), loadStudioData(supabase, access)]);
  const keys = changedKeys(state.live, state.draft).filter((k) => PIECE.has(k));
  const templates = (allTemplates() as T[]).filter((t) => t.status !== "Planned");
  const where = templateKeys(data.signers, state.live, templates.map((t) => t.k));
  // "Work not included" shows the whole Other matters section, so every sentence there would carry its
  // name; call it by the section instead.
  const usedIn = (k: string) => templates.filter((t) => where.get(t.k)?.has(k)).map((t) => (t.k === "sExcl" ? "Corporate master letter: Other matters" : t.name));
  const editable = canEdit(access, "engagement_terms");

  return (
    <>
      <Link href="/admin/templates" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />All templates</Link>
      <PageHeader title="Review and publish" description="Every unpublished change, before and after. Publishing puts them into new letters and proposals. Letters already made keep the wording they used." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {keys.length === 0 ? <p className="card text-sm text-muted">No unpublished changes.</p> : (
        <>
          <ul className="mb-6 grid gap-4">
            {keys.map((k) => {
              const p = PIECE.get(k)!;
              const before = toFriendly(k, state.live?.texts[k] ?? p.text);
              const after = toFriendly(k, state.draft?.texts[k] ?? p.text);
              const places = usedIn(k);
              return (
                <li key={k} className="card space-y-2">
                  <p className="text-xs text-muted">{places.length ? `In: ${places.join(" · ")}` : "Used in letters and proposals"}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><p className="mb-1 text-xs font-medium text-ink-3 uppercase">Published now</p><p className="rounded-lg bg-sand-50 p-2 text-sm whitespace-pre-wrap">{before}</p></div>
                    <div><p className="mb-1 text-xs font-medium text-ink-3 uppercase">After publishing</p><p className="rounded-lg bg-[#FFF4CC] p-2 text-sm whitespace-pre-wrap">{after}</p></div>
                  </div>
                  {editable && <UndoButton wordingKey={k} />}
                </li>
              );
            })}
          </ul>
          <div className="card flex flex-wrap items-center justify-between gap-4">
            {access.is_owner ? (
              <form action={publishChanges} className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="read" required className="h-4 w-4 accent-navy-700" />I read the {keys.length} change{keys.length === 1 ? "" : "s"}</label>
                <button className="btn" type="submit">Publish changes</button>
                <span className="text-xs text-muted">Recorded as {state.draft?.label}.</span>
              </form>
            ) : <p className="text-sm text-muted">Waiting for an owner to publish.</p>}
            {editable && <form action={discardChanges}><button className="text-sm text-danger underline" type="submit">Discard all unpublished changes</button></form>}
          </div>
        </>
      )}
    </>
  );
}
