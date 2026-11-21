import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBooks } from "../../data";

// CB2-1 Part 3f: Closebook's own Settings, per firm: the chart template and the tax codes and rates. Users and letterhead
// are read from Studio, not copied. Read here; they are changed where they are kept today (see the note).
export default async function SettingsPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const supabase = await createClient();
  const tab = sp.tab === "tax" ? "tax" : "chart";
  const base = `/cb/${client}/settings`;
  const tabCls = (on: boolean) => `border-b-2 px-3 py-2 text-[13.5px] font-semibold ${on ? "border-navy-700 text-navy-800" : "border-transparent text-ink-3 hover:text-ink"}`;
  let body = null;
  if (tab === "chart") {
    const { data } = await supabase.from("cb_chart_accounts").select("number, name, account_type, line_no, tax_default").order("sort_order");
    const q = (sp.q ?? "").trim().toLowerCase();
    const rows = ((data ?? []) as { number: string; name: string; account_type: string; line_no: string | null; tax_default: string | null }[]).filter((r) => !q || `${r.number} ${r.name}`.toLowerCase().includes(q));
    body = <>
      <form method="get" className="flex gap-2"><input type="hidden" name="tab" value="chart" /><input name="q" defaultValue={sp.q ?? ""} placeholder="Filter by number or name" className="input input-compact w-full max-w-xs" /></form>
      <div className="card overflow-x-auto p-0"><table className="table table-compact" data-settings-chart>
        <thead><tr><th>Number</th><th>Name</th><th>Type</th><th>GIFI line</th><th>Default tax code</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.number}><td className="tabular-nums">{r.number}</td><td>{r.name}</td><td>{r.account_type}</td>
          <td>{r.line_no ? `${r.line_no.replace(/\.00$/, "")} ${b.lineName.get(r.line_no) ?? ""}` : "Unmatched"}</td><td>{r.tax_default ?? ""}</td></tr>)}</tbody></table></div>
      <p className="text-[12.5px] text-ink-3">A new client&rsquo;s chart starts from this template. {rows.length} accounts.</p>
    </>;
  } else {
    const [{ data: codes }, { data: parts }] = await Promise.all([
      supabase.from("cb_sales_tax_codes").select("code, name, provinces").order("sort_order"),
      supabase.from("cb_sales_tax_parts").select("code, name, rate, recoverable, liability, effective_from").order("effective_from", { ascending: false }),
    ]);
    const byCode = new Map<string, { name: string; rate: number; recoverable: boolean; from: string }[]>();
    for (const p of (parts ?? []) as { code: string; name: string; rate: number; recoverable: boolean; effective_from: string }[])
      byCode.set(p.code, [...(byCode.get(p.code) ?? []), { name: p.name, rate: Number(p.rate), recoverable: p.recoverable, from: p.effective_from }]);
    body = <div className="card overflow-x-auto p-0"><table className="table table-compact" data-settings-tax>
      <thead><tr><th>Code</th><th>Name</th><th>Provinces</th><th>Parts (rate, claimable, in force from)</th></tr></thead>
      <tbody>{((codes ?? []) as { code: string; name: string; provinces: string[] | null }[]).map((c) => <tr key={c.code}><td className="font-semibold">{c.code}</td><td>{c.name}</td>
        <td>{c.provinces?.join(", ") ?? "All"}</td>
        <td>{(byCode.get(c.code) ?? []).map((p, i) => <div key={i}>{p.name}: {(p.rate * 100).toFixed(3).replace(/\.?0+$/, "")}%, {p.recoverable ? "claimable" : "not claimable"}, from {p.from}</div>)}
          {!byCode.has(c.code) && <span className="text-ink-3">No tax</span>}</td></tr>)}</tbody></table></div>;
  }
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <h1 className="text-[22px] font-bold">Settings</h1>
      <nav className="flex gap-1 border-b border-sand-200" aria-label="Settings"><Link href={`${base}?tab=chart`} className={tabCls(tab === "chart")}>Chart template</Link>
        <Link href={`${base}?tab=tax`} className={tabCls(tab === "tax")}>Tax codes and rates</Link></nav>
      {body}
      <p className="text-[12.5px] text-ink-3">Users and letterhead come from Studio&rsquo;s Settings. The chart template and the tax rates are read here; today&rsquo;s Closebook screens read the same data, so changes stay where they are made today until those screens retire.</p>
    </div>
  );
}
