import Link from "next/link";
import { ChevronRight, History, Send } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import { loadStudioData } from "@/lib/studio/data";
import { changedKeys, loadWordingState } from "@/lib/studio/wording-state";
import { templateKeys } from "@/lib/studio/samples";
import { TEMPLATE_TABS, tabOf, whereUsed, type TemplateTab } from "@/lib/studio/template-catalog";
import { listedTemplates, templateStatuses } from "@/lib/studio/template-status";
import { SettingsShell } from "../settings-shell";
import { StatusChip } from "./status-chip";

// Round 17 (Hashim, Nov 15, 2026; benchmark: TaxDome keeps templates as their own area): one page in four
// tabs. Each template says where it is used and shows its status only: Draft, or approved with who and
// when. Approval stays inside the template, after the owner reads it.
export default async function TemplatesPage({ searchParams }: PageProps<"/admin/templates">) {
  const access = await requireAccess("engagement_terms", "view");
  const sp = await searchParams;
  const e = createStudioEngine({});
  const supabase = await createClient();
  const [statuses, state, data] = await Promise.all([templateStatuses(supabase), loadWordingState(supabase), loadStudioData(supabase, access)]);
  const templates = listedTemplates();
  const changed = new Set(changedKeys(state.live, state.draft));
  const keys = changed.size ? templateKeys(data.signers, state.live, templates.map((t) => t.k)) : new Map<string, Set<string>>();
  const changesIn = (k: string) => [...(keys.get(k) ?? [])].filter((x) => changed.has(x)).length;
  const tab = (TEMPLATE_TABS.find(([k]) => k === sp.tab)?.[0] ?? "letters") as TemplateTab;
  const drafts = (k: TemplateTab) => (access.is_owner ? templates.filter((t) => tabOf(t.k) === k && statuses.get(t.k)?.draft).length : 0);
  const list = templates.filter((t) => tabOf(t.k) === tab);

  return (
    <SettingsShell title="Templates" href="/admin/templates" active={tab} tabs={TEMPLATE_TABS.map(([key, label]) => ({ key, label, count: drafts(key) }))}
      help={<><p>The wording of your letters, quotes, emails and Closebook papers. Open a template to read it; click any text to change it. Changes go into letters when an owner publishes them.</p>
        <p>A draft template needs an owner&rsquo;s approval before it is used. The owner opens it, reads it, ticks &ldquo;I read it&rdquo; and approves it at the bottom.</p>
        <p>Published wording: <b>{state.live?.label ?? e.EL_VERSION}</b>{state.live?.date ? `, ${formatDate(state.live.date)}` : ""}.</p></>}
      actions={<Link href="/admin/templates/history" className={buttonClass("secondary")}><History className="h-4 w-4" aria-hidden />History</Link>}>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {changed.size > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-ds)] border border-[#EED9A8] bg-[#FFF8E1] px-4 py-3">
          <p className="text-sm text-[#5C3D00]"><b>{changed.size} unpublished change{changed.size === 1 ? "" : "s"}.</b> Letters keep using the published wording until an owner publishes.</p>
          <Link href="/admin/templates/publish" className={buttonClass("primary", "sm")}><Send className="h-4 w-4" aria-hidden />Review and publish</Link>
        </div>
      )}
      <ul className="card divide-y divide-sand-200 p-0">
        {list.map((t) => {
          const n = changesIn(t.k);
          return (
            <li key={t.k}>
              <Link href={`/admin/templates/${t.k}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-sand-50">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{t.name}</p>
                  <p className="text-[13px] text-ink-3">{whereUsed(t.k)}</p>
                </div>
                {n > 0 && <span className="rounded-full bg-[#FFF4CC] px-2 py-0.5 text-xs font-medium whitespace-nowrap text-[#5C3D00]">{n} unpublished</span>}
                <StatusChip s={statuses.get(t.k)!} />
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </SettingsShell>
  );
}
