import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { saveOffer } from "../actions";

const SERVICES: [string, string][] = [["comp", "Year-end financial statements"], ["t2", "Corporate tax return (T2)"], ["catchup", "Catch-up bookkeeping"], ["books", "Monthly bookkeeping"], ["pnl", "Monthly profit and loss report"], ["gst", "GST/HST returns"], ["payroll", "Payroll"], ["pay", "Payment administration"], ["cfo", "CFO reporting"], ["budget", "Annual budget"], ["coord", "External accountant support"], ["t1", "Owner T1"]];

export default async function OfferPage({ params, searchParams }: PageProps<"/admin/price-book/packages/[id]">) {
  const access = await requireAccess("price_book", "view");
  const { id } = await params;
  const sp = await searchParams;
  const editable = canEdit(access, "price_book");
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (isNew && !editable) notFound();
  const supabase = await createClient();
  const o = isNew ? { offer: "", segment: "Team or brokerage", is_package: false, services: [] as string[], monthly_fee: null, software_per_month: null, year_end_fee: null, annual_floor: null, monthly_reference: null, allows_payment_admin: false, t1_group: null, unit: "", unit_price: null, notes: "", sort_order: 0, is_active: true }
    : (await supabase.from("offers").select("*").eq("id", id).maybeSingle()).data;
  if (!o) notFound();
  const n = (v: number | null) => (v == null ? "" : String(Number(v)));
  const field = (name: string, label: string, v: string) => <div><label htmlFor={name} className="label">{label}</label><input id={name} name={name} defaultValue={v} inputMode="decimal" className="input" /></div>;
  return (
    <>
      <PageHeader eyebrow="Price book" title={isNew ? "Add offer" : o.offer} description="Amounts are before tax. Annual floor is the lowest annual value a proposal may show without a warning." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveOffer} className="card max-w-3xl space-y-4">
        <input type="hidden" name="id" value={isNew ? "" : id} />
        <fieldset disabled={!editable} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div><label htmlFor="offer" className="label">Offer</label><input id="offer" name="offer" defaultValue={o.offer} required className="input" /></div>
            <div><label htmlFor="segment" className="label">Segment</label><select id="segment" name="segment" defaultValue={o.segment} className="input">{["Team or brokerage", "Agent", "T1 personal"].map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {field("monthly_fee", "Monthly fee", n(o.monthly_fee))}{field("software_per_month", "Software per month", n(o.software_per_month))}{field("year_end_fee", "Year-end fee", n(o.year_end_fee))}
            {field("annual_floor", "Annual floor", n(o.annual_floor))}{field("monthly_reference", "Monthly reference", n(o.monthly_reference))}{field("sort_order", "Order", String(o.sort_order ?? 0))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label htmlFor="t1_group" className="label">T1 group (T1 rows only)</label><select id="t1_group" name="t1_group" defaultValue={o.t1_group ?? ""} className="input"><option value="">None</option>{["Base", "Add-on", "Triage", "Out of scope"].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label htmlFor="unit" className="label">Unit</label><input id="unit" name="unit" defaultValue={o.unit} className="input" /></div>
            {field("unit_price", "Unit price", n(o.unit_price))}
          </div>
          <fieldset><legend className="label">Services in the package</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">{SERVICES.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="services" value={k} defaultChecked={o.services.includes(k)} className="h-4 w-4 accent-navy-700" />{l}</label>)}</div>
          </fieldset>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="is_package" defaultChecked={o.is_package} className="h-4 w-4 accent-navy-700" />Package (offered in the letter&rsquo;s package list)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="allows_payment_admin" defaultChecked={o.allows_payment_admin} className="h-4 w-4 accent-navy-700" />Payment admin allowed</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={o.is_active} className="h-4 w-4 accent-navy-700" />In use</label>
          </div>
          <div><label htmlFor="notes" className="label">Notes</label><textarea id="notes" name="notes" defaultValue={o.notes} className="input min-h-20 py-2" /></div>
          {editable && <button type="submit" className="btn">Save</button>}
        </fieldset>
      </form>
    </>
  );
}
