import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";

const KIND: Record<string, string> = { corporate_letter: "Corporate letter", t1_letter: "T1 letter", proposal: "Proposal" };

// The document vault: every PDF made in the app, with permanent versions.
// Engagements and proposals moved to their own pages; old links still land there.
export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const sp = await searchParams;
  if (sp.tab === "engagements") redirect("/engagements");
  if (sp.tab === "proposals") redirect("/proposals");
  const access = await requireAccess();
  if (!canView(access, "documents") && !canView(access, "vault")) redirect("/?error=no-permission");
  const kind = typeof sp.kind === "string" && KIND[sp.kind] ? sp.kind : "";
  const supabase = await createClient();
  let q = supabase.from("documents").select("id, kind, title, status, current_version, updated_at, client_id, clients(legal_name)").order("updated_at", { ascending: false }).limit(500);
  if (kind) q = q.eq("kind", kind);
  const rows = ((await q).data ?? []) as unknown as { id: string; kind: string; title: string; status: string; current_version: number; updated_at: string; client_id: string | null; clients: { legal_name: string } | null }[];
  const chip = (k: string, text: string) => (
    <Link key={k || "all"} href={k ? `/documents?kind=${k}` : "/documents"} aria-current={kind === k ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[13px] ${kind === k ? "border-navy-700 bg-navy-700 text-white" : "border-sand-200 bg-surface text-ink-2 hover:border-navy-300"}`}>{text}</Link>
  );
  return (
    <>
      <PageHeader title="Document vault" description="Every letter and proposal PDF made in the app. Versions are permanent: a change makes a new version." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter by type">{chip("", "All")}{Object.entries(KIND).map(([k, l]) => chip(k, l))}</div>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">Nothing in the vault yet. Every letter and proposal you download is filed here.</p> : (
          <table className="table">
            <thead><tr><th>Document</th><th>Client</th><th>Type</th><th>Versions</th><th>Status</th><th>Last change</th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/documents/vault/${d.id}`} className="font-medium text-navy-700 hover:underline">{d.title}</Link></td>
                <td>{d.client_id ? <Link href={`/clients/${d.client_id}`} className="hover:underline">{d.clients?.legal_name ?? ""}</Link> : ""}</td>
                <td>{KIND[d.kind]}</td><td>{d.current_version}</td><td className="capitalize">{d.status}</td><td>{formatDate(d.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
