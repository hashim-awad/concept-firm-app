import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { cameFrom, engagementStatus } from "@/lib/engagements";

type Row = { id: string; title: string; type: string; status: string; fiscal_year_end: string | null; el_signed: string | null; el_version: string; came_from: string;
  client_id: string | null; client2_id: string | null };

// Engagements (front office batch, section 9; mockup 5-Engagements): one per client, year and service,
// created when a quote or letter is signed. "Came from" replaces the wording version (kept in the record).
// Owners use Update for older engagements, status changes and ending an engagement.
export default async function EngagementsPage({ searchParams }: PageProps<"/engagements">) {
  const access = await requireAccess("documents", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  // Plain reads, no embedded joins: the names come from a second read, and a failed read shows its error.
  const { data, error } = await supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_signed, el_version, came_from, client_id, client2_id")
    .order("fiscal_year_end", { ascending: false, nullsFirst: false }).limit(500);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.flatMap((r) => [r.client_id, r.client2_id]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  let nameError: string | null = null;
  if (ids.length) {
    const { data: cs, error: ce } = await supabase.from("clients").select("id, legal_name").in("id", ids);
    for (const c of cs ?? []) names.set(c.id, c.legal_name);
    if (ce) nameError = ce.message;
  }
  const loadError = error ? `Engagements could not be read: ${error.message}` : nameError ? `Client names could not be read: ${nameError}` : null;
  return (
    <>
      <PageHeader title="Engagements" description="One engagement per client, year and service. Created automatically when a quote or letter is signed. Owners use Update for older engagements, status changes and ending an engagement." />
      <Notice msg={messageFrom(sp.msg)} error={loadError ?? messageFrom(sp.error)} />
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 && !error ? <p className="p-5 text-sm text-muted">No engagements yet. A signed quote or letter creates one.</p> : (
          <table className="table">
            <thead><tr><th>Engagement</th><th>Client</th><th>Service</th><th>Year-end</th><th>Came from</th><th>Letter signed</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((e) => {
              const st = engagementStatus(e.status);
              return (
                <tr key={e.id}>
                  <td className="font-medium">{e.title}</td>
                  <td>{e.client_id ? <Link href={`/clients/${e.client_id}`} className="text-navy-700 hover:underline">{names.get(e.client_id) ?? "Client"}</Link> : ""}
                    {e.client2_id && <> and <Link href={`/clients/${e.client2_id}`} className="text-navy-700 hover:underline">{names.get(e.client2_id) ?? "Client"}</Link></>}</td>
                  <td>{e.type}</td><td className="whitespace-nowrap">{formatDate(e.fiscal_year_end)}</td><td>{cameFrom(e)}</td><td className="whitespace-nowrap">{formatDate(e.el_signed)}</td>
                  <td><span className={`rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${st.cls}`}>{st.label}</span></td>
                  <td className="text-right text-sm"><Link href={`/documents/engagements/${e.id}`} className="text-navy-700 underline">{access.is_owner ? "Update" : "View"}</Link></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
