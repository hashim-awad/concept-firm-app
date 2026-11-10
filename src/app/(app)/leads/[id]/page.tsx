import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Meta } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { LEAD_STATUS, provinceName } from "@/lib/leads/provinces";
import { sendAlertNow, updateLead } from "../actions";
import { leadAlertStatus, readBusinessHours } from "@/lib/leads/alerts";
import { WAITING_STATUSES } from "@/lib/business-hours";
import { LeadTimer } from "../lead-timer";
import { LeadAnswers, LeadQuote } from "./answers";
import { CompanyAnswers } from "./company-answers";

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
  return (
    <>
      <PageHeader eyebrow={l.route === "personal" ? "Lead · Personal tax" : "Lead · Company"} title={`${l.first_name} ${l.last_name}`} description={`Received ${formatDateTime(l.created_at)} · ${LEAD_STATUS[l.status] ?? l.status}`} />
      {WAITING_STATUSES.includes(l.status) && <p className="-mt-2 mb-4 text-sm"><LeadTimer since={l.created_at} hours={await readBusinessHours()} /> <span className="text-muted">for the quote to be sent. A reminder email goes to everyone with Pricing at 45 business minutes.</span></p>}
      {access.is_owner && (
        <form action={sendAlertNow} className="-mt-2 mb-4">
          <input type="hidden" name="id" value={l.id} />
          <button type="submit" className="btn-secondary h-8 px-3 text-sm" title="Owners: send the new-lead email to everyone with Pricing now and see the result">Send alert email now</button>
        </form>
      )}
      {(await leadAlertStatus(l.id)).filter((x) => x.error !== "before alerts existed").map((x) => (
        <p key={x.kind} className={`-mt-2 mb-4 text-sm ${x.sent_at ? "text-muted" : "text-danger"}`}>
          {x.kind === "new" ? "Alert email" : "Reminder email"}: {x.sent_at ? `sent to ${x.recipients} ${x.recipients === 1 ? "person" : "people"} ${formatDateTime(x.sent_at)}.` : `not sent yet. Reason: ${x.error || "sending now"}. The app tries again every 5 minutes.`}
        </p>
      ))}
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
            {l.route === "company"
              ? <CompanyAnswers answers={(l.answers ?? {}) as Parameters<typeof CompanyAnswers>[0]["answers"]} yearEnd={l.year_end} />
              : <LeadAnswers answers={(l.answers ?? {}) as Parameters<typeof LeadAnswers>[0]["answers"]} />}
          </section>
          <LeadQuote leadId={l.id} people={Array.isArray(l.answers?.people) ? l.answers.people.length : 1} canPrepare={canEdit(access, "pricing") && canEdit(access, "leads")} route={l.route} />
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
            {l.route === "company" && (
              <>
                <div><label htmlFor="company_name" className="label">Company legal name</label>
                  <input id="company_name" name="company_name" defaultValue={l.company_name} maxLength={200} className="input" />
                  <span className="text-xs text-muted">The form does not ask for it. A quote cannot be issued without it.</span></div>
                <div><label htmlFor="year_end" className="label">Year-end (confirmed)</label>
                  <input id="year_end" name="year_end" type="date" defaultValue={l.year_end ?? ""} className="input" />
                  <span className="text-xs text-muted">The year-end this quote is for.</span></div>
                {l.status === "signed" && (
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="first_year_tag_done" defaultChecked={l.first_year_tag_done} className="mt-0.5 h-4 w-4 accent-navy-700" />
                    <span>Added the TaxDome tag <code>1st-yr client</code> to the client&rsquo;s account</span></label>
                )}
              </>
            )}
            <div><label htmlFor="notes" className="label">Notes (staff only)</label><textarea id="notes" name="notes" defaultValue={l.notes} rows={4} className="input" /></div>
            {editable && <button type="submit" className="btn w-fit">Save</button>}
          </fieldset>
          <p className="text-xs text-muted">Lost and out-of-scope leads are deleted automatically 24 months after they close (Settings, Retention).</p>
        </form>
      </div>
    </>
  );
}
