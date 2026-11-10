"use server";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { sendNewLeadAlert } from "@/lib/leads/alerts";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanAnswers, earlyOutOfScope, evaluate, type Answers } from "@/lib/screening/engine";
import { loadPricesNow, loadPublished } from "@/lib/screening/server";
import type { FormResult } from "@/components/screening-form";

export type StartState = { error: string } | null;

// Submits the "About you" answers as a lead. Spam: a hidden trap field and a minimum fill time here;
// the database adds a submission limit per visitor (address kept only as a keyed hash).
export async function submitStart(_prev: StartState, formData: FormData): Promise<StartState> {
  const route = formData.get("route") === "company" ? "company" : "personal";
  const elapsed = Date.now() - Number(formData.get("t") ?? 0);
  if (String(formData.get("website") ?? "") !== "" || !(elapsed > 3000)) redirect(`/start/thanks?r=${route}`);
  const contact = {
    first_name: String(formData.get("first_name") ?? "").trim(), last_name: String(formData.get("last_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(), phone: route === "personal" ? String(formData.get("phone") ?? "").trim() : "",
    province: String(formData.get("province") ?? ""),
  };
  if (!contact.first_name || !contact.last_name) return { error: "Enter your first and last name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return { error: "Enter a valid email address." };
  if (route === "personal" && !/^[0-9 ()+.-]{7,25}$/.test(contact.phone)) return { error: "Enter your phone number, for example 226-789-9591." };
  if (!contact.province) return { error: "Choose your province or territory." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const ipHash = createHmac("sha256", env.supabaseSecretKey()).update(ip).digest("hex");
  const supabase = await createClient();
  const { data: leadId, error } = await supabase.rpc("submit_lead", { p_route: route, p_contact: contact, p_answers: {}, p_ip_hash: ipHash });
  if (error) return { error: error.message };
  // Email everyone with Pricing right away, after the client's page has loaded (batch section 3).
  if (leadId) after(() => sendNewLeadAlert(String(leadId)).catch(() => undefined));
  redirect(`/start/thanks?r=${route}`);
}

async function ipHashNow() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return createHmac("sha256", env.supabaseSecretKey()).update(ip).digest("hex");
}

const fail = (message: string): FormResult => ({ personCount: 0, errors: [], outOfScope: [], lines: [], subtotal_cents: 0, message });

// The personal tax form (batch section 4). The server checks the answers again and works out the
// quote from the published questions and today's prices; the browser never sees a price.
// Out of scope: the lead is saved and marked Out of scope, with the reasons, and no quote.
export async function submitPersonal(_prev: FormResult | null, formData: FormData): Promise<FormResult | null> {
  const elapsed = Date.now() - Number(formData.get("t") ?? 0);
  if (String(formData.get("website") ?? "") !== "" || !(elapsed > 3000)) redirect("/start/thanks?r=personal");
  const contact = {
    first_name: String(formData.get("first_name") ?? "").trim(), last_name: String(formData.get("last_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(), phone: String(formData.get("phone") ?? "").trim(), province: String(formData.get("province") ?? ""),
  };
  if (!contact.first_name || !contact.last_name) return fail("Enter your first and last name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return fail("Enter a valid email address.");
  if (!/^[0-9 ()+.-]{7,25}$/.test(contact.phone)) return fail("Enter your phone number, for example 226-789-9591.");
  if (!contact.province) return fail("Choose your province or territory.");

  let raw: Answers;
  try {
    const j = JSON.parse(String(formData.get("answers") ?? "{}"));
    raw = { household: j.household ?? {}, people: Array.isArray(j.people) ? j.people : [] };
  } catch {
    return fail("Your answers could not be read. Please try again.");
  }
  const qn = await loadPublished("personal");
  if (!qn) return fail("The form is not ready yet. Please call us.");

  const early = earlyOutOfScope(qn, raw);
  const outOfScope = early.length > 0;
  let lines: { code: string; name: string; unit_label: string; person: number | null; quantity: number; unit_cents: number; total_cents: number }[] = [];
  let subtotal = 0;
  if (!outOfScope) {
    let r;
    try {
      r = evaluate(qn, raw, await loadPricesNow());
    } catch {
      return fail("We could not prepare your quote right now. Please try again later, or call us.");
    }
    if (r.errors.length) return r;
    if (formData.get("consent") !== "on") return fail("Please tick the box to let us use your answers to prepare a quote.");
    lines = r.lines;
    subtotal = r.subtotal_cents;
  }

  const clean = cleanAnswers(qn, raw);
  const db = createAdminClient();
  const { data: src } = await db.from("settings").select("value").eq("key", "lead_sources").maybeSingle();
  const sources = (src?.value ?? []) as string[];
  const source = String(formData.get("source") ?? "");
  const answers = {
    questionnaire_id: qn.id, version: qn.version, household: clean.household, people: clean.people,
    out_of_scope: early.map((e) => ({ reason: e.reason, person: e.person })), consent_at: outOfScope ? null : new Date().toISOString(),
  };

  const supabase = await createClient();
  const { data: leadId, error } = await supabase.rpc("submit_lead", { p_route: "personal", p_contact: contact, p_answers: answers, p_ip_hash: await ipHashNow() });
  if (error || !leadId) return fail(error?.message ?? "Your answers could not be sent. Please try again.");
  const id = String(leadId);
  await db.from("leads").update({ ...(outOfScope ? { status: "out_of_scope" } : {}), ...(sources.includes(source) ? { source } : {}) }).eq("id", id);
  if (!outOfScope) await db.from("lead_quotes").insert({ lead_id: id, questionnaire_id: qn.id, lines, subtotal_cents: subtotal });
  // Email everyone with Pricing right away, after the client's page has loaded (batch section 3).
  after(() => sendNewLeadAlert(id).catch(() => undefined));
  redirect(`/start/thanks?r=personal${outOfScope ? "&o=1" : ""}`);
}
