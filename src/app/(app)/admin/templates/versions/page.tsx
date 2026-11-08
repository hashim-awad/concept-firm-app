import Link from "next/link";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { makeCurrent, startDraft } from "./actions";

type V = { id: string; label: string; status: string; is_current: boolean; approved_at: string | null; current_reason: string; created_at: string; notes: string;
  approver: { full_name: string } | null; creator: { full_name: string } | null; wording_texts: { count: number }[] };

export default async function VersionsPage({ searchParams }: PageProps<"/admin/templates/versions">) {
  const access = await requireAccess("engagement_terms", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("wording_versions")
    .select("id, label, status, is_current, approved_at, current_reason, created_at, notes, approver:approved_by(full_name), creator:created_by(full_name), wording_texts(count)")
    .order("created_at", { ascending: false });
  const versions = (data ?? []) as unknown as V[];
  const draft = versions.find((v) => v.status === "draft");
  return (
    <>
      <PageHeader eyebrow="Template library" title="Wording versions"
        description="Letters, proposals and terms use the current approved version. Edit wording in a draft, preview it, then an owner approves it. Letters already made keep the wording they used."
        actions={canEdit(access, "engagement_terms") ? (draft
          ? <Link href={`/admin/templates/versions/${draft.id}`} className="btn">Continue draft {draft.label}</Link>
          : <form action={startDraft}><button className="btn" type="submit">Start a new version</button></form>) : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Version</th><th>Status</th><th>Changes from the original</th><th>Approved</th><th></th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}>
              <td className="font-medium"><Link href={`/admin/templates/versions/${v.id}`} className="text-navy-700 hover:underline">{v.label}</Link>
                {v.is_current && <span className="ml-2 rounded bg-lime-100 px-1.5 py-0.5 text-[11px] font-semibold text-navy-900">In use</span>}
                <span className="block text-xs text-muted">{v.notes || (v.creator ? `Started by ${v.creator.full_name}, ${formatDate(v.created_at)}` : "")}</span></td>
              <td className="capitalize">{v.status}</td>
              <td>{v.wording_texts?.[0]?.count ?? 0}</td>
              <td className="text-sm">{v.approved_at ? `${formatDateTime(v.approved_at)}${v.approver ? " by " + v.approver.full_name : ""}` : ""}
                {v.is_current && v.current_reason && v.current_reason !== "Approved" && <span className="block text-xs text-muted">Made current again: {v.current_reason}</span>}</td>
              <td className="text-right">
                {access.is_owner && v.status === "approved" && !v.is_current && (
                  <form action={makeCurrent} className="flex items-center justify-end gap-2">
                    <input type="hidden" name="id" value={v.id} />
                    <input name="reason" required minLength={5} placeholder="Reason" aria-label={`Reason to use ${v.label} again`} className="input h-8 w-44 text-sm" />
                    <button className="btn h-8 px-3 text-sm" type="submit">Use this version</button>
                  </form>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
