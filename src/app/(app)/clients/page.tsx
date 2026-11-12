import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { PageTabs } from "@/components/page-tabs";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { AutoSubmitSelect } from "@/components/auto-submit-select";

type Row = { id: string; kind: string; legal_name: string; entity_type: string; province: string; year_end_md: string; name_verified: boolean; status: string };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const access = await requireAccess("clients", "view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  // Front office batch, section 8 (mockup 4-Clients): Active, Waiting for TaxDome (added by a signing,
  // until the TaxDome import matches it), All. Inactive records show under All.
  const show = sp.show === "waiting" ? "waiting" : sp.show === "all" ? "all" : sp.show === "inactive" ? "inactive" : "active";
  const type = sp.type === "corporation" || sp.type === "individual" ? sp.type : "all";
  const supabase = await createClient();
  let query = supabase.from("clients").select("id, kind, legal_name, entity_type, province, year_end_md, name_verified, status").order("legal_name").limit(2000);
  if (q) query = query.ilike("legal_name", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  const { data: everyone } = await query;
  const tally = { active: 0, waiting: 0 };
  for (const c of (everyone ?? []) as Row[]) { if (c.status === "active") tally.active++; if (c.status === "waiting_taxdome") tally.waiting++; }
  const data = ((everyone ?? []) as Row[]).filter((c) => show === "all" || c.status === ({ active: "active", waiting: "waiting_taxdome", inactive: "inactive" } as Record<string, string>)[show]);
  // Counts for the type filter follow the search and Active/Inactive choice.
  const all = (data ?? []) as Row[];
  const count = { all: all.length, corporation: all.filter((c) => c.kind === "corporation").length, individual: all.filter((c) => c.kind === "individual").length };
  const rows = type === "all" ? all : all.filter((c) => c.kind === type);
  return (
    <>
      <PageHeader title="Clients" description="Client records used by letters and proposals. A Final letter needs the legal name checked against the registry (or ID for individuals)."
        actions={<>
          {access.is_owner && <Link href="/admin/taxdome-import" className={buttonClass("secondary")}><Upload className="h-4 w-4" aria-hidden />Import from TaxDome</Link>}
          {canEdit(access, "clients") && <Link href="/clients/new" className={buttonClass("primary")}><Plus className="h-4 w-4" aria-hidden />Add client</Link>}
        </>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <PageTabs label="Status" current={show === "inactive" ? "all" : show} tabs={[
        { key: "active", href: `/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`, label: `Active (${tally.active})` },
        { key: "waiting", href: `/clients?show=waiting${q ? `&q=${encodeURIComponent(q)}` : ""}`, label: `Waiting for TaxDome (${tally.waiting})` },
        { key: "all", href: `/clients?show=all${q ? `&q=${encodeURIComponent(q)}` : ""}`, label: "All" },
      ]} />
      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="show" value={show} />
        <div>
          <label htmlFor="q" className="label">Search by name</label>
          <input id="q" name="q" defaultValue={q} className="input w-64" />
        </div>
        <div>
          <label htmlFor="type" className="label">Type</label>
          <AutoSubmitSelect id="type" name="type" defaultValue={type} className="input">
            <option value="all">All clients ({count.all})</option>
            <option value="corporation">Companies ({count.corporation})</option>
            <option value="individual">Individuals ({count.individual})</option>
          </AutoSubmitSelect>
        </div>
        <button className="btn" type="submit">Search</button>
      </form>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No clients found.</p> : (
          <table className="table">
            <thead><tr><th>Legal name</th><th>Type</th><th>Province</th><th>Year-end</th><th>Status</th><th>Name checked</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clients/${c.id}`} className="font-medium text-navy-700 hover:underline">{c.legal_name}</Link></td>
                  <td>{c.kind === "individual" ? "Individual" : c.entity_type}</td>
                  <td>{c.province === "OTHER" ? "Other" : c.province}</td>
                  <td>{c.year_end_md}</td>
                  <td>{c.status === "waiting_taxdome" ? <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning whitespace-nowrap">Waiting for TaxDome</span>
                    : c.status === "active" ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Active</span>
                    : <span className="rounded bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-3">Inactive</span>}</td>
                  <td>{c.name_verified ? "Yes" : <span className="text-danger">Not yet</span>}</td>
                  <td className="whitespace-nowrap text-right text-sm">
                    <Link href={c.kind === "individual" ? `/engagement-letters/new?type=t1&client=${c.id}` : `/engagement-letters/new?type=corporate&client=${c.id}`} className="text-navy-700 underline">New letter</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
