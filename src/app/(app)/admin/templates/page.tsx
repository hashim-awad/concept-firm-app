import Link from "next/link";
import { ChevronRight, History, Send } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import { loadStudioData } from "@/lib/studio/data";
import { changedKeys, loadWordingState } from "@/lib/studio/wording-state";
import { templateKeys } from "@/lib/studio/samples";

type T = { k: string; name: string; group: string; basis: string; status: string };
const GROUPS: [string, string][] = [["Engagement letters", "Engagement letters and proposals"], ["Service schedules", "Service sections in the corporate letter"], ["Shared parts", "Appendices and terms"], ["Quality control", "Quality control"], ["Planned", "Coming later"]];

export default async function TemplatesPage({ searchParams }: PageProps<"/admin/templates">) {
  const access = await requireAccess("engagement_terms", "view");
  const sp = await searchParams;
  const e = createStudioEngine({});
  const supabase = await createClient();
  const [{ data: approvals }, state, data] = await Promise.all([
    supabase.from("template_approvals").select("template_key, approved_on").order("approved_on"),
    loadWordingState(supabase),
    loadStudioData(supabase, access),
  ]);
  const ok = new Map((approvals ?? []).map((a) => [a.template_key, a.approved_on as string]));
  const templates = e.TEMPLATES as T[];
  const changed = new Set(changedKeys(state.live, state.draft));
  const keys = changed.size ? templateKeys(data.signers, state.live, templates.filter((t) => t.status !== "Planned").map((t) => t.k)) : new Map<string, Set<string>>();
  const changesIn = (k: string) => [...(keys.get(k) ?? [])].filter((x) => changed.has(x)).length;

  const chip = (t: T) => {
    if (t.status === "Planned") return <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-ink-2">Coming later</span>;
    if (t.status === "Trial" && !ok.has(t.k)) return <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-[#5C3D00]">Trial: needs your OK</span>;
    return <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-[#14532F]">In use</span>;
  };

  return (
    <>
      <PageHeader title="Templates" description="The wording of your letters, proposals and terms. Open a template to read it; click any text to change it. Changes go into letters when an owner publishes them."
        actions={<Link href="/admin/templates/history" className={buttonClass("secondary")}><History className="h-4 w-4" aria-hidden />History</Link>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      {changed.size > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-ds)] border border-[#EED9A8] bg-[#FFF8E1] px-4 py-3">
          <p className="text-sm text-[#5C3D00]"><b>{changed.size} unpublished change{changed.size === 1 ? "" : "s"}.</b> Letters keep using the published wording until an owner publishes.</p>
          <Link href="/admin/templates/publish" className={buttonClass("primary", "sm")}><Send className="h-4 w-4" aria-hidden />Review and publish</Link>
        </div>
      )}
      <p className="mb-5 text-sm text-ink-2">Published wording: <b>{state.live?.label ?? e.EL_VERSION}</b>{state.live?.date ? `, ${formatDate(state.live.date)}` : ""}.</p>

      {GROUPS.map(([g, title]) => {
        const L = templates.filter((t) => t.group === g);
        if (!L.length) return null;
        return (
          <section key={g} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-3 uppercase">{title}</h2>
            <ul className="card divide-y divide-sand-200 p-0">
              {L.map((t) => {
                const n = changesIn(t.k);
                const inner = (
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{t.name}</p>
                      <p className="text-[13px] text-ink-3">{t.basis}</p>
                    </div>
                    {n > 0 && <span className="rounded-full bg-[#FFF4CC] px-2 py-0.5 text-xs font-medium text-[#5C3D00]">{n} unpublished</span>}
                    {chip(t)}
                    {t.status !== "Planned" && <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />}
                  </div>
                );
                return <li key={t.k}>{t.status === "Planned" ? inner : <Link href={`/admin/templates/${t.k}`} className="block hover:bg-sand-50">{inner}</Link>}</li>;
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
