import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { after } from "next/server";
import { readBusinessHours, runLeadAlerts } from "@/lib/leads/alerts";
import { WAITING_STATUSES } from "@/lib/business-hours";
import { STATUS_CLASS, isPhone, leadNext, leadSource, leadStatus, leadType } from "@/lib/leads/list";
import { LeadTimer } from "./lead-timer";
import { checkAlertsNow } from "./actions";

const OPEN = ["new", "call_needed", "out_of_scope", "quoted", "sent"];
type Row = { id: string; route: string; status: string; first_name: string; last_name: string; company_name: string; source: string; answers: Record<string, unknown>; created_at: string;
  staff: { full_name: string } | null; taker: { full_name: string } | null };

// Leads (front office batch, section 2; mockup 1-Leads): every request, from the online start page or
// by phone, in one list. What the client said is kept as given.
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const access = await requireAccess("leads", "view");
  const sp = await searchParams;
  const show = sp.show === "all" ? "all" : sp.show === "closed" ? "closed" : "open";
  const src = sp.src === "website" || sp.src === "phone" ? sp.src : "any";
  after(() => runLeadAlerts({ throttle: true }).then(() => undefined, () => undefined));
  const hours = await readBusinessHours();
  const supabase = await createClient();
  let q = supabase.from("leads").select("id, route, status, first_name, last_name, company_name, source, answers, created_at, staff:assigned_to(full_name), taker:taken_by(full_name)").order("created_at", { ascending: false }).limit(500);
  if (show === "open") q = q.in("status", OPEN);
  if (show === "closed") q = q.not("status", "in", `(${OPEN.join(",")})`);
  const rows = (((await q).data ?? []) as unknown as Row[]).filter((l) => src === "any" || (src === "phone") === isPhone(l.source));
  const link = (k: "show" | "src", v: string) => {
    const p = new URLSearchParams();
    const s = k === "show" ? v : show, o = k === "src" ? v : src;
    if (s !== "open") p.set("show", s);
    if (o !== "any") p.set("src", o);
    return "/leads" + (p.size ? `?${p}` : "");
  };
  const chip = (href: string, on: boolean, text: string) => (
    <Link key={text} href={href} aria-current={on ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[13px] ${on ? "border-navy-700 bg-navy-700 text-white" : "border-sand-200 bg-surface text-ink-2 hover:border-navy-300"}`}>{text}</Link>
  );
  return (
    <>
      <PageHeader title="Leads" description="Every request, from the online start page or by phone. What the client said is kept as given."
        actions={<>
          {access.is_owner && (
            <form action={checkAlertsNow}>
              <button type="submit" className={buttonClass("secondary")} title="Owners: run the lead alert check now (first alerts and 45-minute reminders) and see what it did">Check alerts now</button>
            </form>
          )}
          {canEdit(access, "leads") && <Link href="/leads/phone" className={buttonClass("primary")}><PhoneCall className="h-4 w-4" aria-hidden />New lead by phone</Link>}
        </>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip(link("show", "open"), show === "open", "Open")}{chip(link("show", "closed"), show === "closed", "Closed")}{chip(link("show", "all"), show === "all", "All")}
        <span className="mx-1 h-5 w-px bg-sand-200" aria-hidden />
        {chip(link("src", "any"), src === "any", "Any source")}{chip(link("src", "website"), src === "website", "Website")}{chip(link("src", "phone"), src === "phone", "Phone")}
      </div>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No leads here.</p> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Source</th><th>Received</th><th>Status</th><th>Next</th></tr></thead>
            <tbody>{rows.map((l) => {
              const status = leadStatus(l.status);
              return (
                <tr key={l.id}>
                  <td><Link href={`/leads/${l.id}`} className="font-medium text-navy-700 hover:underline">{l.route === "company" && l.company_name ? l.company_name : `${l.first_name} ${l.last_name}`}</Link>
                    {l.route === "company" && l.company_name && <span className="block text-xs text-muted">{l.first_name} {l.last_name}</span>}</td>
                  <td>{leadType(l)}</td>
                  <td>{leadSource({ source: l.source, taken: l.taker?.full_name ?? null })}</td>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(l.created_at)}</td>
                  <td><span className={`rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLASS[status] ?? ""}`}>{status}</span>
                    {WAITING_STATUSES.includes(l.status) && !isPhone(l.source) && <span className="mt-1 block text-xs"><LeadTimer since={l.created_at} hours={hours} /></span>}</td>
                  <td className="text-sm">{leadNext({ route: l.route, status: l.status, source: l.source, answers: l.answers ?? {}, assigned: l.staff?.full_name ?? null, taken: l.taker?.full_name ?? null, hasQuote: true })}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
      <p className="mt-2 text-xs text-muted">A signed quote closes the lead and its letter is filed under Engagement letters.</p>
    </>
  );
}
