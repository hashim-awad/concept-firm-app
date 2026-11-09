import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Notice } from "@/components/ui";
import { ConditionFields } from "@/components/condition-fields";
import { requireAccess, canEdit } from "@/lib/access";
import { messageFrom } from "@/lib/messages";
import { loadQuestionnaire } from "@/lib/screening/load";
import { ANSWER_TYPES } from "@/lib/screening/describe";
import { saveQuestion, deleteQuestion } from "../../../actions";

export default async function QuestionPage({ params, searchParams }: PageProps<"/admin/screening/[id]/question/[qid]">) {
  const access = await requireAccess("price_book", "view");
  const { id, qid } = await params;
  const sp = await searchParams;
  const qn = await loadQuestionnaire(id);
  if (!qn) notFound();
  const isNew = qid === "new";
  const q = isNew ? null : qn.questions.find((x) => x.id === qid);
  if (!isNew && !q) notFound();
  const editable = canEdit(access, "price_book") && qn.row.status === "draft";
  const earlier = qn.questions.filter((x) => x.id !== qid && (!q || x.sort_order < q.sort_order));
  const nextOrder = (qn.questions.at(-1)?.sort_order ?? 0) + 10;

  return (
    <>
      <p className="mb-2 text-sm"><Link href={`/admin/screening/${id}`} className="text-accent underline">Back to version {qn.row.version}</Link></p>
      <PageHeader title={isNew ? "Add a question" : "Question"} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveQuestion} className="card">
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="questionnaire_id" value={id} />
          {q && <input type="hidden" name="id" value={q.id} />}
          <div>
            <label htmlFor="key" className="label">Key</label>
            <input id="key" name="key" defaultValue={q?.key} required={isNew} disabled={!isNew} pattern="[a-z][a-z0-9_]{1,40}" className="input" />
            <p className="mt-1 text-xs text-muted">Short ID used by rules, for example rental_count. Cannot change after adding.</p>
          </div>
          <div>
            <label htmlFor="sort_order" className="label">Order</label>
            <input id="sort_order" name="sort_order" type="number" defaultValue={q?.sort_order ?? nextOrder} className="input" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="prompt" className="label">Question shown to clients</label>
            <input id="prompt" name="prompt" defaultValue={q?.prompt} required maxLength={300} className="input" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="help_text" className="label">Help text (optional)</label>
            <textarea id="help_text" name="help_text" defaultValue={q?.help_text} rows={2} maxLength={500} className="input" />
          </div>
          <div>
            <label htmlFor="section" className="label">Section heading</label>
            <input id="section" name="section" defaultValue={q?.section} maxLength={60} className="input" />
          </div>
          <div>
            <label htmlFor="answer_type" className="label">Answer type</label>
            <select id="answer_type" name="answer_type" defaultValue={q?.answer_type ?? "yes_no"} className="input">
              {ANSWER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="options" className="label">Choices (for &ldquo;Choose one&rdquo; only)</label>
            <textarea id="options" name="options" rows={4} className="input font-mono text-xs"
              defaultValue={(q?.options ?? []).map((o) => `${o.value} | ${o.label}`).join("\n")}
              placeholder={"none | None, or under $100,000\nsimple | $100,000 to $249,999"} />
            <p className="mt-1 text-xs text-muted">One per line: value | label. Rules use the value; clients see the label.</p>
          </div>
          <div>
            <label htmlFor="min_value" className="label">Lowest number allowed</label>
            <input id="min_value" name="min_value" type="number" defaultValue={q?.min_value ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="max_value" className="label">Highest number allowed</label>
            <input id="max_value" name="max_value" type="number" defaultValue={q?.max_value ?? ""} className="input" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="required" type="checkbox" defaultChecked={q?.required ?? true} className="h-4 w-4 accent-accent" /> Answer required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="per_person" type="checkbox" defaultChecked={q?.per_person ?? false} className="h-4 w-4 accent-accent" /> Ask each person (both spouses when a couple files)
          </label>
          <div className="md:col-span-2">
            <p className="label">Only show this question when (optional)</p>
            <ConditionFields prefix="show_" questions={earlier} value={q?.show_if} disabled={!editable} />
          </div>
          {editable && <div className="md:col-span-2"><button type="submit" className="btn">{isNew ? "Add question" : "Save question"}</button></div>}
        </fieldset>
      </form>
      {editable && q && (
        <form action={deleteQuestion} className="mt-6">
          <input type="hidden" name="questionnaire_id" value={id} />
          <input type="hidden" name="id" value={q.id} />
          <button type="submit" className="btn-danger">Delete question</button>
        </form>
      )}
    </>
  );
}
