import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";

// Settings, Closebook, Tax codes (Phase 3 batch 4.3): the 11 codes. Each GIFI line carries a default;
// only the reviewer changes an account's code; REVIEW means the reviewer decides for that client.
export default async function TaxCodesPage() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: codes }, { data: lines }] = await Promise.all([
    supabase.from("cb_tax_codes").select("code, name, schedule1_effect, used_for").order("sort_order"),
    supabase.from("cb_master_lines").select("default_tax_code").eq("mappable", true),
  ]);
  const count = new Map<string, number>();
  for (const l of (lines ?? []) as { default_tax_code: string }[]) count.set(l.default_tax_code, (count.get(l.default_tax_code) ?? 0) + 1);
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Tax codes"
        description="Each GIFI line carries a default tax code, and a client's account takes it automatically. Only the reviewer changes a client account's code; preparers never choose tax treatment. The tax workpaper builds the Schedule 1 add-backs from these codes." />
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Code</th><th>Name</th><th>Schedule 1 effect</th><th>Used for</th><th className="text-right">GIFI lines</th></tr></thead>
          <tbody>{((codes ?? []) as { code: string; name: string; schedule1_effect: string; used_for: string }[]).map((c) => (
            <tr key={c.code}><td className="font-semibold">{c.code}</td><td>{c.name}</td><td>{c.schedule1_effect}</td><td>{c.used_for}</td><td className="text-right tabular-nums">{count.get(c.code) ?? 0}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <p className="mt-2 text-xs text-muted">To change a line&rsquo;s default code, open the line under GIFI lines.</p>
    </>
  );
}
