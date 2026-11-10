import "server-only";
// Sends lead alerts (Phase 2 batch, section 3). Runs on the server with the service key:
// - right after a lead comes in (the start page), and
// - every 5 minutes from Vercel's scheduler, and when staff open My day or Leads (so it also works on
//   Test, where the scheduler does not run). It retries a first alert that failed and sends the
//   reminder once a lead waiting for its quote passes 45 business minutes.
// Each alert is claimed in lead_alerts before sending, so two runs never send the same one twice.
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/email/graph";
import { env } from "@/lib/env";
import { businessMinutes, REMINDER_MINUTES, WAITING_STATUSES, type BusinessHours } from "@/lib/business-hours";
import { buildLeadAlert, type AlertLead } from "./alert-email";

type Kind = "new" | "reminder";
type Admin = ReturnType<typeof createAdminClient>;

// Claim an alert before sending, so two runs never send the same one. A claim that failed to send
// can be taken again after 5 minutes (the error stays on record until it goes).
async function claim(db: Admin, leadId: string, kind: Kind): Promise<boolean> {
  const { data, error } = await db.from("lead_alerts").upsert({ lead_id: leadId, kind }, { onConflict: "lead_id,kind", ignoreDuplicates: true }).select("lead_id");
  if (!error && (data?.length ?? 0) > 0) return true;
  const { data: again } = await db.from("lead_alerts").update({ claimed_at: new Date().toISOString() })
    .eq("lead_id", leadId).eq("kind", kind).is("sent_at", null).lt("claimed_at", new Date(Date.now() - 5 * 60_000).toISOString()).select("lead_id");
  return (again?.length ?? 0) > 0;
}

async function deliver(db: Admin, kind: Kind, lead: AlertLead, force = false): Promise<{ sent: number; problem: string } | null> {
  if (!(await claim(db, lead.id, kind)) && !force) return null;
  let sent = 0, problem = "";
  try {
    const { data: to, error } = await db.rpc("lead_alert_recipients");
    if (error) throw new Error(error.message);
    const list = (to ?? []) as string[];
    if (list.length === 0) problem = "Nobody has the Pricing permission.";
    const { subject, html } = buildLeadAlert(kind, lead, env.siteUrl(), REMINDER_MINUTES);
    for (const address of list) {
      try { await sendMail({ to: address, subject, html }); sent++; } catch (e) { problem = e instanceof Error ? e.message : "Email failed."; }
    }
  } catch (e) {
    problem = e instanceof Error ? e.message : "Email failed.";
  }
  // Sent to at least one person: done. Nothing sent: keep the reason on record; the next run retries.
  const { error: saveError } = await db.from("lead_alerts").update({ sent_at: sent > 0 ? new Date().toISOString() : null, recipients: sent, error: problem.slice(0, 300) })
    .eq("lead_id", lead.id).eq("kind", kind);
  if (saveError && !problem) problem = `The alert record could not be saved: ${saveError.message}`;
  return { sent, problem };
}

const LEAD_COLS = "id, route, province, status, answers, created_at";

// Attach the quote total (the server's own record; the email shows the total only).
async function withQuotes<T extends { id: string }>(db: Admin, leads: T[]): Promise<(T & { quote_cents: number | null })[]> {
  if (leads.length === 0) return [];
  const { data } = await db.from("lead_quotes").select("lead_id, subtotal_cents").in("lead_id", leads.map((l) => l.id));
  const by = new Map((data ?? []).map((q: { lead_id: string; subtotal_cents: number }) => [q.lead_id, q.subtotal_cents]));
  return leads.map((l) => ({ ...l, quote_cents: by.get(l.id) ?? null }));
}

export async function sendNewLeadAlert(leadId: string): Promise<void> {
  const db = createAdminClient();
  const { data } = await db.from("leads").select(LEAD_COLS).eq("id", leadId).maybeSingle();
  if (data) await deliver(db, "new", (await withQuotes(db, [data as AlertLead]))[0]);
}

let lastRun = 0;

export type RunResult = { checked: number; newSent: number; reminders: number; due: number; problems: string[] };

// The scheduled check. Looks at leads from the last 14 days only. Reports what it did and any problem,
// so the owner "Check alerts now" button can show it (the background runs have nowhere to show it).
export async function runLeadAlerts(opts: { throttle?: boolean } = {}): Promise<RunResult> {
  const out: RunResult = { checked: 0, newSent: 0, reminders: 0, due: 0, problems: [] };
  if (opts.throttle && Date.now() - lastRun < 60_000) return out;
  lastRun = Date.now();
  const db = createAdminClient();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [leadsQ, doneQ, hoursQ] = await Promise.all([
    db.from("leads").select(LEAD_COLS).gte("created_at", since),
    db.from("lead_alerts").select("lead_id, kind").not("sent_at", "is", null),
    db.from("settings").select("value").eq("key", "business_hours").maybeSingle(),
  ]);
  for (const [name, q] of [["leads", leadsQ], ["alert records", doneQ], ["business hours", hoursQ]] as const) {
    if (q.error) out.problems.push(`Reading ${name} failed: ${q.error.message}`);
  }
  if (out.problems.length) return out;
  const have = new Set((doneQ.data ?? []).map((r: { lead_id: string; kind: string }) => `${r.lead_id}|${r.kind}`));
  const hours = (hoursQ.data?.value ?? null) as BusinessHours | null;
  const now = Date.now();
  for (const l of await withQuotes(db, (leadsQ.data ?? []) as (AlertLead & { created_at: string })[])) {
    out.checked++;
    // A first alert that has not gone out (sending right after the form failed): retry after 2 minutes,
    // for up to 2 days.
    const age = now - Date.parse(l.created_at);
    const partial = (l.answers as { partial?: boolean }).partial === true;
    if (!have.has(`${l.id}|new`) && age > (partial ? 30 * 60_000 : 120_000) && age < 2 * 86400000) {
      const r = await deliver(db, "new", l);
      if (r?.sent) out.newSent++; else if (r?.problem) out.problems.push(r.problem);
    }
    if (!have.has(`${l.id}|reminder`) && WAITING_STATUSES.includes(l.status) && businessMinutes(l.created_at, now, hours) >= REMINDER_MINUTES) {
      out.due++;
      const r = await deliver(db, "reminder", l);
      if (r?.sent) out.reminders++; else if (r?.problem) out.problems.push(r.problem);
    }
  }
  return out;
}

// Business hours for the lead timer. Read with the service key because not every role can read
// Settings; hours are not sensitive.
export async function readBusinessHours(): Promise<BusinessHours | null> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "business_hours").maybeSingle();
  return (data?.value ?? null) as BusinessHours | null;
}

// For the lead page: what happened to this lead's alert emails.
export async function leadAlertStatus(leadId: string) {
  const { data } = await createAdminClient().from("lead_alerts").select("kind, sent_at, recipients, error").eq("lead_id", leadId);
  return (data ?? []) as { kind: Kind; sent_at: string | null; recipients: number; error: string }[];
}

// Owners: send a lead's first alert now and report exactly what happened (also when it already went).
export async function sendLeadAlertNow(leadId: string): Promise<{ sent: number; problem: string }> {
  try {
    const db = createAdminClient();
    const { data, error } = await db.from("leads").select(LEAD_COLS).eq("id", leadId).maybeSingle();
    if (error) return { sent: 0, problem: `Reading the lead failed: ${error.message}` };
    if (!data) return { sent: 0, problem: "Lead not found." };
    const { error: claimError } = await db.from("lead_alerts").upsert({ lead_id: leadId, kind: "new" }, { onConflict: "lead_id,kind", ignoreDuplicates: true });
    if (claimError) return { sent: 0, problem: `The alert record could not be made: ${claimError.message}` };
    return (await deliver(db, "new", (await withQuotes(db, [data as AlertLead]))[0], true)) ?? { sent: 0, problem: "Not sent." };
  } catch (e) {
    return { sent: 0, problem: e instanceof Error ? e.message : "Failed." };
  }
}
