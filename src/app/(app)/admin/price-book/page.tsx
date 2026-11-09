import Link from "next/link";
import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatCents } from "@/lib/screening/engine";
import { formatDate, todayToronto } from "@/lib/dates";
import { addItem } from "./actions";
import { PriceBookTabs } from "./tabs";
import { planCleanup } from "@/lib/price-book/cleanup";
import { loadItems } from "@/lib/price-book/load";
import { packagesCovering, suggestCode } from "@/lib/price-book/labels";
import { LineAndCode } from "./add-item-code";
import { FormDialog } from "@/components/ds/overlays";

type Line = { id: string; key: string; name: string; sort_order: number };
type Item = { id: string; service_line_id: string; code: string; name: string; unit_label: string; per_spouse: boolean; is_active: boolean; sort_order: number; price_type: string; internal_note: string };
type Price = { item_id: string; amount_cents: number; effective_from: string };

export default async function PriceBookPage({ searchParams }: PageProps<"/admin/price-book">) {
  const access = await requireAccess("pricing", "view");
  const editable = canEdit(access, "pricing");
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayToronto();
  const [{ data: lines }, { data: items }, { data: prices }, { data: offers }] = await Promise.all([
    supabase.from("service_lines").select("id, key, name, sort_order").order("sort_order"),
    supabase.from("catalogue_items").select("id, service_line_id, code, name, unit_label, per_spouse, is_active, sort_order, price_type, internal_note").order("sort_order"),
    supabase.from("item_prices").select("item_id, amount_cents, effective_from").order("effective_from"),
    supabase.from("offers").select("offer, segment, services, monthly_fee, software_per_month, is_active"),
  ]);
  const allItems = (items ?? []) as Item[];
  const offerRows = (offers ?? []) as { offer: string; segment: string; services: string[]; monthly_fee: number | null; software_per_month: number | null; is_active: boolean }[];
  const allCodes = allItems.map((i) => i.code);
  const lineChoices = ((lines ?? []) as Line[]).map((l) => ({ id: l.id, name: l.name,
    suggestion: suggestCode(allItems.filter((i) => i.service_line_id === l.id).map((i) => i.code), allCodes) }));
  // No price: "Priced per client (see packages)" only when a package lists the item; otherwise "Quoted per client".
  const noPrice = (i: Item) => {
    const pk = packagesCovering(i, offerRows);
    return pk.length ? <span className="text-ink-2">Priced per client (see packages)
        <Link href="/admin/price-book/packages" title={pk.join("\n")} className="block text-xs text-muted underline">In {pk.length} package{pk.length === 1 ? "" : "s"}</Link></span>
      : <span className="text-ink-2">Quoted per client</span>;
  };

  // The clean-up link shows only while the clean-up still has something to do (needed again in Live).
  let cleanupPending = false;
  if (access.is_owner) {
    const { items: all, lineKeys, t1Offers } = await loadItems(supabase);
    const r = planCleanup(all, lineKeys, t1Offers);
    cleanupPending = r.plan.length > 0 || r.blockers.length > 0;
  }

  const current = new Map<string, Price>();
  const upcoming = new Map<string, Price>();
  for (const p of (prices ?? []) as Price[]) {
    if (p.effective_from <= today) current.set(p.item_id, p);
    else if (!upcoming.has(p.item_id)) upcoming.set(p.item_id, p);
  }

  return (
    <>
      <PageHeader title="Price book" description="All prices are before tax. Quotes take prices only from here. A price change starts on its date and never changes a quote already made."
        actions={editable ? (
          <FormDialog label="Add item" title="Add an item">
            <form action={addItem} className="grid gap-3 md:grid-cols-2">
              <LineAndCode lines={lineChoices} />
              <div className="md:col-span-2">
                <label htmlFor="name" className="label">Name shown on quotes</label>
                <input id="name" name="name" required maxLength={120} className="input" />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="description" className="label">Description</label>
                <input id="description" name="description" maxLength={300} className="input" />
              </div>
              <div>
                <label htmlFor="unit_label" className="label">Charged</label>
                <input id="unit_label" name="unit_label" defaultValue="each" maxLength={40} className="input" />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <input id="per_spouse" name="per_spouse" type="checkbox" className="h-4 w-4 accent-accent" />
                <label htmlFor="per_spouse" className="text-sm">Charged for each spouse who needs it</label>
              </div>
              <div>
                <label htmlFor="price" className="label">Price before tax ($)</label>
                <input id="price" name="price" required inputMode="decimal" placeholder="299.00" className="input" />
              </div>
              <div>
                <label htmlFor="effective_from" className="label">Price starts on</label>
                <input id="effective_from" name="effective_from" type="date" required defaultValue={today} className="input" />
              </div>
              <input type="hidden" name="sort_order" value="1000" />
              <div className="flex justify-end md:col-span-2"><button type="submit" className="btn">Add item</button></div>
            </form>
          </FormDialog>
        ) : undefined} />
      <PriceBookTabs current="/admin/price-book" />
      {cleanupPending && <p className="mb-4 text-sm"><Link href="/admin/price-book/cleanup" className="text-navy-700 underline">Price book clean-up (after the Studio import)</Link></p>}
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      {((lines ?? []) as Line[]).map((line) => {
        const lineItems = ((items ?? []) as Item[]).filter((i) => i.service_line_id === line.id);
        return (
          <section key={line.id} className="card mb-6 overflow-x-auto p-0">
            <h2 className="px-5 pt-4 pb-2 font-semibold">{line.name}</h2>
            {lineItems.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted">No items yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr><th className="min-w-[16rem]">Item</th><th>Charged</th><th className="text-right">Price now</th><th>Next change</th><th></th></tr>
                </thead>
                <tbody>
                  {lineItems.map((i) => {
                    const now = current.get(i.id);
                    const next = upcoming.get(i.id);
                    return (
                      <tr key={i.id} className={i.is_active ? "" : "text-muted"}>
                        <td>
                          <span className="font-medium">{i.name}</span>
                          {!i.is_active && <span className="ml-2 text-xs">(switched off)</span>}
                          <span className="block text-xs text-muted">{i.code}{i.internal_note ? ` · ${i.internal_note}` : ""}</span>
                        </td>
                        <td className="whitespace-nowrap">{i.unit_label}{i.per_spouse ? ", each spouse" : ""}</td>
                        <td className="whitespace-nowrap text-right">{now ? formatCents(now.amount_cents) : i.price_type === "Per client" ? noPrice(i) : <span className="text-danger">No price</span>}</td>
                        <td className="whitespace-nowrap text-muted">{next ? `${formatCents(next.amount_cents)} from ${formatDate(next.effective_from)}` : ""}</td>
                        <td className="text-right"><Link href={`/admin/price-book/${i.id}`} className="btn-secondary">{editable ? "Edit" : "View"}</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

    </>
  );
}
