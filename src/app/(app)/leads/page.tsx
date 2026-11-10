import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { LEAD_STATUS, provinceName } from "@/lib/leads/provinces";
import { after } from "next/server";
import { readBusinessHours, runLeadAlerts } from "@/lib/leads/alerts";
import { WAITING_STATUSES } from "@/lib/business-hours";
import { LeadTimer } from "./lead-timer";

const OPEN = ["new", "call_needed", "quoted", "sent"];

// Leads from the public start page (brief "Lead flow").
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await requireAccess("leads", "view");
  const sp = await searchParams;
  const show = sp.show === "all" ? "all" : sp.show === "closed" ? "closed" : "open";
  after(() => runLeadAlerts({ throttle: true }).then(() => undefined, () => undefined));
  const hours = await readBusinessHours();
  const supabase = await createClient();
  let q = supabase.from("leads").select("id, route, status, first_name, last_name, province, source, created_at, staff:assigned_to(full_name)").order("created_at", { ascending: false }).limit(500);
  if (show === "open") q = q.in("status", OPEN);
  if (show === "closed") q = q.not("status", "in", `(${OPEN.join(",")})`);
  const rows = ((await q).data ?? []) as unknown as { id: string; route: string; status: string; first_name: string; last_name: string; province: string; source: string; created_at: string; staff: { full_name: string } | null }[];
  const chip = (k: string, text: string) => (
    <Link key={k} href={k === "open" ? "/leads" : `/leads?show=${k}`} aria-current={show === k ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[13px] ${show === k ? "border-navy-700 bg-navy-700 text-white" : "border-sand-200 bg-surface text-ink-2 hover:border-navy-300"}`}>{text}</Link>
  );
  return (
    <>
      <PageHeader title="Leads" description="Every request from the public start page. What the client entered is kept as sent; add notes on the lead." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="mb-4 flex gap-2">{chip("open", "Open")}{chip("closed", "Closed")}{chip("all", "All")}</div>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No leads here.</p> : (
          <table className="table">
            <thead><tr><th>Received</th><th>Name</th><th>For</th><th>Province</th><th>Status</th><th>Assigned to</th><th>Source</th></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-muted">{formatDateTime(l.created_at)}</td>
                <td><Link href={`/leads/${l.id}`} className="font-medium text-navy-700 hover:underline">{l.first_name} {l.last_name}</Link></td>
                <td>{l.route === "personal" ? "Personal tax" : "Company"}</td><td>{provinceName(l.province)}</td>
                <td>{LEAD_STATUS[l.status] ?? l.status}{WAITING_STATUSES.includes(l.status) && <span className="block text-xs"><LeadTimer since={l.created_at} hours={hours} /></span>}</td><td>{l.staff?.full_name ?? <span className="text-muted">Unassigned</span>}</td><td>{l.source}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
