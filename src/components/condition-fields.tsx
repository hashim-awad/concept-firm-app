import type { Condition, Question } from "@/lib/screening/engine";
import { OPS } from "@/lib/screening/describe";

// One condition row: [question] [comparison] [value]. Plain form fields named <prefix>question etc.
export function ConditionFields({ prefix, questions, value, disabled }: { prefix: string; questions: Question[]; value?: Condition | null; disabled?: boolean }) {
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_12rem_12rem]">
      <select name={`${prefix}question`} defaultValue={value?.question ?? ""} disabled={disabled} className="input" aria-label="Question">
        <option value="">(no condition)</option>
        {questions.map((q) => <option key={q.key} value={q.key}>{q.prompt} [{q.key}]</option>)}
      </select>
      <select name={`${prefix}op`} defaultValue={value?.op ?? "eq"} disabled={disabled} className="input" aria-label="Comparison">
        {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input name={`${prefix}value`} defaultValue={value?.value === undefined ? "" : String(value.value)} disabled={disabled} className="input" aria-label="Value" placeholder="yes, no, 0, a choice value, or a question key" />
    </div>
  );
}
