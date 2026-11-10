"use server";
import { createHmac, randomBytes } from "node:crypto";
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
import { taxYearFor } from "@/lib/screening/tax-year";
import { checkAnswers, priceLines, route } from "@/lib/corporate/quote";
import { todayToronto } from "@/lib/dates";

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
    lines = r.lines;
    subtotal = r.subtotal_cents;
  }

  const clean = cleanAnswers(qn, raw);
  const db = createAdminClient();
  const { data: src } = await db.from("settings").select("value").eq("key", "lead_sources").maybeSingle();
  const sources = (src?.value ?? []) as string[];
  const source = String(formData.get("source") ?? "");
  const answers = {
    questionnaire_id: qn.id, version: qn.version, tax_year: taxYearFor(todayToronto()), household: clean.household, people: clean.people,
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

// ---------- Company route (batch section 10) ----------
export type CompanyStart = { error: string } | { leadId: string; token: string };

// "Your details" first, so a lead who stops partway is still captured. The browser gets a private key
// to finish the same lead; the database keeps only its hash.
export async function startCompany(formData: FormData): Promise<CompanyStart> {
  const elapsed = Date.now() - Number(formData.get("t") ?? 0);
  if (String(formData.get("website") ?? "") !== "" || !(elapsed > 2000)) return { error: "Please try again." };
  const contact = {
    first_name: String(formData.get("first_name") ?? "").trim(), last_name: String(formData.get("last_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(), phone: "", province: String(formData.get("province") ?? ""),
  };
  if (!contact.first_name || !contact.last_name) return { error: "Enter your first and last name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return { error: "Enter a valid email address." };
  if (!contact.province) return { error: "Choose your province." };
  const supabase = await createClient();
  const { data: leadId, error } = await supabase.rpc("submit_lead", { p_route: "company", p_contact: contact, p_answers: { form: "corporate-v1", partial: true }, p_ip_hash: await ipHashNow() });
  if (error || !leadId) return { error: error?.message ?? "Your details could not be sent. Please try again." };
  const token = randomBytes(32).toString("hex");
  const { error: kerr } = await createAdminClient().rpc("set_company_lead_key", { p_lead: String(leadId), p_token: token });
  if (kerr) return { error: "Your details could not be saved. Please try again." };
  return { leadId: String(leadId), token };
}

// The rest of the answers. Auto-price: the quote is worked out from today's prices. Call: the lead is
// marked Call needed and the thank-you page offers the booking link (section 11 routing).
export async function finishCompany(leadId: string, token: string, answersJson: string): Promise<{ error: string } | null> {
  let raw: unknown;
  try { raw = JSON.parse(answersJson); } catch { return { error: "Your answers could not be read." }; }
  const checked = checkAnswers(raw);
  if (!checked.ok) return { error: checked.error };
  const a = checked.a;
  const r = route(a);
  let lines: ReturnType<typeof priceLines> = [];
  if (r.path === "auto") {
    try { lines = priceLines(a, await loadPricesNow()); } catch { return { error: "We could not prepare your quote right now. Please try again later, or call us." }; }
  }
  const db = createAdminClient();
  const { error } = await db.rpc("complete_company_lead", { p_lead: leadId, p_token: token, p_answers: { ...a, route: r.path, call_reasons: r.reasons }, p_status: r.path === "auto" ? "new" : "call_needed" });
  if (error) return { error: error.message };
  if (r.path === "auto") await db.from("lead_quotes").insert({ lead_id: leadId, lines, subtotal_cents: lines.reduce((n, l) => n + l.total_cents, 0) });
  after(() => sendNewLeadAlert(leadId).catch(() => undefined));
  redirect(`/start/thanks?r=company&p=${r.path}`);
}
