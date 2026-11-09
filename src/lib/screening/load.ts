import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PricedItem, Question, Questionnaire, Rule } from "./engine";

export type QuestionnaireRow = {
  id: string;
  route: "personal" | "corporate";
  version: number;
  status: "draft" | "published" | "retired";
  title: string;
  intro: string;
  couple_question_key: string | null;
  couple_value: string | null;
  published_at: string | null;
};

export type QuestionRow = Question & { id: string };
export type RuleRow = Rule & { id: string };

export async function loadQuestionnaire(id: string) {
  const supabase = await createClient();
  const [{ data: q }, { data: questions }, { data: rules }] = await Promise.all([
    supabase.from("questionnaires").select("id, route, version, status, title, intro, couple_question_key, couple_value, published_at").eq("id", id).maybeSingle(),
    supabase.from("questions").select("*").eq("questionnaire_id", id).order("sort_order"),
    supabase.from("rules").select("*").eq("questionnaire_id", id).order("sort_order"),
  ]);
  if (!q) return null;
  return {
    row: q as QuestionnaireRow,
    questions: (questions ?? []) as QuestionRow[],
    rules: (rules ?? []) as RuleRow[],
  };
}

export function toEngine(q: NonNullable<Awaited<ReturnType<typeof loadQuestionnaire>>>): Questionnaire {
  return {
    couple_question_key: q.row.couple_question_key,
    couple_value: q.row.couple_value,
    questions: q.questions,
    rules: q.rules,
  };
}

export async function loadCurrentItems(): Promise<(PricedItem & { id: string; per_spouse: boolean; is_active: boolean })[]> {
  const supabase = await createClient();
  const [{ data: items }, { data: prices }] = await Promise.all([
    supabase.from("catalogue_items").select("id, code, name, unit_label, per_spouse, is_active").order("sort_order"),
    supabase.from("current_item_prices").select("item_id, amount_cents"),
  ]);
  const priceOf = new Map((prices ?? []).map((p: { item_id: string; amount_cents: number }) => [p.item_id, p.amount_cents]));
  return (items ?? [])
    .filter((i: { id: string }) => priceOf.has(i.id))
    .map((i: { id: string; code: string; name: string; unit_label: string; per_spouse: boolean; is_active: boolean }) => ({
      ...i,
      amount_cents: priceOf.get(i.id)!,
    }));
}

// "$1,234.50" or "1234.5" -> 123450. Null when not a valid amount.
export function parseDollars(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
