import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import { loadStudioData } from "@/lib/studio/data";
import { templateSample } from "@/lib/studio/samples";
import { PIECE, toFriendly } from "@/lib/studio/wording-pieces";
import { changedKeys, loadWordingState } from "@/lib/studio/wording-state";
import { TemplateEditor } from "@/components/studio/template-editor";
import { approveTemplate } from "../actions";

type T = { k: string; name: string; group: string; basis: string; status: string };

export default async function TemplatePage({ params, searchParams }: PageProps<"/admin/templates/[key]">) {
  const access = await requireAccess("engagement_terms", "view");
  const { key } = await params;
  const sp = await searchParams;
  const e = createStudioEngine({});
  const t = (e.TEMPLATES as T[]).find((x) => x.k === key);
  if (!t || t.status === "Planned") notFound();
  const supabase = await createClient();
  const [{ data: ap }, data, state] = await Promise.all([
    supabase.from("template_approvals").select("approved_on").eq("template_key", key).order("approved_on", { ascending: false }).limit(1).maybeSingle(),
    loadStudioData(supabase, access),
    loadWordingState(supabase),
  ]);
  // The document shows unpublished changes (in yellow) when there are any.
  const showing = state.draft ? { id: state.draft.id, label: state.draft.label, date: "", texts: state.draft.texts } : state.live;
  const sample = templateSample(key, data.signers, showing, true);
  const keys = [...new Set((sample?.parts ?? []).flatMap((p) => [...p.html.matchAll(/data-w="(w[0-9a-f]{10})"/g)].map((m) => m[1])))];
  const pieces = keys.filter((k) => PIECE.has(k)).map((k) => {
    const p = PIECE.get(k)!;
    const live = state.live?.texts[k] ?? p.text;
    const draft = state.draft ? (state.draft.texts[k] ?? p.text) : live;
    return { key: k, original: toFriendly(k, p.text), live: toFriendly(k, live), draft: toFriendly(k, draft), fills: p.fills ?? [] };
  });
  const editable = canEdit(access, "engagement_terms");
  const pending = changedKeys(state.live, state.draft).length;
  const trial = t.status === "Trial" && !ap;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/templates" className="inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />All templates</Link>
        {pending > 0 && <Link href="/admin/templates/publish" className={buttonClass("primary", "sm")}><Send className="h-4 w-4" aria-hidden />Review and publish ({pending})</Link>}
      </div>
      <header className="mb-4 border-b border-sand-200 pb-4">
        <h1 className="text-[26px] leading-8 font-semibold tracking-tight">{t.name}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {trial ? "Trial: needs an owner's OK before it is used for clients." : ap ? `In use. Marked ready ${formatDate(ap.approved_on)}.` : "In use."}{" "}
          Source: {t.basis}
        </p>
      </header>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {trial && access.is_owner && (
        <form action={approveTemplate} className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-ds)] border border-[#EED9A8] bg-[#FFF8E1] px-4 py-3 text-sm">
          <input type="hidden" name="key" value={key} />
          <span className="text-[#5C3D00]">This template is in trial.</span>
          <label className="flex items-center gap-2"><input type="checkbox" name="read" required className="h-4 w-4 accent-navy-700" />I read it</label>
          <button className="btn h-8 px-3 text-sm" type="submit">Mark ready for clients</button>
        </form>
      )}
      {sample?.note && <p className="card mb-4 text-sm">{sample.note}</p>}
      {sample && sample.parts.length > 0 && <TemplateEditor parts={sample.parts} pieces={pieces} canEdit={editable} />}
    </>
  );
}
