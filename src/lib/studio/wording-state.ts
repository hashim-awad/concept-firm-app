// Published wording and unpublished changes, for the template screens.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Wording } from "./wording";

export type Draft = { id: string; label: string; texts: Record<string, string> };

export async function loadWordingState(supabase: SupabaseClient): Promise<{ live: Wording | null; draft: Draft | null }> {
  const [{ data: cw }, { data: d }] = await Promise.all([
    supabase.rpc("current_wording"),
    supabase.from("wording_versions").select("id, label, wording_texts(key, text)").eq("status", "draft").maybeSingle(),
  ]);
  const w = cw as { id?: string; label?: string; approved_at?: string; texts?: Record<string, string> } | null;
  const live = w?.id && w.label ? { id: w.id, label: w.label, texts: w.texts ?? {}, date: w.approved_at ? new Date(w.approved_at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) : "" } : null;
  const draft = d ? { id: d.id as string, label: d.label as string, texts: Object.fromEntries(((d.wording_texts ?? []) as { key: string; text: string }[]).map((t) => [t.key, t.text])) } : null;
  return { live, draft };
}

// Keys whose draft text differs from the published text.
export function changedKeys(live: Wording | null, draft: Draft | null): string[] {
  if (!draft) return [];
  const pub = live?.texts ?? {};
  const keys = new Set([...Object.keys(pub), ...Object.keys(draft.texts)]);
  return [...keys].filter((k) => (draft.texts[k] ?? null) !== (pub[k] ?? null));
}

// Next version number for the records: EL v3.31 -> EL v3.32.
export function nextLabel(labels: string[]): string {
  const [ma, mi] = labels.map((l) => l.match(/^EL v(\d+)\.(\d+)$/)).filter(Boolean).map((m) => [Number(m![1]), Number(m![2])])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])[0] ?? [3, 31];
  return `EL v${ma}.${mi + 1}`;
}
