"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import type { Condition } from "@/lib/screening/engine";

const LIST = "/admin/screening";
const editor = (id: string) => `/admin/screening/${id}`;

function friendly(message: string) {
  if (message.includes("questions_questionnaire_id_key_key")) return "Another question already uses that key.";
  if (message.includes("questions_key_check")) return "Key: lower-case letters, numbers and underscores, starting with a letter.";
  if (message.includes("row-level security")) return "You do not have permission to change screening questions.";
  return message;
}

export async function createDraft(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_questionnaire_draft", { p_route: String(formData.get("route")) });
  if (error) redirect(withMessage(LIST, "error", friendly(error.message)));
  revalidatePath(LIST);
  redirect(withMessage(editor(String(data)), "msg", "Draft created from the published version. Change it, test it, then publish."));
}

export async function deleteDraft(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_questionnaire_draft", { p_id: String(formData.get("id")) });
  revalidatePath(LIST);
  redirect(withMessage(LIST, error ? "error" : "msg", error ? friendly(error.message) : "Draft deleted."));
}

export async function publish(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_questionnaire", { p_id: id });
  revalidatePath(LIST);
  if (error) redirect(withMessage(editor(id), "error", friendly(error.message)));
  redirect(withMessage(LIST, "msg", "Published. New screening forms use this version from now on."));
}

export async function saveHeader(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const coupleKey = String(formData.get("couple_question_key") ?? "").trim();
  const { error } = await supabase
    .from("questionnaires")
    .update({
      title: String(formData.get("title") ?? "").trim(),
      intro: String(formData.get("intro") ?? "").trim(),
      couple_question_key: coupleKey || null,
      couple_value: coupleKey ? String(formData.get("couple_value") ?? "").trim() || null : null,
    })
    .eq("id", id);
  redirect(withMessage(editor(id), error ? "error" : "msg", error ? friendly(error.message) : "Saved."));
}

function conditionFrom(formData: FormData, prefix: string): Condition | null {
  const question = String(formData.get(`${prefix}question`) ?? "");
  const op = String(formData.get(`${prefix}op`) ?? "") as Condition["op"];
  if (!question || !op) return null;
  const raw = String(formData.get(`${prefix}value`) ?? "").trim();
  if (op === "answered" || op === "not_answered") return { question, op };
  const numeric = ["gt", "gte", "lt", "lte"].includes(op);
  return { question, op, value: numeric && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw };
}

function parseOptions(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, ...rest] = line.split("|");
      const label = rest.join("|").trim();
      return { value: value.trim(), label: label || value.trim() };
    });
}

export async function saveQuestion(formData: FormData) {
  const qnId = String(formData.get("questionnaire_id"));
  const qid = String(formData.get("id") ?? "");
  const back = editor(qnId);
  const answerType = String(formData.get("answer_type"));
  const intOrNull = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Math.trunc(Number(v)));
  const row = {
    questionnaire_id: qnId,
    section: String(formData.get("section") ?? "").trim(),
    prompt: String(formData.get("prompt") ?? "").trim(),
    help_text: String(formData.get("help_text") ?? "").trim(),
    answer_type: answerType,
    options: answerType === "single_choice" ? parseOptions(String(formData.get("options") ?? "")) : [],
    required: formData.get("required") === "on",
    per_person: formData.get("per_person") === "on",
    min_value: answerType === "number" ? intOrNull(formData.get("min_value")) : null,
    max_value: answerType === "number" ? intOrNull(formData.get("max_value")) : null,
    show_if: conditionFrom(formData, "show_"),
    sort_order: Math.trunc(Number(formData.get("sort_order") ?? 0)) || 0,
  };
  const supabase = await createClient();
  const { error } = qid
    ? await supabase.from("questions").update(row).eq("id", qid)
    : await supabase.from("questions").insert({ ...row, key: String(formData.get("key") ?? "").trim() });
  if (error) redirect(withMessage(`${back}/question/${qid || "new"}`, "error", friendly(error.message)));
  redirect(withMessage(back, "msg", qid ? "Question saved." : "Question added."));
}

export async function deleteQuestion(formData: FormData) {
  const qnId = String(formData.get("questionnaire_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("questions").delete().eq("id", String(formData.get("id")));
  redirect(withMessage(editor(qnId), error ? "error" : "msg", error ? friendly(error.message) : "Question deleted. Check the rules that used it."));
}

export async function saveRule(formData: FormData) {
  const qnId = String(formData.get("questionnaire_id"));
  const rid = String(formData.get("id") ?? "");
  const back = editor(qnId);
  const kind = String(formData.get("kind"));
  const conditions = [0, 1, 2].map((i) => conditionFrom(formData, `c${i}_`)).filter((c): c is Condition => c !== null);
  const qty = String(formData.get("quantity_question_key") ?? "");
  const row = {
    questionnaire_id: qnId,
    kind,
    conditions,
    item_code: kind === "add_item" ? String(formData.get("item_code") ?? "") || null : null,
    quantity_question_key: kind === "add_item" && qty ? qty : null,
    message: kind === "add_item" ? "" : String(formData.get("message") ?? "").trim(),
    sort_order: Math.trunc(Number(formData.get("sort_order") ?? 0)) || 0,
  };
  if (conditions.length === 0) redirect(withMessage(`${back}/rule/${rid || "new"}`, "error", "Add at least one condition."));
  const supabase = await createClient();
  const { error } = rid
    ? await supabase.from("rules").update(row).eq("id", rid)
    : await supabase.from("rules").insert(row);
  if (error) {
    const text = error.message.includes("rules_check") ? "A price rule needs an item. Other rules need a message." : friendly(error.message);
    redirect(withMessage(`${back}/rule/${rid || "new"}`, "error", text));
  }
  redirect(withMessage(back, "msg", rid ? "Rule saved." : "Rule added."));
}

export async function deleteRule(formData: FormData) {
  const qnId = String(formData.get("questionnaire_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("rules").delete().eq("id", String(formData.get("id")));
  redirect(withMessage(editor(qnId), error ? "error" : "msg", error ? friendly(error.message) : "Rule deleted."));
}
