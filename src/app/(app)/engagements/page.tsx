import Link from "next/link";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";

// Every engagement: one per client, year and service, with its status.
export default async function EngagementsPage({ searchParams }: PageProps<"/engagements">) {
  const access = await requireAccess("documents", "view");
  const sp = await searchParams;
  const editable = canEdit(access, "documents");
  const supabase = await createClient();
  const { data } = await supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, el_signed, el_version, client_id, clients(legal_name)")
    .order("fiscal_year_end", { ascending: false, nullsFirst: false }).limit(500);
  const rows = (data ?? []) as unknown as { id: string; title: string; type: string; status: string; fiscal_year_end: string | null; el_issued: string | null; el_signed: string | null; el_version: string; client_id: string | null; clients: { legal_name: string } | null }[];
  return (
    <>
      <PageHeader title="Engagements" description="One engagement per client, year and service, with its status." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No engagements yet. A Final engagement letter records one.</p> : (
          <table className="table">
            <thead><tr><th>Engagement</th><th>Client</th><th>Service</th><th>Year end</th><th>EL issued</th><th>EL signed</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <td className="font-medium">{e.title}<span className="block text-xs text-muted">{e.el_version}</span></td>
                <td>{e.client_id ? <Link href={`/clients/${e.client_id}`} className="text-navy-700 hover:underline">{e.clients?.legal_name ?? "Client"}</Link> : ""}</td>
                <td>{e.type}</td><td>{formatDate(e.fiscal_year_end)}</td><td>{formatDate(e.el_issued)}</td><td>{formatDate(e.el_signed)}</td>
                <td>{e.status === "EL sent" ? "EL sent, awaiting signature" : e.status}</td>
                <td className="text-right text-sm"><Link href={`/documents/engagements/${e.id}`} className="text-navy-700 underline">{editable ? "Update" : "View"}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
