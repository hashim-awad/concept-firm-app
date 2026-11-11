import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";

// Settings, Closebook, Lead sheets (Phase 3 batch 4.4): 20 groups, CaseWare-style letters.
export default async function LeadSheetsPage() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: sheets }, { data: lines }] = await Promise.all([
    supabase.from("cb_lead_sheets").select("code, name").order("sort_order"),
    supabase.from("cb_master_lines").select("lead_sheet").eq("mappable", true),
  ]);
  const count = new Map<string, number>();
  for (const l of (lines ?? []) as { lead_sheet: string }[]) count.set(l.lead_sheet, (count.get(l.lead_sheet) ?? 0) + 1);
  const group = (c: string) => (/^\d/.test(c) ? "Income statement" : c.length === 2 ? "Liabilities and equity" : "Assets");
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Lead sheets"
        description="Lead sheets group the trial balance for review: A to H for assets, AA to GG for liabilities and equity, 10 to 50 for the income statement. Each GIFI line belongs to one." />
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Lead sheet</th><th>Name</th><th>Part</th><th className="text-right">GIFI lines</th></tr></thead>
          <tbody>{((sheets ?? []) as { code: string; name: string }[]).map((x) => (
            <tr key={x.code}><td className="font-semibold">{x.code}</td><td>{x.name}</td><td>{group(x.code)}</td><td className="text-right tabular-nums">{count.get(x.code) ?? 0}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
