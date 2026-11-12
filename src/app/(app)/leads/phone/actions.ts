"use server";
// New lead by phone (front office batch, section 2): the same screening and price engine as the
// online start page, entered by staff. The server checks every answer again and works out the price
// from the published questions and today's price book, exactly as for a website lead.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { cleanAnswers, earlyOutOfScope, evaluate, type Answer, type Answers } from "@/lib/screening/engine";
import { loadPricesNow, loadPublished } from "@/lib/screening/server";
import { taxYearFor } from "@/lib/screening/tax-year";
import { checkAnswers, priceLines, route } from "@/lib/corporate/quote";
import { sendNewLeadAlert } from "@/lib/leads/alerts";
import { todayToronto } from "@/lib/dates";
import type { FormResult } from "@/components/screening-form";
import type { Finish, PhoneContact } from "@/lib/leads/phone";

const fail = (message: string): FormResult => ({ personCount: 0, errors: [], outOfScope: [], lines: [], subtotal_cents: 0, message });
const FINISHES: Finish[] = ["issue", "draft", "hashim"];
const readAnswers = (json: string): Answers | null => {
  try { const j = JSON.parse(json); return { household: j.household ?? {}, people: Array.isArray(j.people) ? j.people : [] }; } catch { return null; }
};

// The price panel: the one total from the live price book. Staff with Pricing only; nothing is saved.
export async function phonePrice(form: "personal" | "company", json: string): Promise<{ total_cents: number | null; note: string }> {
  const access = await getAccess();
  if (!access || !canView(access, "pricing")) return { total_cents: null, note: "Prices show to staff with the Pricing permission." };
  try {
    if (form === "personal") {
      const qn = await loadPublished("personal");
      const raw = readAnswers(json);
      if (!qn || !raw) return { total_cents: null, note: "The questions are not ready." };
      const early = earlyOutOfScope(qn, raw);
      if (early.length) return { total_cents: null, note: `Out of scope: ${early.map((e) => e.reason).join("; ")}. Send to Hashim.` };
      const prices = await loadPricesNow();
      const r = evaluate(qn, raw, prices);
      if (r.subtotal_cents > 0) return { total_cents: r.subtotal_cents, note: "" };
      // A running total while the call goes on (step 5 test, Nov 13, 2026): the full check stops at the
      // first missing answer, so the panel also prices the answers given so far, with nothing required and
      // the contact details (names, email, phone) left out. They never change the price.
      const loose = { ...qn, questions: qn.questions.map((q) => ({ ...q, required: false })) };
      const contact = new Set(qn.questions.filter((q) => ["text", "email", "phone"].includes(q.answer_type)).map((q) => q.key));
      const strip = (o: Record<string, Answer>) => Object.fromEntries(Object.entries(o).filter(([k]) => !contact.has(k)));
      const so_far = evaluate(loose, { household: strip(raw.household), people: raw.people.map(strip) } as Answers, prices);
      // Until the base return is priced, there is no total to tell the caller.
      if (so_far.subtotal_cents === 0) return { total_cents: null, note: so_far.outOfScope.length ? "Out of scope. Send to Hashim." : "Answer the questions to see the price." };
      return { total_cents: so_far.subtotal_cents, note: "Running total. Some answers are still missing, so the total may change." };
    }
    const checked = checkAnswers(JSON.parse(json));
    if (!checked.ok) return { total_cents: null, note: "Answer the questions to see the price." };
    const r = route(checked.a);
    if (r.path === "call") return { total_cents: null, note: `Needs Hashim: ${r.reasons.join(", ")}.` };
    return { total_cents: priceLines(checked.a, await loadPricesNow()).reduce((n, l) => n + l.total_cents, 0), note: "" };
  } catch {
    return { total_cents: null, note: "The price could not be worked out right now." };
  }
}

// Where to go after saving. Issue quote: the quote page, with the email ready to send (Phase 2: sent
// from Outlook, then Mark as sent). A company quote first needs the legal name and year-end confirmed.
async function after_(id: string, finish: Finish, form: "personal" | "company", status: string) {
  revalidatePath("/leads"); revalidatePath("/");
  if (finish === "issue" && status === "new") {
    const supabase = await createClient();
    const { error } = form === "personal" ? await supabase.rpc("create_t1_quote", { p_lead: id }) : await supabase.rpc("create_corporate_quote", { p_lead: id });
    if (!error) redirect(`/leads/${id}/quote`);
    redirect(withMessage(`/leads/${id}`, "error", `Lead saved. The quote is not ready: ${error.message}`));
  }
  redirect(withMessage(`/leads/${id}`, "msg", finish === "hashim" || status !== "new" ? "Lead saved and sent to Hashim." : "Lead saved as a draft. Issue the quote when you are ready."));
}

export async function finishPhonePersonal(clientId: string | null, _prev: FormResult | null, formData: FormData): Promise<FormResult | null> {
  const access = await getAccess();
  if (!access || !canEdit(access, "leads")) return fail("You need Edit on Leads to enter a phone lead.");
  const finish = String(formData.get("finish") ?? "") as Finish;
  if (!FINISHES.includes(finish)) return fail("Choose how to finish.");
  const contact = {
    first_name: String(formData.get("first_name") ?? "").trim(), last_name: String(formData.get("last_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(), phone: String(formData.get("phone") ?? "").trim(), province: String(formData.get("province") ?? ""),
  };
  const raw = readAnswers(String(formData.get("answers") ?? "{}"));
  const qn = await loadPublished("personal");
  if (!raw) return fail("The answers could not be read.");
  if (!qn) return fail("The questions are not published.");
  const early = earlyOutOfScope(qn, raw);
  let lines: Awaited<ReturnType<typeof evaluate>>["lines"] = [], subtotal = 0;
  if (!early.length) {
    const r = evaluate(qn, raw, await loadPricesNow());
    if (r.errors.length) return r;
    lines = r.lines; subtotal = r.subtotal_cents;
  }
  const clean = cleanAnswers(qn, raw);
  const answers = {
    questionnaire_id: qn.id, version: qn.version, tax_year: taxYearFor(todayToronto()), household: clean.household, people: clean.people,
    out_of_scope: early.map((e) => ({ reason: e.reason, person: e.person })), consent_at: null,
    phone: { by: access.full_name, on: todayToronto() },
  };
  const status = early.length ? "out_of_scope" : finish === "hashim" ? "call_needed" : "new";
  const { data: id, error } = await (await createClient()).rpc("create_phone_lead", { p_route: "personal", p_contact: contact, p_answers: answers, p_status: status, p_client: clientId, p_company: null });
  if (error || !id) return fail(error?.message ?? "The lead could not be saved.");
  if (!early.length) await createAdminClient().from("lead_quotes").insert({ lead_id: id, questionnaire_id: qn.id, lines, subtotal_cents: subtotal });
  if (status !== "new") after(() => sendNewLeadAlert(String(id)).catch(() => undefined));
  await after_(String(id), finish, "personal", status);
  return null;
}

export async function finishPhoneCompany(clientId: string | null, contact: PhoneContact, company: string, answersJson: string, finish: Finish): Promise<{ error: string } | null> {
  const access = await getAccess();
  if (!access || !canEdit(access, "leads")) return { error: "You need Edit on Leads to enter a phone lead." };
  if (!FINISHES.includes(finish)) return { error: "Choose how to finish." };
  let parsed: unknown;
  try { parsed = JSON.parse(answersJson); } catch { return { error: "The answers could not be read." }; }
  const checked = checkAnswers(parsed);
  if (!checked.ok) return { error: checked.error };
  const r = route(checked.a);
  let lines: ReturnType<typeof priceLines> = [];
  if (r.path === "auto") {
    try { lines = priceLines(checked.a, await loadPricesNow()); } catch { return { error: "The price book is missing a price. Tell Hashim." }; }
  }
  const status = r.path === "call" || finish === "hashim" ? "call_needed" : "new";
  const answers = { ...checked.a, route: r.path, call_reasons: r.reasons, phone: { by: access.full_name, on: todayToronto() } };
  const { data: id, error } = await (await createClient()).rpc("create_phone_lead", {
    p_route: "company", p_contact: { ...contact, email: contact.email.trim(), phone: contact.phone.trim() }, p_answers: answers, p_status: status, p_client: clientId, p_company: company,
  });
  if (error || !id) return { error: error?.message ?? "The lead could not be saved." };
  if (r.path === "auto") await createAdminClient().from("lead_quotes").insert({ lead_id: id, lines, subtotal_cents: lines.reduce((n, l) => n + l.total_cents, 0) });
  if (status !== "new") after(() => sendNewLeadAlert(String(id)).catch(() => undefined));
  await after_(String(id), finish, "company", status);
  return null;
}
