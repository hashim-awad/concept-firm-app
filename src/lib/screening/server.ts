import "server-only";
// Screening on the server with the service key: the public start page cannot read the price book
// (and must never see prices), so the server loads the published questions and today's prices,
// and works out the quote itself.
import { createAdminClient } from "@/lib/supabase/admin";
import { todayToronto } from "@/lib/dates";
import type { PricedItem, Question, Questionnaire, Rule } from "./engine";
import { fillRuleValues, type T1Rules } from "./t1-v2";

export async function readT1Rules(): Promise<T1Rules> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "t1_rules").maybeSingle();
  return (data?.value ?? {}) as T1Rules;
}

// Questions with the Settings values ({moving_km} and the T1135 thresholds) filled in.
export function withRuleValues<Q extends Pick<Question, "prompt" | "help_text">>(questions: Q[], r: T1Rules): Q[] {
  return questions.map((q) => ({ ...q, prompt: fillRuleValues(q.prompt, r), help_text: fillRuleValues(q.help_text, r) }));
}

export type Published = Questionnaire & { id: string; version: number; title: string; intro: string };

export async function loadPublished(route: "personal" | "corporate"): Promise<Published | null> {
  const db = createAdminClient();
  const { data: row } = await db.from("questionnaires").select("id, version, title, intro, couple_question_key, couple_value").eq("route", route).eq("status", "published").maybeSingle();
  if (!row) return null;
  const [{ data: questions }, { data: rules }, r] = await Promise.all([
    db.from("questions").select("key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order").eq("questionnaire_id", row.id).order("sort_order"),
    db.from("rules").select("kind, conditions, item_code, quantity_question_key, message, sort_order").eq("questionnaire_id", row.id).order("sort_order"),
    readT1Rules(),
  ]);
  return { ...row, questions: withRuleValues((questions ?? []) as Question[], r), rules: (rules ?? []) as Rule[] };
}

// For the client's browser: the questions and the rules that stop or check the form. No price rules.
export function forBrowser(p: Published) {
  return { couple_question_key: p.couple_question_key, couple_value: p.couple_value, title: p.title, intro: p.intro,
    questions: p.questions, rules: p.rules.filter((r) => r.kind !== "add_item") };
}

// Today's price of each item (the latest price that has started, Toronto date).
export async function loadPricesNow(): Promise<PricedItem[]> {
  const db = createAdminClient();
  const today = todayToronto();
  const [{ data: items }, { data: prices }] = await Promise.all([
    db.from("catalogue_items").select("id, code, name, unit_label, price_type"),
    db.from("item_prices").select("item_id, amount_cents, effective_from").lte("effective_from", today).order("effective_from", { ascending: false }),
  ]);
  const latest = new Map<string, number>();
  for (const p of (prices ?? []) as { item_id: string; amount_cents: number }[]) if (!latest.has(p.item_id)) latest.set(p.item_id, p.amount_cents);
  return ((items ?? []) as { id: string; code: string; name: string; unit_label: string; price_type: string }[])
    .filter((i) => latest.has(i.id) && i.price_type !== "Invoice only")
    .map((i) => ({ code: i.code, name: i.name, unit_label: i.unit_label, amount_cents: latest.get(i.id)! }));
}
