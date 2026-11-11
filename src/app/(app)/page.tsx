import Link from "next/link";
import { QUOTE_KIND, QUOTE_STATUS, WAITING, type QuoteKind, type QuoteStatus } from "@/lib/quotes";
import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canView, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate, todayToronto } from "@/lib/dates";
import { t2Deadlines, type T2Client } from "@/lib/deadlines";
import { T2DeadlineTable } from "./t2-deadline-table";
import { after } from "next/server";
import { readBusinessHours, runLeadAlerts } from "@/lib/leads/alerts";
import { LeadTimer } from "./leads/lead-timer";

const AHEAD_DAYS = 90;

function Card({ title, count, children, soon }: { title: string; count?: number; children?: React.ReactNode; soon?: string }) {
  return (
    <section className={`card ${soon ? "opacity-70" : ""}`}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span className="flex-1">{title}</span>
        {soon ? <span className="rounded border border-sand-300 px-1.5 py-0.5 text-[11px] font-semibold text-ink-3">Soon</span>
          : count != null && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${count ? "bg-lime-500 text-navy-900" : "bg-sand-100 text-ink-3"}`}>{count}</span>}
      </h2>
      {soon ? <p className="text-sm text-muted">{soon}</p> : children}
    </section>
  );
}

// My day: what needs attention today. Leads and gates arrive with Phase 2 and Phase 3.
export default async function MyDayPage({ searchParams }: PageProps<"/">) {
  const access = await requireAccess();
  const sp = await searchParams;
  const firstName = access.full_name.split(" ")[0];
  const today = todayToronto();
  const seeDocs = canView(access, "documents");
  const seeClients = canView(access, "clients"), editClients = canEdit(access, "clients");
  const seeLeads = canView(access, "leads");
  type L = { id: string; first_name: string; last_name: string; route: string; created_at: string };
  const supabase = await createClient();
  // Lead alerts also run when staff open My day (the scheduler runs only on Live), at most once a minute.
  if (seeLeads) after(() => runLeadAlerts({ throttle: true }).then(() => undefined, () => undefined));
  const hours = seeLeads ? await readBusinessHours() : null;
  const leadsNew = seeLeads ? (((await supabase.from("leads").select("id, first_name, last_name, route, created_at").eq("status", "new").order("created_at")).data ?? []) as L[]) : [];

  type P = { id: string; client: string; kind: QuoteKind; status: QuoteStatus; sent_at: string | null; valid_until: string | null };
  type E = { id: string; title: string; type: string; status: string; fiscal_year_end: string | null; el_issued: string | null; client_id: string | null; clients: { legal_name: string } | null };
  let proposals: P[] = [], letters: E[] = [];
  if (seeLeads) {
    // Quotes sent and waiting for the client's signature, soonest to expire first.
    await supabase.rpc("expire_quotes");
    proposals = (((await supabase.rpc("quote_list")).data ?? []) as P[]).filter((q) => WAITING.includes(q.status))
      .sort((a, b) => (a.valid_until ?? "").localeCompare(b.valid_until ?? ""));
  }
  if (seeDocs) {
    letters = ((await supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, client_id, clients(legal_name)").eq("status", "EL sent").order("el_issued")).data ?? []) as unknown as E[];
  }

  // T2 deadlines (decision 43): T2 clients from TaxDome, not excluded, active.
  let t2: T2Client[] = [], doneKeys = new Set<string>();
  if (seeClients) {
    const [c, d] = await Promise.all([
      supabase.from("clients").select("id, legal_name, year_end_md, t2_balance_due_months").contains("taxdome_tags", ["T2"]).eq("t2_exclude_deadlines", false).eq("status", "active").order("legal_name"),
      supabase.from("t2_deadline_done").select("client_id, year_end, kind"),
    ]);
    t2 = (c.data ?? []) as T2Client[];
    doneKeys = new Set((d.data ?? []).map((x: { client_id: string; year_end: string; kind: string }) => `${x.client_id}|${x.year_end}|${x.kind}`));
  }
  const deadlines = t2Deadlines(t2, today, doneKeys, AHEAD_DAYS);
  const noYearEnd = t2.filter((c) => !/^\d{2}-\d{2}$/.test(c.year_end_md));


  return (
    <>
      <PageHeader title={`Good day, ${firstName}`} description={`My day · ${formatDate(today)}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {!seeDocs && !seeClients && !seeLeads ? <p className="card text-sm text-muted">Nothing to show for your role yet.</p> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {seeLeads ? (
            <Card title="Leads to review" count={leadsNew.length}>
              {leadsNew.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <ul className="grid gap-2 text-sm">{leadsNew.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/leads/${l.id}`} className="font-medium text-navy-700 hover:underline">{l.first_name} {l.last_name}</Link>
                    <span className="text-muted">{l.route === "personal" ? "Personal tax" : "Company"} · received {formatDate(l.created_at)} ·</span>
                    <LeadTimer since={l.created_at} hours={hours} />
                  </li>
                ))}{leadsNew.length > 8 && <li><Link href="/leads" className="text-navy-700 underline">All {leadsNew.length} new leads</Link></li>}</ul>
              )}
            </Card>
          ) : <Card title="Leads to review" soon="Your role does not include leads." />}
          <Card title="Gates waiting" soon="Year-end gates arrive with Year-End & T2 (Phase 3)." />
{seeLeads && (
          <Card title="Quotes waiting for signature" count={proposals.length}>
            {proposals.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="grid gap-2 text-sm">{proposals.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href="/quotes?status=sent" className="font-medium text-navy-700 hover:underline">{r.client}</Link>
                  <span className="text-muted">{QUOTE_KIND[r.kind]}, {QUOTE_STATUS[r.status].toLowerCase()} {formatDate(r.sent_at)}</span>
                  {r.valid_until && <span className="text-muted">expires {formatDate(r.valid_until)}</span>}
                </li>
              ))}</ul>
            )}
          </Card>
        )}
          <Card title="Engagement letters awaiting signature" count={letters.length}>
            {letters.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="grid gap-2 text-sm">{letters.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/documents/engagements/${e.id}`} className="font-medium text-navy-700 hover:underline">{e.clients?.legal_name ?? e.title}</Link>
                  <span className="text-muted">{e.type} · issued {formatDate(e.el_issued)}</span>
                </li>
              ))}</ul>
            )}
          </Card>
          <div className="lg:col-span-2">
            <Card title={`T2 deadlines, overdue or in the next ${AHEAD_DAYS} days`} count={deadlines.length}>
              {deadlines.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <T2DeadlineTable editable={editClients} items={deadlines.map((x) => ({ ...x, yearEndText: formatDate(x.yearEnd), dueText: formatDate(x.due) }))} />
              )}
              {noYearEnd.length > 0 && (
                <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
                  <p className="font-medium">{noYearEnd.length} T2 client{noYearEnd.length === 1 ? " has" : "s have"} no fiscal year-end in TaxDome, so no deadlines are shown for {noYearEnd.length === 1 ? "it" : "them"}:</p>
                  <p className="mt-1">{noYearEnd.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/clients/${c.id}`} className="underline">{c.legal_name}</Link></span>)}</p>
                </div>
              )}
              <p className="mt-3 text-xs text-muted">T2 clients from the TaxDome import. Balance due 2 or 3 months after the year end (set on each client); T2 filing due 6 months after (month-end year ends: last day of the month). Weekends and holidays are not moved. Shows the latest year end and the next one; press Done when a return is filed or a balance is paid. Excluded clients are left out.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
