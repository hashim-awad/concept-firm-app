import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Meta } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { updateEngagement } from "../../history-actions";

const PAY = ["", "PAD pending", "PAD active", "Plooto one-time", "TaxDome portal", "TaxDome payment link"];

export default async function EngagementPage({ params, searchParams }: PageProps<"/documents/engagements/[id]">) {
  const access = await requireAccess("documents", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: e } = await supabase.from("engagements").select("id, title, type, status, el_version, el_issued, el_signed, fiscal_year_end, registration_confirmed, payment_method, cra_authorization, cra_request_date, notes, created_at, came_from, clients!engagements_client_id_fkey(id, legal_name, province)").eq("id", id).maybeSingle();
  if (!e) notFound();
  // Fees only with the Pricing permission (Phase 2 batch, section 2).
  const pricing = canView(access, "pricing");
  const fees = pricing ? ((await supabase.rpc("engagement_fees", { p_id: id })).data?.[0] as { fee: number | null; monthly_fee: number | null; letter_data: unknown } | undefined) : undefined;
  // Front office batch, section 9: Update is for owners.
  const editable = access.is_owner && canEdit(access, "documents");
  const client = e.clients as unknown as { id: string; legal_name: string; province: string } | null;
  const abbc = client && (client.province === "AB" || client.province === "BC");
  const { data: docs } = await supabase.from("documents").select("id, title, current_version, status").eq("engagement_id", id);
  const t1 = e.type === "T1 personal";
  return (
    <>
      <PageHeader eyebrow="Engagement" title={e.title} description={`${e.type} · ${e.status}${e.el_version ? " · " + e.el_version : ""}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form action={updateEngagement} className="card space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="el_issued" className="label">EL issued</label><input id="el_issued" name="el_issued" type="date" defaultValue={e.el_issued ?? ""} className="input" /></div>
              <div><label htmlFor="el_signed" className="label">EL signed</label><input id="el_signed" name="el_signed" type="date" defaultValue={e.el_signed ?? ""} className="input" /></div>
            </div>
            {abbc && (<>
              <input type="hidden" name="has_registration" value="1" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="registration_confirmed" defaultChecked={e.registration_confirmed} className="h-4 w-4 accent-navy-700" /> {client!.province} registration position confirmed in writing</label>
            </>)}
            {t1 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor="cra" className="label">CRA authorization (Level 2)</label>
                  <select id="cra" name="cra_authorization" defaultValue={e.cra_authorization || "Requested"} className="input">{["Requested", "Confirmed", "Not needed"].map((o) => <option key={o}>{o}</option>)}</select></div>
                <div><label htmlFor="cra_date" className="label">CRA request date</label><input id="cra_date" name="cra_request_date" type="date" defaultValue={e.cra_request_date ?? ""} className="input" /></div>
              </div>
            ) : (
              <div><label htmlFor="pay" className="label">Payment method</label>
                <select id="pay" name="payment_method" defaultValue={e.payment_method ?? ""} className="input">{PAY.map((o) => <option key={o} value={o}>{o || "Not set"}</option>)}</select></div>
            )}
            <div><label htmlFor="set_status" className="label">Status</label>
              <select id="set_status" name="set_status" defaultValue={["On hold", "Client left", "Ended", "Cancelled"].includes(e.status) ? e.status : ""} className="input">
                <option value="">Follows the letter (Waiting for signature, then Active)</option>
                <option>On hold</option><option>Client left</option><option>Ended</option><option>Cancelled</option>
              </select></div>
            <div><label htmlFor="notes" className="label">Notes</label><textarea id="notes" name="notes" defaultValue={e.notes} className="input min-h-28 py-2" /></div>
            {editable && <button className="btn" type="submit">Save</button>}
            <p className="text-xs text-muted">Status follows the dates: EL issued gives EL sent, EL signed gives EL signed. Year-end stages come in Phase 3.</p>
          </fieldset>
        </form>
        <div className="grid content-start gap-6">
          <section className="card">
            <Meta items={[
              { label: "Client", value: client ? <Link href={`/clients/${client.id}`} className="text-navy-700 underline">{client.legal_name}</Link> : "None" },
              { label: "Year end", value: formatDate(e.fiscal_year_end) },
              ...(pricing ? [
                { label: "Fee", value: fees?.fee != null ? `$${Number(fees.fee).toLocaleString("en-CA", { minimumFractionDigits: 2 })}` : "" },
                { label: "Monthly fee", value: fees?.monthly_fee != null ? `$${Number(fees.monthly_fee).toLocaleString("en-CA", { minimumFractionDigits: 2 })}` : "" },
              ] : []),
              { label: "Recorded", value: formatDateTime(e.created_at) },
            ]} />
          </section>
          <section className="card">
            <h2 className="mb-2 font-semibold">Letters</h2>
            {(docs ?? []).length === 0 ? <p className="text-sm text-muted">No letter in the vault for this engagement.</p> :
              <ul className="grid gap-2 text-sm">{(docs ?? []).map((d) => <li key={d.id}><Link href={`/documents/vault/${d.id}`} className="text-navy-700 underline">{d.title}</Link> <span className="text-muted">· version {d.current_version}</span></li>)}</ul>}
            {editable && pricing && !t1 && fees?.letter_data != null && (docs ?? []).length > 0 && (
              <p className="mt-3 text-sm"><Link href={`/engagement-letters/new?type=corporate&doc=${docs![0].id}`} className="text-navy-700 underline">Revise letter</Link></p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
