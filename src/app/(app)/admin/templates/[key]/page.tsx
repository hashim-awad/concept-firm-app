import Link from "next/link";
import { notFound } from "next/navigation";
import { Send } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadStudioData } from "@/lib/studio/data";
import { allTemplates, templateSample } from "@/lib/studio/samples";
import { PIECE, toFriendly } from "@/lib/studio/wording-pieces";
import { changedKeys, loadWordingState } from "@/lib/studio/wording-state";
import { TemplateEditor } from "@/components/studio/template-editor";
import { approveTemplate } from "../actions";
import { NOT_LOADED, approveButton, whereUsed } from "@/lib/studio/template-catalog";
import { templateStatuses } from "@/lib/studio/template-status";
import { SettingsShell } from "../../settings-shell";
import { StatusChip } from "../status-chip";

type T = { k: string; name: string; group: string; basis: string; status: string };

export default async function TemplatePage({ params, searchParams }: PageProps<"/admin/templates/[key]">) {
  const access = await requireAccess("engagement_terms", "view");
  const { key } = await params;
  const sp = await searchParams;
  const t = (allTemplates() as T[]).find((x) => x.k === key);
  if (!t || t.status === "Planned" || NOT_LOADED.has(key)) notFound();
  const supabase = await createClient();
  const [statuses, data, state] = await Promise.all([
    templateStatuses(supabase),
    loadStudioData(supabase, access),
    loadWordingState(supabase),
  ]);
  // The document shows unpublished changes (in yellow) when there are any.
  const showing = state.draft ? { id: state.draft.id, label: state.draft.label, date: "", texts: state.draft.texts } : state.live;
  const sample = templateSample(key, data.signers, showing, true);
  // Lines from the original wording too: a "Next steps" line set to blank leaves the document but
  // stays in the list, so it can be filled in again.
  const base = templateSample(key, data.signers, null, true);
  const keys = [...new Set([...(sample?.parts ?? []), ...(base?.parts ?? [])].flatMap((p) => [...p.html.matchAll(/data-w="(w[0-9a-f]{10})"/g)].map((m) => m[1])))];
  const pieces = keys.filter((k) => PIECE.has(k)).map((k) => {
    const p = PIECE.get(k)!;
    const live = state.live?.texts[k] ?? p.text;
    const draft = state.draft ? (state.draft.texts[k] ?? p.text) : live;
    return { key: k, original: toFriendly(k, p.text), live: toFriendly(k, live), draft: toFriendly(k, draft), fills: p.fills ?? [] };
  });
  const editable = canEdit(access, "engagement_terms");
  const pending = changedKeys(state.live, state.draft).length;
  const status = statuses.get(key)!;
  const trial = status.draft;

  // Round 17: the title with its status; where it is used and its source in the "?" panel; the owner's
  // approval at the bottom, after the wording.
  return (
    <SettingsShell title={t.name} badge={<StatusChip s={status} />}
      help={<><p>{whereUsed(key)}</p><p>Source: {t.basis}</p>{trial && <p>A draft needs an Admin&rsquo;s approval before it is used. Read it, then approve it at the bottom of this page.</p>}</>}
      actions={pending > 0 ? <Link href="/admin/templates/publish" className={buttonClass("primary", "sm")}><Send className="h-4 w-4" aria-hidden />Review and publish ({pending})</Link> : undefined}>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {sample?.note && <p className="card mb-4 text-sm">{sample.note}</p>}
      {sample && sample.parts.length > 0 && <TemplateEditor parts={sample.parts} pieces={pieces} canEdit={editable} />}
      {trial && (access.admin && access.permissions.engagement_terms === "edit") && (
        <form action={approveTemplate} className="mt-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-ds)] border border-[#EED9A8] bg-[#FFF8E1] px-4 py-3 text-sm">
          <input type="hidden" name="key" value={key} />
          <span className="font-semibold text-[#5C3D00]">Draft.</span>
          <label className="flex items-center gap-2"><input type="checkbox" name="read" required className="h-4 w-4 accent-navy-700" />I read it</label>
          <button className="btn h-8 px-3 text-sm" type="submit">{approveButton(key)}</button>
        </form>
      )}
    </SettingsShell>
  );
}
