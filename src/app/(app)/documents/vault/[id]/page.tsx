import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { formatDateTime } from "@/lib/dates";

const SCREEN: Record<string, string> = { corporate_letter: "/engagement-letters?type=corporate", t1_letter: "/engagement-letters?type=t1", proposal: "/documents/proposal" };

export default async function VaultDocumentPage({ params }: PageProps<"/documents/vault/[id]">) {
  const access = await requireAccess();
  if (!canView(access, "vault") && !canView(access, "documents")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase.from("documents").select("id, kind, title, status, client_id, engagement_id, proposal_id").eq("id", id).maybeSingle();
  if (!d) notFound();
  // Versions hold the inputs and PDF, which carry fees: Pricing permission only (approved Nov 9, 2026).
  const pricing = canView(access, "pricing");
  const { data: versions } = !pricing ? { data: [] } : await supabase.from("document_versions").select("id, version, mode, el_version, file_name, file_sha256, file_size, regenerated, label, created_at, staff:created_by(full_name)").eq("document_id", id).order("version", { ascending: false });
  return (
    <>
      <PageHeader eyebrow="Document vault" title={d.title} description="Every version is kept. Nothing is overwritten."
        actions={pricing && canEdit(access, "documents") && d.status !== "regenerated" ? <Link href={`${SCREEN[d.kind]}${SCREEN[d.kind].includes("?") ? "&" : "?"}doc=${d.id}`} className="btn">{d.status === "final" ? "Revise (new version)" : "Keep working (new version)"}</Link> : undefined} />
      {!pricing && <p className="card mb-4 text-sm text-muted">This document shows fees. Opening it needs the Pricing permission, which your role does not include.</p>}
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Version</th><th>Made</th><th>By</th><th>Kind</th><th>File</th><th>Fingerprint (SHA-256)</th></tr></thead>
          <tbody>{(versions ?? []).map((v) => (
            <tr key={v.id}>
              <td className="font-medium">{v.version}</td>
              <td>{formatDateTime(v.created_at)}</td>
              <td>{(v.staff as unknown as { full_name: string } | null)?.full_name ?? ""}</td>
              <td>{v.regenerated ? "Regenerated from Studio records" : v.mode === "final" ? "Final" : "Draft for review"}<span className="block text-xs text-muted">{v.el_version}</span></td>
              <td><a href={`/documents/file/${v.id}`} target="_blank" rel="noopener" className="text-navy-700 underline">Open</a> · <a href={`/documents/file/${v.id}?download=1`} className="text-navy-700 underline">Download</a><span className="block text-xs text-muted">{v.file_name} · {Math.round(v.file_size / 1024)} KB</span></td>
              <td className="font-mono text-xs break-all">{v.file_sha256}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
