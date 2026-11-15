import "server-only";
// Round 17: each template's status from the approval records (who and when), and the drafts per
// Templates tab, for the gear menu's count and the tabs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { allTemplates } from "./samples";
import { tabOf, templateStatus, type TemplateStatus, type TemplateTab } from "./template-catalog";

export type CatalogTemplate = { k: string; name: string; group: string; basis: string; status: string };

// Every template on the Templates page: the planned ones ("Coming later") are not listed (round 17).
export const listedTemplates = () => (allTemplates() as CatalogTemplate[]).filter((t) => t.status !== "Planned");

export async function templateStatuses(supabase: SupabaseClient): Promise<Map<string, TemplateStatus>> {
  const { data } = await supabase.from("template_approvals").select("template_key, approved_on, created_by, by:created_by(full_name)").order("approved_on");
  const last = new Map<string, { by?: string | null; on: string }>();
  for (const a of (data ?? []) as unknown as { template_key: string; approved_on: string; by: { full_name: string } | null }[]) last.set(a.template_key, { by: a.by?.full_name ?? null, on: a.approved_on });
  return new Map(listedTemplates().map((t) => [t.k, templateStatus(t, last.get(t.k))]));
}

export async function draftsByTab(supabase: SupabaseClient): Promise<Record<TemplateTab, number>> {
  const st = await templateStatuses(supabase);
  const out: Record<TemplateTab, number> = { letters: 0, schedules: 0, emails: 0, closebook: 0 };
  for (const t of listedTemplates()) if (st.get(t.k)?.draft) out[tabOf(t.k)]++;
  return out;
}
