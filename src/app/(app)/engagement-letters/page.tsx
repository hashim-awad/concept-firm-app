import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { requireAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { PageTabs } from "@/components/page-tabs";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";

type Row = { id: string; kind: string; status: string; client: string; letter: string; came_from: string; sent_at: string | null; signed_at: string | null; lead_id: string | null };
const WAIT = ["sent", "viewed"];
const STATUS: Record<string, [string, string]> = {
  sent: ["Waiting for signature", "bg-navy-50 text-navy-700"], viewed: ["Waiting for signature", "bg-navy-50 text-navy-700"],
  signed: ["Signed", "bg-success-soft text-success"], declined: ["Declined", "bg-danger/10 text-danger"], expired: ["Expired", "bg-sand-100 text-ink-3"],
};

// Engagement letters (front office batch, section 7; mockup 3-Engagement-letters): every letter, whatever
// the path. A signed quote or proposal is its client's letter; New letter is for clients who never go
// through a quote (renewals, a new service, a changed fee).
export default async function EngagementLettersPage({ searchParams }: PageProps<"/engagement-letters">) {
  const sp = await searchParams;
  // The Letter Builder moved to New letter; old links (with a letter type, client or document) still work.
  if (["type", "client", "doc", "proposal"].some((k) => typeof sp[k] === "string")) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    redirect(`/engagement-letters/new?${q}`);
  }
  // Owners only (round 8 item 7): the engagement letter status screen is not for staff roles.
  const access = await requireAccess();
  if (!access.is_owner || (!canView(access, "documents") && !canView(access, "leads"))) redirect("/?error=owners-only");
  const tab = sp.tab === "signed" ? "signed" : sp.tab === "all" ? "all" : "waiting";
  const supabase = await createClient();
  await supabase.rpc("expire_quotes");
  const { data, error } = await supabase.rpc("letter_list");
  const all = (data ?? []) as Row[];
  const waiting = all.filter((r) => WAIT.includes(r.status));
  const rows = tab === "waiting" ? waiting : tab === "signed" ? all.filter((r) => r.status === "signed") : all;
  const open = (r: Row) => (r.kind === "letter" ? `/engagement-letters/${r.id}` : r.kind === "proposal" ? `/quotes/${r.id}` : r.lead_id ? `/leads/${r.lead_id}/quote` : "/engagement-letters");
  return (
    <>
      <PageHeader title="Engagement letters" description="Every signed letter, whatever the path. New letters for existing clients start here."
        actions={access.is_owner ? <Link href="/engagement-letters/new" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New letter</Link> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error) ?? (error ? error.message : undefined)} />
      <PageTabs label="Letters" current={tab} tabs={[
        { key: "waiting", href: "/engagement-letters", label: `Waiting for signature (${waiting.length})` },
        { key: "signed", href: "/engagement-letters?tab=signed", label: "Signed" },
        { key: "all", href: "/engagement-letters?tab=all", label: "All" },
      ]} />
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">{tab === "waiting" ? "No letters are waiting for a signature." : "No letters here yet."}</p> : (
          <table className="table">
            <thead><tr><th>Client</th><th>Letter</th><th>Came from</th><th>Sent</th><th>Signed</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => {
              const [label, cls] = STATUS[r.status] ?? [r.status, ""];
              return (
                <tr key={r.id}>
                  <td><Link href={open(r)} className="font-medium text-navy-700 hover:underline">{r.client}</Link></td>
                  <td>{r.letter}</td>
                  <td>{r.came_from}</td>
                  <td className="whitespace-nowrap">{formatDate(r.sent_at)}</td>
                  <td className="whitespace-nowrap">{r.signed_at ? formatDate(r.signed_at) : ""}</td>
                  <td><span className={`rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>{label}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
      <p className="mt-2 text-xs text-muted">&ldquo;New letter&rdquo; is for clients who never go through a quote: renewals, a new service, a changed fee. A Final letter is sent for online signing; Download PDF stays in the Letter Builder.</p>
    </>
  );
}
