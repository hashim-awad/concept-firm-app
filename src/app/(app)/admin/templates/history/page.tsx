import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { PIECE, toFriendly } from "@/lib/studio/wording-pieces";
import { restoreVersion } from "../actions";

type V = { id: string; label: string; status: string; is_current: boolean; approved_at: string | null; current_reason: string; based_on: string | null;
  approver: { full_name: string } | null; wording_texts: { key: string; text: string }[] };

export default async function HistoryPage({ searchParams }: PageProps<"/admin/templates/history">) {
  const access = await requireAccess("engagement_terms", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("wording_versions")
    .select("id, label, status, is_current, approved_at, current_reason, based_on, approver:approved_by(full_name), wording_texts(key, text)")
    .eq("status", "approved").order("approved_at", { ascending: false });
  const versions = (data ?? []) as unknown as V[];
  const byId = new Map(versions.map((v) => [v.id, v]));
  // What each version changed compared with the one it was based on.
  const diff = (v: V) => {
    const base = v.based_on ? Object.fromEntries((byId.get(v.based_on)?.wording_texts ?? []).map((t) => [t.key, t.text])) : {};
    const mine = Object.fromEntries(v.wording_texts.map((t) => [t.key, t.text]));
    return [...new Set([...Object.keys(base), ...Object.keys(mine)])].filter((k) => base[k] !== mine[k] && PIECE.has(k))
      .map((k) => ({ k, before: toFriendly(k, base[k] ?? PIECE.get(k)!.text), after: toFriendly(k, mine[k] ?? PIECE.get(k)!.text) }));
  };
  return (
    <>
      <Link href="/admin/templates" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />All templates</Link>
      <PageHeader title="History" description="Every published version of your wording. Each letter records the version it used. An owner can restore an earlier version with a reason." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <ul className="grid gap-4">
        {versions.map((v) => {
          const d = v.based_on ? diff(v) : [];
          return (
            <li key={v.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{v.label}</h2>
                {v.is_current && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-[#14532F]">In use</span>}
                <span className="text-sm text-ink-2">{v.approved_at ? `Published ${formatDateTime(v.approved_at)}${v.approver ? ` by ${v.approver.full_name}` : ""}` : ""}</span>
              </div>
              {!v.based_on ? <p className="text-sm text-muted">The original wording from Concept Studio.</p> : (
                <details>
                  <summary className="cursor-pointer text-sm text-navy-700">{d.length} change{d.length === 1 ? "" : "s"} from the version before</summary>
                  <ul className="mt-2 grid gap-2 text-sm">{d.map((x) => (
                    <li key={x.k} className="grid gap-2 md:grid-cols-2"><p className="rounded bg-sand-50 p-2 whitespace-pre-wrap">{x.before}</p><p className="rounded bg-[#FFF4CC] p-2 whitespace-pre-wrap">{x.after}</p></li>
                  ))}</ul>
                </details>
              )}
              {v.is_current && v.current_reason && !["Approved", ""].includes(v.current_reason) && <p className="text-xs text-muted">Restored: {v.current_reason}</p>}
              {access.is_owner && !v.is_current && (
                <form action={restoreVersion} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={v.id} />
                  <input name="reason" required minLength={5} placeholder="Why restore this version?" aria-label={`Reason to restore ${v.label}`} className="input h-9 max-w-sm text-sm" />
                  <button className="btn h-9 px-3 text-sm" type="submit">Restore {v.label}</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
