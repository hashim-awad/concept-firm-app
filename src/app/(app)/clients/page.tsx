import Link from "next/link";
import { Plus } from "lucide-react";
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
  const show = sp.show === "inactive" ? "inactive" : "active";
  const type = sp.type === "corporation" || sp.type === "individual" ? sp.type : "all";
  const supabase = await createClient();
  let query = supabase.from("clients").select("id, kind, legal_name, entity_type, province, year_end_md, name_verified, status").eq("status", show).order("legal_name").limit(500);
  if (q) query = query.ilike("legal_name", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  const { data } = await query;
  // Counts for the type filter follow the search and Active/Inactive choice.
  const all = (data ?? []) as Row[];
  const count = { all: all.length, corporation: all.filter((c) => c.kind === "corporation").length, individual: all.filter((c) => c.kind === "individual").length };
  const rows = type === "all" ? all : all.filter((c) => c.kind === type);
  return (
    <>
      <PageHeader title="Clients" description="Client records used by letters and proposals. A Final letter needs the legal name checked against the registry (or ID for individuals)."
        actions={canEdit(access, "clients") ? <Link href="/clients/new" className={buttonClass("primary")}><Plus className="h-4 w-4" aria-hidden />Add client</Link> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
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
        <div>
          <label htmlFor="show" className="label">Show</label>
          <AutoSubmitSelect id="show" name="show" defaultValue={show} className="input"><option value="active">Active</option><option value="inactive">Inactive</option></AutoSubmitSelect>
        </div>
        <button className="btn" type="submit">Search</button>
      </form>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No clients found.</p> : (
          <table className="table">
            <thead><tr><th>Legal name</th><th>Type</th><th>Province</th><th>Year end</th><th>Name checked</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clients/${c.id}`} className="font-medium text-navy-700 hover:underline">{c.legal_name}</Link></td>
                  <td>{c.kind === "individual" ? "Individual" : c.entity_type}</td>
                  <td>{c.province === "OTHER" ? "Other" : c.province}</td>
                  <td>{c.year_end_md}</td>
                  <td>{c.name_verified ? "Yes" : <span className="text-danger">Not yet</span>}</td>
                  <td className="whitespace-nowrap text-right text-sm">
                    <Link href={c.kind === "individual" ? `/engagement-letters?type=t1&client=${c.id}` : `/engagement-letters?type=corporate&client=${c.id}`} className="text-navy-700 underline">New letter</Link>
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
