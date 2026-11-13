import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { deleteFirmVendorRule, saveFirmVendorRule } from "../actions";

// Settings, Closebook, Vendor rules (Hashim, Nov 15, 2026, layout item 4): the firm's own codings for
// common vendors. A line uses one only when the client has no vendor rule and no coding history for the
// vendor. The vendor must match exactly; a name that only sounds similar is not a match.
export default async function FirmVendorRulesPage({ searchParams }: PageProps<"/admin/closebook/vendor-rules">) {
  await requireOwner();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: rules }, { data: chart }, { data: codes }] = await Promise.all([
    supabase.from("cb_firm_vendor_rules").select("id, vendor_key, chart_account, tax_code").order("vendor_key"),
    supabase.from("cb_chart_accounts").select("number, name").order("sort_order"),
    supabase.from("cb_sales_tax_codes").select("code, name").order("sort_order"),
  ]);
  const accounts = (chart ?? []) as { number: string; name: string }[];
  const name = new Map(accounts.map((a) => [a.number, `${a.number} ${a.name}`]));
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Vendor rules"
        description="Firm rules for common vendors. A bank or card line is suggested from the client's own vendor rule first, then from how the client's file coded the vendor before, then from a rule here. A line with no match gets no suggestion." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card mb-4 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Vendor, as on the statement</th><th>Account</th><th>Sales tax</th><th /></tr></thead>
          <tbody>
            {((rules ?? []) as { id: string; vendor_key: string; chart_account: string; tax_code: string | null }[]).map((r) => (
              <tr key={r.id}><td className="font-medium">{r.vendor_key}</td><td>{name.get(r.chart_account)}</td><td>{r.tax_code ?? "–"}</td>
                <td className="text-right"><form action={deleteFirmVendorRule}><input type="hidden" name="id" value={r.id} /><button type="submit" className="text-sm text-danger underline">Delete</button></form></td></tr>
            ))}
            {!(rules ?? []).length && <tr><td colSpan={4} className="text-ink-2">No firm rules yet.</td></tr>}
          </tbody>
        </table>
      </section>
      <form action={saveFirmVendorRule} className="card grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end">
        <label className="grid gap-1 text-sm">Vendor<input name="vendor" required minLength={2} maxLength={200} placeholder="For example SAMPLE PRINT SHOP GUELPH" className="input" /></label>
        <label className="grid gap-1 text-sm">Account<select name="account" required className="input"><option value="">Choose</option>{accounts.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Sales tax<select name="tax" className="input"><option value="">Choose on the line</option>{((codes ?? []) as { code: string; name: string }[]).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <button type="submit" className="btn">Add rule</button>
      </form>
    </>
  );
}
