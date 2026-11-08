"use client";

import { startTransition, useActionState, useState } from "react";
import {
  PROVINCES, isVisible, personCount, formatCents,
  type Answer, type Answers, type Question, type Questionnaire, type Result,
} from "@/lib/screening/engine";

export type FormQuestionnaire = Questionnaire & { title: string; intro: string };
type Action = (prev: Result | null, formData: FormData) => Promise<Result | null>;

const PERSON_LABEL = ["You", "Your spouse or partner"];

// Renders a screening questionnaire. Questions appear and disappear as answers change.
// The answers are sent to `action` as JSON; the server checks and prices them again.
export function ScreeningForm({ qn, action, submitLabel, showPrices }: { qn: FormQuestionnaire; action: Action; submitLabel: string; showPrices: boolean }) {
  const [household, setHousehold] = useState<Record<string, Answer>>({});
  const [people, setPeople] = useState<Record<string, Answer>[]>([{}, {}]);
  const [result, formAction, pending] = useActionState(action, null);

  const sorted = [...qn.questions].sort((a, b) => a.sort_order - b.sort_order);
  const count = personCount(qn, household);
  const answers: Answers = { household, people: people.slice(0, count) };

  const sections: { name: string; questions: Question[] }[] = [];
  for (const q of sorted) {
    const last = sections.at(-1);
    if (last && last.name === q.section) last.questions.push(q);
    else sections.push({ name: q.section, questions: [q] });
  }

  const errorFor = (key: string, person: number | null) =>
    result?.errors.find((e) => e.key === key && e.person === person)?.message;

  return (
    // Submitted by hand (not the form "action" prop) so React does not clear the answers on screen.
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <input type="hidden" name="answers" value={JSON.stringify(answers)} />
      <div>
        <h2 className="text-xl font-semibold">{qn.title}</h2>
        {qn.intro && <p className="mt-1 text-sm text-muted">{qn.intro}</p>}
      </div>

      {sections.map((s) => (
        <fieldset key={s.name} className="card space-y-5">
          {s.name && <legend className="px-1 font-semibold">{s.name}</legend>}
          {s.questions.map((q) => {
            if (!q.per_person) {
              if (!isVisible(q, household)) return null;
              return (
                <Field key={q.key} q={q} idSuffix="h" value={household[q.key]} error={errorFor(q.key, null)}
                  onChange={(v) => setHousehold((h) => ({ ...h, [q.key]: v }))} />
              );
            }
            return (
              <div key={q.key} className={count > 1 ? "grid gap-4 md:grid-cols-2" : ""}>
                {[...Array(count).keys()].map((i) => {
                  const scope = { ...household, ...people[i] };
                  if (!isVisible(q, scope)) return null;
                  return (
                    <Field key={i} q={q} idSuffix={`p${i}`} personLabel={count > 1 ? PERSON_LABEL[i] : undefined}
                      value={people[i][q.key]} error={errorFor(q.key, i)}
                      onChange={(v) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, [q.key]: v } : p)))} />
                  );
                })}
              </div>
            );
          })}
        </fieldset>
      ))}

      {result && result.errors.length > 0 && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Please check the answers marked in red.
        </p>
      )}

      <button type="submit" className="btn" disabled={pending}>{pending ? "Checking..." : submitLabel}</button>

      {showPrices && result && result.errors.length === 0 && <ResultPanel result={result} />}
    </form>
  );
}

function Field({ q, value, onChange, error, idSuffix, personLabel }: {
  q: Question; value: Answer; onChange: (v: Answer) => void; error?: string; idSuffix: string; personLabel?: string;
}) {
  const id = `${q.key}-${idSuffix}`;
  const label = (
    <span className="label">
      {personLabel && <span className="mr-1 rounded bg-background px-1.5 py-0.5 text-xs text-muted">{personLabel}</span>}
      {q.prompt}{!q.required && <span className="font-normal text-muted"> (optional)</span>}
    </span>
  );
  const help = q.help_text ? <span className="mb-2 block text-xs text-muted">{q.help_text}</span> : null;
  const err = error ? <span className="mt-1 block text-sm text-danger">{error}</span> : null;
  const v = value === null || value === undefined ? "" : String(value);

  if (q.answer_type === "yes_no" || q.answer_type === "single_choice") {
    const options = q.answer_type === "yes_no" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : q.options;
    return (
      <div role="radiogroup" aria-labelledby={`${id}-label`}>
        <span id={`${id}-label`}>{label}</span>
        {help}
        <div className={q.answer_type === "yes_no" ? "flex gap-4" : "space-y-2"}>
          {options.map((o) => (
            <label key={o.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name={id} value={o.value} checked={v === o.value} onChange={() => onChange(o.value)} className="mt-0.5 h-4 w-4 accent-accent" />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        {err}
      </div>
    );
  }
  if (q.answer_type === "province") {
    return (
      <label htmlFor={id} className="block">
        {label}{help}
        <select id={id} value={v} onChange={(e) => onChange(e.target.value)} className="input max-w-sm">
          <option value="">Choose</option>
          {PROVINCES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {err}
      </label>
    );
  }
  return (
    <label htmlFor={id} className="block">
      {label}{help}
      <input
        id={id}
        type={q.answer_type === "number" ? "number" : q.answer_type === "email" ? "email" : q.answer_type === "phone" ? "tel" : "text"}
        inputMode={q.answer_type === "number" ? "numeric" : undefined}
        min={q.min_value ?? undefined}
        max={q.max_value ?? undefined}
        value={v}
        onChange={(e) => onChange(q.answer_type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
        className={q.answer_type === "number" ? "input max-w-[8rem]" : "input"}
      />
      {err}
    </label>
  );
}

function ResultPanel({ result }: { result: Result }) {
  if (result.outOfScope.length > 0) {
    return (
      <div className="card border-danger/30">
        <h3 className="mb-2 font-semibold">Out of scope: no quote</h3>
        <p className="mb-2 text-sm text-muted">The lead would be flagged for an owner. Reasons:</p>
        <ul className="list-disc pl-5 text-sm">
          {result.outOfScope.map((o, i) => <li key={i}>{o.reason}{o.person !== null && result.personCount > 1 ? ` (${PERSON_LABEL[o.person]})` : ""}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto p-0">
      <h3 className="px-5 pt-4 pb-2 font-semibold">Quote preview (before tax)</h3>
      <table className="table">
        <thead><tr><th>Service</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {result.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}{l.person !== null && result.personCount > 1 ? <span className="text-muted"> ({PERSON_LABEL[l.person]})</span> : ""}<span className="block text-xs text-muted">{l.unit_label}</span></td>
              <td className="text-right">{l.quantity}</td>
              <td className="text-right">{formatCents(l.unit_cents)}</td>
              <td className="text-right">{formatCents(l.total_cents)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="text-right font-semibold">Total before tax</td>
            <td className="text-right font-semibold">{formatCents(result.subtotal_cents)}</td>
          </tr>
        </tbody>
      </table>
      <p className="px-5 py-3 text-xs text-muted">HST by province is added on the quote. Tax rates are the next step.</p>
    </div>
  );
}
