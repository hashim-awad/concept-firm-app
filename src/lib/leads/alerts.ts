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

async function claim(db: Admin, leadId: string, kind: Kind): Promise<boolean> {
  const { data, error } = await db.from("lead_alerts").upsert({ lead_id: leadId, kind }, { onConflict: "lead_id,kind", ignoreDuplicates: true }).select("lead_id");
  return !error && (data?.length ?? 0) > 0;
}

async function deliver(db: Admin, kind: Kind, lead: AlertLead): Promise<void> {
  if (!(await claim(db, lead.id, kind))) return;
  let sent = 0, problem = "";
  try {
    const { data: to, error } = await db.rpc("lead_alert_recipients");
    if (error) throw new Error(error.message);
    const { subject, html } = buildLeadAlert(kind, lead, env.siteUrl(), REMINDER_MINUTES);
    for (const address of (to ?? []) as string[]) {
      try { await sendMail({ to: address, subject, html }); sent++; } catch (e) { problem = e instanceof Error ? e.message : "Email failed."; }
    }
    if ((to ?? []).length === 0) problem = "Nobody has the Pricing permission.";
  } catch (e) {
    problem = e instanceof Error ? e.message : "Email failed.";
  }
  if (sent === 0 && problem !== "Nobody has the Pricing permission.") {
    // Nothing went out: release the claim so the next run tries again.
    await db.from("lead_alerts").delete().eq("lead_id", lead.id).eq("kind", kind);
    return;
  }
  await db.from("lead_alerts").update({ sent_at: new Date().toISOString(), recipients: sent, error: problem.slice(0, 300) }).eq("lead_id", lead.id).eq("kind", kind);
}

const LEAD_COLS = "id, route, province, status, answers, created_at";

export async function sendNewLeadAlert(leadId: string): Promise<void> {
  const db = createAdminClient();
  const { data } = await db.from("leads").select(LEAD_COLS).eq("id", leadId).maybeSingle();
  if (data) await deliver(db, "new", data as AlertLead);
}

let lastRun = 0;

// The scheduled check. Looks at leads from the last 14 days only.
export async function runLeadAlerts(opts: { throttle?: boolean } = {}): Promise<{ newSent: number; reminders: number }> {
  if (opts.throttle && Date.now() - lastRun < 60_000) return { newSent: 0, reminders: 0 };
  lastRun = Date.now();
  const db = createAdminClient();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [{ data: leads }, { data: done }, { data: hoursRow }] = await Promise.all([
    db.from("leads").select(LEAD_COLS).gte("created_at", since),
    db.from("lead_alerts").select("lead_id, kind"),
    db.from("settings").select("value").eq("key", "business_hours").maybeSingle(),
  ]);
  const have = new Set((done ?? []).map((r: { lead_id: string; kind: string }) => `${r.lead_id}|${r.kind}`));
  const hours = (hoursRow?.value ?? null) as BusinessHours | null;
  const now = Date.now();
  let newSent = 0, reminders = 0;
  for (const l of (leads ?? []) as (AlertLead & { created_at: string })[]) {
    // A first alert that has not gone out (sending right after the form failed): retry after 2 minutes.
    if (!have.has(`${l.id}|new`) && now - Date.parse(l.created_at) > 120_000) { await deliver(db, "new", l); newSent++; }
    if (!have.has(`${l.id}|reminder`) && WAITING_STATUSES.includes(l.status) && businessMinutes(l.created_at, now, hours) >= REMINDER_MINUTES) {
      await deliver(db, "reminder", l); reminders++;
    }
  }
  return { newSent, reminders };
}

// Business hours for the lead timer. Read with the service key because not every role can read
// Settings; hours are not sensitive.
export async function readBusinessHours(): Promise<BusinessHours | null> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "business_hours").maybeSingle();
  return (data?.value ?? null) as BusinessHours | null;
}
