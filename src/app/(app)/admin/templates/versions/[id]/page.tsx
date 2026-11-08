import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceHeader } from "@/components/studio/kit";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadStudioData } from "@/lib/studio/data";
import { wordingSamples } from "@/lib/studio/samples";
import { PIECES } from "@/lib/studio/wording-pieces";
import { WordingEditor } from "./wording-editor";
import { approveDraft, deleteDraft } from "../actions";

export default async function VersionPage({ params, searchParams }: PageProps<"/admin/templates/versions/[id]">) {
  const access = await requireAccess("engagement_terms", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: v } = await supabase.from("wording_versions").select("id, label, status, is_current, approved_at").eq("id", id).maybeSingle();
  if (!v) notFound();
  const [{ data: texts }, data] = await Promise.all([
    supabase.from("wording_texts").select("key, text").eq("version_id", id),
    loadStudioData(supabase, access),
  ]);
  const own = Object.fromEntries((texts ?? []).map((t) => [t.key, t.text]));
  const cur = data.wording?.texts ?? {};
  const date = v.approved_at ? new Date(v.approved_at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const samples = wordingSamples(data.signers, { id: v.id, label: v.label, date, texts: own });
  const pieces = PIECES.map((p) => ({ key: p.key, original: p.text, current: cur[p.key] ?? p.text, draft: own[p.key] ?? p.text }));
  const editable = v.status === "draft" && canEdit(access, "engagement_terms");
  const changed = pieces.filter((p) => p.draft !== p.current).length;
  return (
    <>
      <WorkspaceHeader title={`Wording ${v.label}`} description={v.status === "draft" ? "Draft: not used in letters until an owner approves it." : v.is_current ? "Approved and in use for new letters." : "Approved earlier. Read only."} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 text-sm">
        <Link href="/admin/templates/versions" className="text-navy-700 underline">All versions</Link>
        {v.status === "draft" && access.is_owner && (
          <form action={approveDraft} className="flex flex-wrap items-center gap-2 rounded-lg border border-sand-200 bg-surface px-3 py-2">
            <input type="hidden" name="id" value={v.id} />
            <label className="flex items-center gap-2"><input type="checkbox" name="read" required className="h-4 w-4 accent-navy-700" /> I read the {changed} change{changed === 1 ? "" : "s"}</label>
            <button className="btn h-8 px-3 text-sm" type="submit" disabled={changed === 0}>Approve {v.label} and use it</button>
          </form>
        )}
        {v.status === "draft" && canEdit(access, "engagement_terms") && (
          <form action={deleteDraft}><input type="hidden" name="id" value={v.id} /><button className="text-danger underline" type="submit">Delete this draft</button></form>
        )}
      </div>
      <WordingEditor versionId={v.id} label={v.label} currentLabel={data.wording?.label ?? "EL v3.31"} editable={editable} samples={samples} pieces={pieces} />
    </>
  );
}
