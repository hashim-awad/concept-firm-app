import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatCents, type Answer, type Question } from "@/lib/screening/engine";
import { readT1Rules, withRuleValues } from "@/lib/screening/server";

type Stored = {
  questionnaire_id?: string; version?: number; household?: Record<string, Answer>; people?: Record<string, Answer>[];
  out_of_scope?: { reason: string; person: number | null }[]; consent_at?: string | null;
};
type QLine = { code: string; name: string; unit_label: string; person: number | null; quantity: number; unit_cents: number; total_cents: number };

const WHO = ["You", "Spouse or partner"];

function show(q: Question, v: Answer): string {
  if (v === null || v === undefined || v === "") return "";
  if (q.answer_type === "yes_no") return v === "yes" ? "Yes" : "No";
  if (q.answer_type === "single_choice") return q.options.find((o) => o.value === String(v))?.label ?? String(v);
  return String(v);
}

// What the client answered, in question order, with the out-of-scope reasons. Lead viewers see this.
export async function LeadAnswers({ answers }: { answers: Stored }) {
  if (!answers.questionnaire_id) return <p className="mt-4 text-sm text-muted">No screening answers. Company questions arrive with Phase 2 step 9.</p>;
  const { data } = await createAdminClient().from("questions").select("key, section, prompt, help_text, answer_type, options, per_person, sort_order")
    .eq("questionnaire_id", answers.questionnaire_id).order("sort_order");
  const questions = withRuleValues((data ?? []) as Question[], await readT1Rules());
  const h = answers.household ?? {}, people = answers.people ?? [];
  const rows = questions.map((q) => {
    const value = q.per_person
      ? people.map((p, i) => [p[q.key], i] as const).filter(([v]) => v !== undefined && v !== null && v !== "").map(([v, i]) => (people.length > 1 ? `${WHO[i]}: ${show(q, v)}` : show(q, v))).join(" · ")
      : show(q, h[q.key]);
    return { q, value };
  }).filter((r) => r.value);
  return (
    <div className="mt-4 grid gap-3">
      {(answers.out_of_scope ?? []).length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
          <p className="font-medium">Out of scope: no quote. Review and contact the client.</p>
          <ul className="mt-1 list-disc pl-5">{answers.out_of_scope!.map((o, i) => <li key={i}>{o.reason}{o.person !== null && people.length > 1 ? ` (${WHO[o.person]})` : ""}</li>)}</ul>
        </div>
      )}
      <dl className="grid gap-2 text-sm">
        {rows.map(({ q, value }) => <div key={q.key}><dt className="text-muted">{q.prompt}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="text-xs text-muted">Screening version {answers.version}.{answers.consent_at ? " The client agreed to us using the answers to prepare a quote." : ""}</p>
    </div>
  );
}

// The quote worked out from the answers, line by line. Only people with Pricing can read it
// (the database refuses everyone else). Clients never see this breakdown.
export async function LeadQuote({ leadId, people }: { leadId: string; people: number }) {
  const supabase = await createClient();
  const { data } = await supabase.from("lead_quotes").select("lines, subtotal_cents").eq("lead_id", leadId).maybeSingle();
  if (!data) return null;
  const lines = data.lines as QLine[];
  return (
    <section className="card overflow-x-auto p-0">
      <h2 className="px-5 pt-4 pb-2 font-semibold">Quote from the answers (before GST/HST)</h2>
      <table className="table">
        <thead><tr><th>Service</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}{l.person !== null && people > 1 ? <span className="text-muted"> ({WHO[l.person]})</span> : ""}<span className="block text-xs text-muted">{l.code} · {l.unit_label}</span></td>
              <td className="text-right">{l.quantity}</td><td className="text-right">{formatCents(l.unit_cents)}</td><td className="text-right">{formatCents(l.total_cents)}</td>
            </tr>
          ))}
          <tr><td colSpan={3} className="text-right font-semibold">Total before GST/HST</td><td className="text-right font-semibold">{formatCents(data.subtotal_cents)}</td></tr>
        </tbody>
      </table>
      <p className="px-5 py-3 text-xs text-muted">Staff only, Pricing permission. The client sees the services and one total, never this breakdown.</p>
    </section>
  );
}
