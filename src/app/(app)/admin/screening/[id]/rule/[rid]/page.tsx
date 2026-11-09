import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Notice } from "@/components/ui";
import { ConditionFields } from "@/components/condition-fields";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { messageFrom } from "@/lib/messages";
import { loadQuestionnaire, loadCurrentItems } from "@/lib/screening/load";
import { formatCents } from "@/lib/screening/engine";
import { saveRule, deleteRule } from "../../../actions";

export default async function RulePage({ params, searchParams }: PageProps<"/admin/screening/[id]/rule/[rid]">) {
  const access = await requireAccess("price_book", "view");
  const { id, rid } = await params;
  const sp = await searchParams;
  const qn = await loadQuestionnaire(id);
  if (!qn) notFound();
  const isNew = rid === "new";
  const r = isNew ? null : qn.rules.find((x) => x.id === rid);
  if (!isNew && !r) notFound();
  const editable = canEdit(access, "price_book") && qn.row.status === "draft";
  const showPrices = canView(access, "pricing");
  const items = (await loadCurrentItems()).filter((i) => i.is_active || i.code === r?.item_code);
  const numberQuestions = qn.questions.filter((q) => q.answer_type === "number");
  const nextOrder = (qn.rules.at(-1)?.sort_order ?? 0) + 10;

  return (
    <>
      <p className="mb-2 text-sm"><Link href={`/admin/screening/${id}`} className="text-accent underline">Back to version {qn.row.version}</Link></p>
      <PageHeader title={isNew ? "Add a rule" : "Rule"} description="When all the conditions are true, the rule applies. A rule that uses an 'each person' question is checked for each spouse." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveRule} className="card">
        <fieldset disabled={!editable} className="space-y-5">
          <input type="hidden" name="questionnaire_id" value={id} />
          {r && <input type="hidden" name="id" value={r.id} />}
          <div className="grid gap-3 md:grid-cols-[1fr_10rem]">
            <div>
              <label htmlFor="kind" className="label">Type of rule</label>
              <select id="kind" name="kind" defaultValue={r?.kind ?? "add_item"} className="input">
                <option value="add_item">Price: add an item to the quote</option>
                <option value="out_of_scope">Out of scope: no quote, flag for an owner</option>
                <option value="check">Check: stop the form and show a message</option>
              </select>
            </div>
            <div>
              <label htmlFor="sort_order" className="label">Order</label>
              <input id="sort_order" name="sort_order" type="number" defaultValue={r?.sort_order ?? nextOrder} className="input" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="label">When (all must be true)</p>
            {[0, 1, 2].map((i) => <ConditionFields key={i} prefix={`c${i}_`} questions={qn.questions} value={r?.conditions[i]} disabled={!editable} />)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="item_code" className="label">Price rule: item to add</label>
              <select id="item_code" name="item_code" defaultValue={r?.item_code ?? ""} className="input">
                <option value="">(choose an item)</option>
                {items.map((i) => <option key={i.code} value={i.code}>{i.name}{showPrices ? ` (${formatCents(i.amount_cents)})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="quantity_question_key" className="label">Price rule: how many</label>
              <select id="quantity_question_key" name="quantity_question_key" defaultValue={r?.quantity_question_key ?? ""} className="input">
                <option value="">One</option>
                {numberQuestions.map((q) => <option key={q.key} value={q.key}>The answer to “{q.prompt}”</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="message" className="label">Out of scope reason, or check message</label>
            <input id="message" name="message" defaultValue={r?.message} maxLength={200} className="input" />
          </div>
          {editable && <button type="submit" className="btn">{isNew ? "Add rule" : "Save rule"}</button>}
        </fieldset>
      </form>
      {editable && r && (
        <form action={deleteRule} className="mt-6">
          <input type="hidden" name="questionnaire_id" value={id} />
          <input type="hidden" name="id" value={r.id} />
          <button type="submit" className="btn-danger">Delete rule</button>
        </form>
      )}
    </>
  );
}
