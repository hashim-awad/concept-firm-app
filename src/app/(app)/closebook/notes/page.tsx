import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ds/primitives";
import { formatDate, todayToronto } from "@/lib/dates";

// Closebook, Review notes (round 8, Hashim, Nov 24, 2026): every review note not yet cleared, across all
// files, oldest first, each linked to its step. A fixed note waits for the reviewer to clear it.
const STEP: Record<string, string> = { setup: "1. Set up the file", opening: "2. Opening balances", records: "3. Records", code: "4. Code or match",
  entries: "5. Adjusting entries", review: "6. Review", mapping: "7. GIFI mapping" };
const TARGET: Record<string, string> = { step: "The step", account: "Account", entry: "Entry", bank_line: "Bank line" };
type Row = { id: string; file_id: string; step: string; target_type: string; target_label: string; body: string; status: string; created_by: string; created_at: string;
  file: { year_end: string; client: { legal_name: string } | null } | null };

export default async function ReviewNotesPage() {
  await requireAccess("closebook", "view");
  const supabase = await createClient();
  const [{ data }, { data: staff }] = await Promise.all([
    supabase.from("cb_review_notes").select("id, file_id, step, target_type, target_label, body, status, created_by, created_at, file:file_id(year_end, client:client_id(legal_name))")
      .neq("status", "cleared").order("created_at"),
    supabase.from("staff").select("id, full_name"),
  ]);
  const names = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name.split(" ")[0]]));
  const rows = (data ?? []) as unknown as Row[];
  const today = Date.parse(todayToronto());
  const days = (at: string) => Math.max(0, Math.round((today - Date.parse(at.slice(0, 10))) / 86400000));
  return (
    <>
      <PageHeader title="Review notes" description="Every review note not yet cleared, across all files, oldest first. Open notes wait for the preparer; fixed notes wait for the reviewer to clear them." />
      {!rows.length ? <section className="card"><EmptyState icon={<MessageSquareWarning />} title="No review notes open" description="Notes appear here when the reviewer adds one to a step, an account, an entry or a bank line." /></section> : (
        <section className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Added</th><th>File</th><th>Step</th><th>On</th><th>Note</th><th>Status</th></tr></thead>
            <tbody>{rows.map((n) => (
              <tr key={n.id}>
                <td className="whitespace-nowrap">{formatDate(n.created_at)}<span className="block text-xs text-ink-3">{days(n.created_at)} day{days(n.created_at) === 1 ? "" : "s"} · {names.get(n.created_by) ?? ""}</span></td>
                <td><Link href={`/closebook/${n.file_id}?step=${n.step}#note-${n.id}`} className="font-medium text-navy-700 underline">{n.file?.client?.legal_name ?? "File"}</Link>
                  <span className="block text-xs text-ink-3">Year-end {formatDate(n.file?.year_end)}</span></td>
                <td className="whitespace-nowrap">{STEP[n.step] ?? n.step}</td>
                <td>{TARGET[n.target_type]}{n.target_label ? <span className="block text-xs text-ink-2">{n.target_label}</span> : null}</td>
                <td className="max-w-md text-sm">{n.body.length > 200 ? `${n.body.slice(0, 200)}…` : n.body}</td>
                <td>{n.status === "open"
                  ? <span className="inline-flex rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger ring-1 ring-[#F3C4BE] ring-inset">Open</span>
                  : <span className="inline-flex rounded-full bg-navy-100 px-2.5 py-0.5 text-xs font-medium text-navy-800 ring-1 ring-navy-200 ring-inset">Fixed: to clear</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
