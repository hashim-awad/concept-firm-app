import Link from "next/link";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { PriceBookTabs } from "../tabs";

type Offer = { id: string; offer: string; segment: string; is_package: boolean; services: string[]; monthly_fee: number | null; software_per_month: number | null; year_end_fee: number | null;
  annual_floor: number | null; t1_group: string | null; unit: string; unit_price: number | null; notes: string; is_active: boolean };
const $ = (n: number | null) => (n == null ? "" : "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

export default async function T1RowsPage({ searchParams }: PageProps<"/admin/price-book/t1">) {
  const access = await requireAccess("price_book", "view");
  const sp = await searchParams;
  const editable = canEdit(access, "price_book");
  const supabase = await createClient();
  const { data } = await supabase.from("offers").select("*").order("sort_order").order("offer");
  const offers = (data ?? []) as Offer[];
  const section = (seg: string) => offers.filter((o) => o.segment === seg);
  return (
    <>
      <PageHeader title="Price book" description="Studio's T1 price book rows, kept exactly for the parity check. Quotes use the Personal tax (T1) items in the Catalogue." />
      <PriceBookTabs current="/admin/price-book/t1" />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {section("T1 personal").length === 0 && <p className="card text-sm text-muted">No T1 rows yet. They come in with the Studio import (Admin, Import from Studio).</p>}
      {section("T1 personal").length > 0 && (
        <section className="card overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">T1 personal (Studio price book)</h2>
          <table className="table">
            <thead><tr><th>Item</th><th>Group</th><th>Unit</th><th className="text-right">Price</th><th></th></tr></thead>
            <tbody>{section("T1 personal").map((o) => (
              <tr key={o.id}><td>{o.offer}<span className="block text-xs text-muted">{o.notes}</span></td><td>{o.t1_group}</td><td>{o.unit}</td><td className="text-right">{$(o.unit_price)}</td>
                <td className="text-right text-sm"><Link href={`/admin/price-book/packages/${o.id}`} className="text-navy-700 underline">{editable ? "Edit" : "View"}</Link></td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
