import Link from "next/link";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { PriceBookTabs } from "../tabs";
import { serviceName } from "@/lib/price-book/labels";

type Offer = { id: string; offer: string; segment: string; is_package: boolean; services: string[]; monthly_fee: number | null; software_per_month: number | null; year_end_fee: number | null;
  annual_floor: number | null; t1_group: string | null; unit: string; unit_price: number | null; notes: string; is_active: boolean };
const $ = (n: number | null) => (n == null ? "" : "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

export default async function PackagesPage({ searchParams }: PageProps<"/admin/price-book/packages">) {
  const access = await requireAccess("pricing", "view");
  const sp = await searchParams;
  const editable = canEdit(access, "pricing");
  const supabase = await createClient();
  const { data } = await supabase.from("offers").select("*").order("sort_order").order("offer");
  const offers = (data ?? []) as Offer[];
  const section = (seg: string) => offers.filter((o) => o.segment === seg);
  return (
    <>
      <PageHeader title="Price book" description="Packages and price floors used by the Corporate Letter and Proposal checks. Proposals below the floor are flagged. The services ticked on a package decide which catalogue items show as priced through packages." 
        actions={editable ? <Link href="/admin/price-book/packages/new" className="btn">Add offer</Link> : undefined} />
      <PriceBookTabs current="/admin/price-book/packages" />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {offers.length === 0 && <p className="card text-sm text-muted">No offers yet. They come in with the Studio import (Admin, Import from Studio).</p>}
      {["Team or brokerage", "Agent"].map((seg) => section(seg).length > 0 && (
        <section key={seg} className="card mb-6 overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">{seg}</h2>
          <table className="table">
            <thead><tr><th>Offer</th><th>Monthly</th><th>Software</th><th>Year end</th><th>Annual floor</th><th>Services</th><th></th></tr></thead>
            <tbody>{section(seg).map((o) => (
              <tr key={o.id} className={o.is_active ? "" : "text-muted"}>
                <td className="font-medium">{o.offer}{o.is_package && <span className="ml-2 rounded bg-lime-100 px-1.5 py-0.5 text-[11px] text-navy-900">Package</span>}{!o.is_active && <span className="ml-2 text-xs">(off)</span>}<span className="block text-xs text-muted">{o.notes}</span></td>
                <td>{$(o.monthly_fee)}</td><td>{$(o.software_per_month)}</td><td>{$(o.year_end_fee)}</td><td className="font-medium">{$(o.annual_floor)}</td>
                <td className="text-xs">{o.services.map(serviceName).join(", ")}</td>
                <td className="text-right text-sm"><Link href={`/admin/price-book/packages/${o.id}`} className="text-navy-700 underline">{editable ? "Edit" : "View"}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      ))}
    </>
  );
}
