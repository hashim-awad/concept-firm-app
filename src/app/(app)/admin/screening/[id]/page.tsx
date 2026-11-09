import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { loadQuestionnaire, loadCurrentItems } from "@/lib/screening/load";
import { describeCondition, ANSWER_TYPES } from "@/lib/screening/describe";
import { formatCents } from "@/lib/screening/engine";
import { publish, saveHeader } from "../actions";

const KIND_LABEL = { add_item: "Price", out_of_scope: "Out of scope", check: "Check" } as const;

export default async function EditorPage({ params, searchParams }: PageProps<"/admin/screening/[id]">) {
  const access = await requireAccess("price_book", "view");
  const { id } = await params;
  const sp = await searchParams;
  const qn = await loadQuestionnaire(id);
  if (!qn) notFound();
  const isDraft = qn.row.status === "draft";
  const editable = canEdit(access, "price_book") && isDraft;
  const showPrices = canView(access, "pricing");
  const items = await loadCurrentItems();
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  const supabase = await createClient();
  const { data: problems } = await supabase.rpc("questionnaire_problems", { p_id: id });
  const typeLabel = new Map(ANSWER_TYPES.map((t) => [t.value, t.label]));

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/screening" className="text-accent underline">Screening questions</Link></p>
      <PageHeader
        title={`${qn.row.route === "personal" ? "Personal" : "Corporate"}, version ${qn.row.version}`}
        description={isDraft ? "Draft. Clients do not see this until it is published." : qn.row.status === "published" ? "Live. To change it, start a new draft from the Screening page." : "Retired. Kept as a record."}
        actions={<Link href={`/admin/screening/${id}/try`} className="btn-secondary">Try it</Link>}
      />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      {isDraft && (problems ?? []).length > 0 && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <p className="mb-1 font-medium">Fix before publishing:</p>
          <ul className="list-disc pl-5">{(problems as string[]).map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <form action={saveHeader} className="card mb-6">
        <fieldset disabled={!editable} className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="id" value={id} />
          <div className="md:col-span-2">
            <label htmlFor="title" className="label">Title shown to clients</label>
            <input id="title" name="title" defaultValue={qn.row.title} required maxLength={120} className="input" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="intro" className="label">Intro shown to clients</label>
            <textarea id="intro" name="intro" defaultValue={qn.row.intro} rows={2} maxLength={500} className="input" />
          </div>
          <div>
            <label htmlFor="couple_question_key" className="label">Question that asks if a couple is filing</label>
            <select id="couple_question_key" name="couple_question_key" defaultValue={qn.row.couple_question_key ?? ""} className="input">
              <option value="">None (one person or a corporation)</option>
              {qn.questions.filter((q) => !q.per_person).map((q) => <option key={q.key} value={q.key}>{q.prompt}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="couple_value" className="label">Answer that means a couple</label>
            <input id="couple_value" name="couple_value" defaultValue={qn.row.couple_value ?? ""} className="input" />
            <p className="mt-1 text-xs text-muted">Questions marked &ldquo;each person&rdquo; are then asked for both spouses.</p>
          </div>
          {editable && <div className="md:col-span-2"><button type="submit" className="btn-secondary">Save details</button></div>}
        </fieldset>
      </form>

      <section className="card mb-6 overflow-x-auto p-0">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-semibold">Questions</h2>
          {editable && <Link href={`/admin/screening/${id}/question/new`} className="btn-secondary">Add question</Link>}
        </div>
        <table className="table">
          <thead><tr><th>#</th><th>Question</th><th>Answer</th><th>Asked</th><th>Shown when</th><th></th></tr></thead>
          <tbody>
            {qn.questions.map((q) => (
              <tr key={q.id}>
                <td className="text-muted">{q.sort_order}</td>
                <td><span className="font-medium">{q.prompt}</span><span className="block text-xs text-muted">{q.section} · {q.key}{q.required ? "" : " · optional"}</span></td>
                <td className="whitespace-nowrap">{typeLabel.get(q.answer_type)}</td>
                <td className="whitespace-nowrap">{q.per_person ? "Each person" : "Once"}</td>
                <td className="text-muted">{q.show_if ? describeCondition(q.show_if, qn.questions) : "Always"}</td>
                <td className="text-right"><Link href={`/admin/screening/${id}/question/${q.id}`} className="btn-secondary">{editable ? "Edit" : "View"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card mb-6 overflow-x-auto p-0">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-semibold">Rules</h2>
          {editable && <Link href={`/admin/screening/${id}/rule/new`} className="btn-secondary">Add rule</Link>}
        </div>
        <table className="table">
          <thead><tr><th>Type</th><th>When</th><th>Then</th><th></th></tr></thead>
          <tbody>
            {qn.rules.map((r) => {
              const item = r.item_code ? itemByCode.get(r.item_code) : undefined;
              const qtyQ = r.quantity_question_key ? qn.questions.find((q) => q.key === r.quantity_question_key) : undefined;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{KIND_LABEL[r.kind]}</td>
                  <td className="text-muted">{r.conditions.map((c) => describeCondition(c, qn.questions)).join(" and ")}</td>
                  <td>
                    {r.kind === "add_item"
                      ? `Add ${item ? `${item.name}${showPrices ? ` (${formatCents(item.amount_cents)})` : ""}` : r.item_code}${qtyQ ? `, times the answer to “${qtyQ.prompt}”` : ""}`
                      : r.kind === "out_of_scope" ? `No quote. Flag for an owner: ${r.message}` : `Stop and show: ${r.message}`}
                  </td>
                  <td className="text-right"><Link href={`/admin/screening/${id}/rule/${r.id}`} className="btn-secondary">{editable ? "Edit" : "View"}</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {editable && (
        <form action={publish} className="card">
          <input type="hidden" name="id" value={id} />
          <h2 className="mb-1 font-semibold">Publish</h2>
          <p className="mb-3 text-sm text-muted">Publishing replaces the live version. Leads already made keep the version they answered.</p>
          <button type="submit" className="btn" disabled={(problems ?? []).length > 0}>Publish version {qn.row.version}</button>
        </form>
      )}
    </>
  );
}
