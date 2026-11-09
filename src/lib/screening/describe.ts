import type { Condition, Question } from "./engine";

export const OPS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "is", needsValue: true },
  { value: "neq", label: "is not", needsValue: true },
  { value: "gt", label: "is more than", needsValue: true },
  { value: "gte", label: "is at least", needsValue: true },
  { value: "lt", label: "is less than", needsValue: true },
  { value: "lte", label: "is at most", needsValue: true },
  { value: "gt_question", label: "is more than the answer to", needsValue: true },
  { value: "answered", label: "is answered", needsValue: false },
  { value: "not_answered", label: "is not answered", needsValue: false },
];

export const ANSWER_TYPES: { value: string; label: string }[] = [
  { value: "yes_no", label: "Yes or no" },
  { value: "number", label: "Number" },
  { value: "single_choice", label: "Choose one" },
  { value: "province", label: "Province or territory" },
  { value: "text", label: "Short text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

function valueLabel(q: Question | undefined, v: unknown) {
  if (q?.answer_type === "single_choice") return q.options.find((o) => o.value === String(v))?.label ?? String(v);
  return String(v);
}

export function describeCondition(c: Condition, questions: Question[]) {
  const q = questions.find((x) => x.key === c.question);
  const name = q ? `“${q.prompt}”` : `[missing question ${c.question}]`;
  const op = OPS.find((o) => o.value === c.op)?.label ?? c.op;
  if (c.op === "answered" || c.op === "not_answered") return `${name} ${op}`;
  if (c.op === "gt_question") {
    const other = questions.find((x) => x.key === String(c.value));
    return `${name} ${op} ${other ? `“${other.prompt}”` : String(c.value)}`;
  }
  return `${name} ${op} ${valueLabel(q, c.value)}`;
}
