import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { deadlineKey, type T2Client } from "@/lib/deadlines";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type DoneRow = {
  client_id: string; year_end: string; kind: string; done_at: string; done_by: string | null;
  reason: string; source: "manual" | "batch" | "efile"; batch_id: string | null;
};

// Labels shown today, used when the deadline_kinds table cannot be read.
export const KIND_FALLBACK: Record<string, string> = { balance: "Balance due", filing: "T2 filing" };

// T2 deadlines (decision 43): T2 clients from TaxDome, not excluded, active; and every deadline marked done.
// Used by My day and by "Mark done before a date", so both work from the same list.
export async function loadT2(supabase: Supabase) {
  const [c, d] = await Promise.all([
    supabase.from("clients").select("id, legal_name, year_end_md, t2_balance_due_months").contains("taxdome_tags", ["T2"]).eq("t2_exclude_deadlines", false).eq("status", "active").order("legal_name"),
    supabase.from("t2_deadline_done").select("client_id, year_end, kind, done_at, done_by, reason, source, batch_id"),
  ]);
  const clients = (c.data ?? []) as T2Client[];
  const done = (d.data ?? []) as DoneRow[];
  const doneKeys = new Set(done.map((x) => deadlineKey({ clientId: x.client_id, yearEnd: x.year_end, kind: x.kind })));
  return { clients, done, doneKeys };
}

// Deadline labels from deadline_kinds (GST/HST reminders arrive later as new kinds), in their order.
export async function loadKindLabels(supabase: Supabase): Promise<Record<string, string>> {
  const { data } = await supabase.from("deadline_kinds").select("key, label, sort").order("sort");
  const labels: Record<string, string> = { ...KIND_FALLBACK };
  for (const k of (data ?? []) as { key: string; label: string }[]) labels[k.key] = k.label;
  return labels;
}

// The Toronto calendar date (YYYY-MM-DD) of a moment.
export function torontoDate(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
