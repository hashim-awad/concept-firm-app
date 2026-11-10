import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Notice, formatDateTime } from "@/components/ui";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatCents } from "@/lib/screening/engine";
import { formatDate, todayToronto } from "@/lib/dates";
import { updateItem, addPrice } from "../actions";

type Price = { id: string; amount_cents: number; effective_from: string; note: string; created_at: string; created_by: string | null };

export default async function ItemPage({ params, searchParams }: PageProps<"/admin/price-book/[id]">) {
  const access = await requireAccess("pricing", "view");
  const editable = canEdit(access, "pricing");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: item } = await supabase.from("catalogue_items").select("*").eq("id", id).maybeSingle();
  if (!item) notFound();
  const [{ data: prices }, { data: staff }] = await Promise.all([
    supabase.from("item_prices").select("id, amount_cents, effective_from, note, created_at, created_by").eq("item_id", id).order("effective_from", { ascending: false }),
    supabase.from("staff").select("id, full_name"),
  ]);
  const staffName = new Map((staff ?? []).map((s: { id: string; full_name: string }) => [s.id, s.full_name]));
  const today = todayToronto();
  const currentId = ((prices ?? []) as Price[]).find((p) => p.effective_from <= today)?.id;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/price-book" className="text-accent underline">Price book</Link></p>
      <PageHeader title={item.name} description={`Code ${item.code}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <form action={updateItem} className="card mb-6">
        <fieldset disabled={!editable} className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="id" value={item.id} />
          <div className="md:col-span-2">
            <label htmlFor="name" className="label">Name shown on quotes</label>
            <input id="name" name="name" defaultValue={item.name} required maxLength={120} className="input" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="description" className="label">Description</label>
            <input id="description" name="description" defaultValue={item.description} maxLength={300} className="input" />
          </div>
          <div>
            <label htmlFor="unit_label" className="label">Charged</label>
            <input id="unit_label" name="unit_label" defaultValue={item.unit_label} maxLength={40} className="input" />
          </div>
          <div>
            <label htmlFor="sort_order" className="label">Order in list</label>
            <input id="sort_order" name="sort_order" type="number" step="any" defaultValue={item.sort_order} className="input" />
          </div>
          <div>
            <label htmlFor="price_type" className="label">Price type</label>
            <select id="price_type" name="price_type" defaultValue={item.price_type} className="input"><option>Fixed</option><option>Per client</option><option>Invoice only</option></select>
          </div>
          <div>
            <label htmlFor="income_account" className="label">QBO income account</label>
            <input id="income_account" name="income_account" defaultValue={item.income_account} maxLength={120} className="input" />
          </div>
          <div>
            <label htmlFor="replaces_qbo" className="label">Replaces in QBO</label>
            <input id="replaces_qbo" name="replaces_qbo" defaultValue={item.replaces_qbo} maxLength={300} className="input" />
          </div>
          <div>
            <label htmlFor="replaces_taxdome" className="label">Replaces in TaxDome</label>
            <input id="replaces_taxdome" name="replaces_taxdome" defaultValue={item.replaces_taxdome} maxLength={300} className="input" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="internal_note" className="label">Internal note (staff only, never on quotes or invoices)</label>
            <input id="internal_note" name="internal_note" defaultValue={item.internal_note} maxLength={500} className="input" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="per_spouse" type="checkbox" defaultChecked={item.per_spouse} className="h-4 w-4 accent-accent" />
            Charged for each spouse who needs it
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="is_active" type="checkbox" defaultChecked={item.is_active} className="h-4 w-4 accent-accent" />
            Active (switched-off items cannot be used in new rules)
          </label>
          {editable && <div className="md:col-span-2"><button type="submit" className="btn">Save item</button></div>}
        </fieldset>
      </form>

      <section className="card mb-6 overflow-x-auto p-0">
        <h2 className="px-5 pt-4 pb-2 font-semibold">Price history</h2>
        <table className="table">
          <thead><tr><th>Starts</th><th className="text-right">Price before tax</th><th>Note</th><th>Added by</th><th></th></tr></thead>
          <tbody>
            {((prices ?? []) as Price[]).map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{formatDate(p.effective_from)}</td>
                <td className="text-right">{formatCents(p.amount_cents)}</td>
                <td className="text-muted">{p.note}</td>
                <td className="text-muted">{p.created_by ? staffName.get(p.created_by) : "Initial load"} · {formatDateTime(p.created_at)}</td>
                <td>{p.id === currentId && <span className="rounded bg-ok/10 px-1.5 py-0.5 text-xs text-ok">Current</span>}{p.effective_from > today && <span className="rounded bg-background px-1.5 py-0.5 text-xs text-muted">Upcoming</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editable && (
        <form action={addPrice} className="card">
          <h2 className="mb-1 font-semibold">Change the price</h2>
          <p className="mb-3 text-sm text-muted">The new price applies to quotes made on or after the start date. Past prices stay on record.</p>
          <input type="hidden" name="id" value={item.id} />
          <div className="grid gap-3 md:grid-cols-[10rem_12rem_1fr_auto] md:items-end">
            <div>
              <label htmlFor="price" className="label">New price ($)</label>
              <input id="price" name="price" required inputMode="decimal" className="input" />
            </div>
            <div>
              <label htmlFor="effective_from" className="label">Starts on</label>
              <input id="effective_from" name="effective_from" type="date" required defaultValue={today} className="input" />
            </div>
            <div>
              <label htmlFor="note" className="label">Reason (optional)</label>
              <input id="note" name="note" maxLength={200} className="input" />
            </div>
            <button type="submit" className="btn">Save price</button>
          </div>
        </form>
      )}
    </>
  );
}
