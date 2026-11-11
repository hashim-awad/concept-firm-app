import Link from "next/link";
import { Lock } from "lucide-react";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";

type Line = { line_no: string; name: string; gifi_code: string; lead_sheet: string | null; statement_line: string | null; default_tax_code: string | null; mappable: boolean; locked: boolean };

// Settings, Closebook, GIFI lines (Phase 3 batch 4.1 and section 7; mockup SetupGifi): the master
// lines every client account matches to. Owners only. Changes apply to every open file and are logged.
export default async function GifiLinesPage({ searchParams }: PageProps<"/admin/closebook/gifi-lines">) {
  await requireOwner();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const supabase = await createClient();
  const [{ data: lines }, { data: sheets }, { data: version }] = await Promise.all([
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, lead_sheet, statement_line, default_tax_code, mappable, locked").order("sort_order"),
    supabase.from("cb_lead_sheets").select("code, name"),
    supabase.from("cb_gifi_versions").select("label").eq("is_current", true).maybeSingle(),
  ]);
  const all = (lines ?? []) as Line[];
  const sheetName = new Map(((sheets ?? []) as { code: string; name: string }[]).map((x) => [x.code, `${x.code} ${x.name}`]));
  const needle = q.toLowerCase();
  const shown = needle ? all.filter((l) => [l.line_no, l.name, l.statement_line ?? "", l.default_tax_code ?? ""].some((v) => v.toLowerCase().includes(needle))) : all;
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="GIFI lines"
        description={`${all.length} lines from CRA ${version?.label ?? "RC4088"}. Every client account matches to one line. Changes apply to every open file and are logged.`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/admin/closebook/gifi-lines">
        <div><label htmlFor="q" className="label">Search lines</label><input id="q" name="q" defaultValue={q} placeholder="Line, name, statement line or tax code" className="input w-80 max-w-full" /></div>
        <button className="btn-secondary" type="submit">Search</button>
        {q && <Link href="/admin/closebook/gifi-lines" className="text-sm text-navy-700 underline">Clear</Link>}
        <p className="ml-auto text-xs text-muted">To add a sub-line, open the line it sits under.</p>
      </form>
      <section className="card overflow-x-auto p-0">
        <table className="table min-w-[900px]">
          <thead><tr><th>Line</th><th>Name</th><th>GIFI</th><th>Lead sheet</th><th>Statement line</th><th>Tax code</th></tr></thead>
          <tbody>{shown.map((l) => {
            const sub = !l.line_no.endsWith(".00");
            return (
              <tr key={l.line_no} className={l.mappable ? "" : "text-ink-3"}>
                <td className="tabular-nums"><Link href={`/admin/closebook/gifi-lines/${l.line_no}`} className={`text-navy-700 hover:underline ${sub ? "font-semibold" : ""}`}>{l.line_no}</Link></td>
                <td className={sub ? "font-semibold" : ""}>{l.name}{l.locked && <Lock className="ml-1.5 inline h-3.5 w-3.5 text-ink-3" aria-label="Locked: staff pick a sub-line" />}</td>
                <td className="tabular-nums">{l.gifi_code}</td>
                <td>{l.lead_sheet ? sheetName.get(l.lead_sheet) : "Calculated total"}</td>
                <td>{l.statement_line ?? ""}</td>
                <td>{l.default_tax_code ?? ""}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
      <p className="mt-2 text-xs text-muted">Sub-lines in bold share a GIFI code with their main line. Grey lines are totals the system calculates; nobody maps to them. A lock means staff must pick one of the sub-lines.{q ? ` ${shown.length} of ${all.length} lines shown.` : ""}</p>
    </>
  );
}
