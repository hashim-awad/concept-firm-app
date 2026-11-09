"use server";

import { getAccess, canView } from "@/lib/access";
import { loadQuestionnaire, loadCurrentItems, toEngine } from "@/lib/screening/load";
import { evaluate, type Answers, type Result } from "@/lib/screening/engine";

export async function tryQuestionnaire(id: string, _prev: Result | null, formData: FormData): Promise<Result | null> {
  const access = await getAccess();
  if (!access || !canView(access, "price_book") || !canView(access, "pricing")) return null;
  const qn = await loadQuestionnaire(id);
  if (!qn) return null;
  let answers: Answers;
  try {
    answers = JSON.parse(String(formData.get("answers") ?? "{}"));
  } catch {
    return null;
  }
  return evaluate(toEngine(qn), { household: answers.household ?? {}, people: answers.people ?? [] }, await loadCurrentItems());
}
