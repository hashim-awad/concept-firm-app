import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Meta } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { LEAD_STATUS, provinceName } from "@/lib/leads/provinces";
import { updateLead } from "../actions";

export default async function LeadPage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const access = await requireAccess("leads", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: l }, { data: staff }, { data: src }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("settings").select("value").eq("key", "lead_sources").maybeSingle(),
  ]);
  if (!l) notFound();
  const editable = canEdit(access, "leads");
  const sources = Array.from(new Set([...(((src?.value as string[] | undefined) ?? ["Website"])), l.source]));
  const answers = Object.entries((l.answers ?? {}) as Record<string, unknown>);
  return (
    <>
      <PageHeader eyebrow={l.route === "personal" ? "Lead · Personal tax" : "Lead · Company"} title={`${l.first_name} ${l.last_name}`} description={`Received ${formatDateTime(l.created_at)} · ${LEAD_STATUS[l.status] ?? l.status}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-6">
          <section className="card">
            <h2 className="mb-3 font-semibold">What the client sent</h2>
            <Meta items={[
              { label: "Email", value: <a href={`mailto:${l.email}`} className="text-navy-700 underline">{l.email}</a> },
              ...(l.phone ? [{ label: "Phone", value: <a href={`tel:${l.phone}`} className="text-navy-700 underline">{l.phone}</a> }] : []),
              { label: "Province", value: provinceName(l.province) },
            ]} />
            {answers.length > 0 ? (
              <dl className="mt-4 grid gap-2 text-sm">{answers.map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd></div>)}</dl>
            ) : <p className="mt-4 text-sm text-muted">The screening questions arrive with Phase 2 steps 6 (personal) and 9 (company).</p>}
          </section>
        </div>
        <form action={updateLead} className="card grid content-start gap-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={!editable} className="grid gap-4">
            <div><label htmlFor="status" className="label">Status</label>
              <select id="status" name="status" defaultValue={l.status} className="input">{Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label htmlFor="assigned_to" className="label">Assigned to</label>
              <select id="assigned_to" name="assigned_to" defaultValue={l.assigned_to ?? ""} disabled={!access.is_owner} className="input">
                <option value="">Unassigned</option>{(staff ?? []).map((s: { id: string; full_name: string }) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              {!access.is_owner && <span className="text-xs text-muted">Only an owner can reassign.</span>}</div>
            <div><label htmlFor="source" className="label">Source</label>
              <select id="source" name="source" defaultValue={l.source} className="input">{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div><label htmlFor="notes" className="label">Notes (staff only)</label><textarea id="notes" name="notes" defaultValue={l.notes} rows={4} className="input" /></div>
            {editable && <button type="submit" className="btn w-fit">Save</button>}
          </fieldset>
          <p className="text-xs text-muted">Lost and out-of-scope leads are deleted automatically 24 months after they close (Settings, Retention).</p>
        </form>
      </div>
    </>
  );
}
