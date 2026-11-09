import Link from "next/link";
import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate, todayToronto } from "@/lib/dates";
import { daysBetween, t2FilingDeadline } from "@/lib/deadlines";

// Engagement types that include a T2 return.
const T2_TYPES = ["Year-end compilation + T2", "Monthly full service", "T2 only"];
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
  const pricing = canView(access, "pricing");
  const supabase = await createClient();

  type P = { id: string; title: string; date_sent: string | null; valid_until: string | null };
  type E = { id: string; title: string; type: string; status: string; fiscal_year_end: string | null; el_issued: string | null; client_id: string | null; clients: { legal_name: string } | null };
  let proposals: P[] = [], letters: E[] = [], open: E[] = [];
  if (seeDocs) {
    const [p, l, o] = await Promise.all([
      pricing ? supabase.from("proposals").select("id, title, date_sent, valid_until").eq("status", "Sent").order("valid_until", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] }),
      supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, client_id, clients(legal_name)").eq("status", "EL sent").order("el_issued"),
      supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, client_id, clients(legal_name)").in("type", T2_TYPES).not("status", "in", "(Issued,Cancelled)").not("fiscal_year_end", "is", null),
    ]);
    proposals = (p.data ?? []) as P[];
    letters = (l.data ?? []) as unknown as E[];
    open = (o.data ?? []) as unknown as E[];
  }
  const deadlines = open.map((e) => ({ e, due: t2FilingDeadline(e.fiscal_year_end!) }))
    .map((x) => ({ ...x, days: daysBetween(today, x.due) }))
    .filter((x) => x.days <= AHEAD_DAYS).sort((a, b) => a.days - b.days);

  const due = (days: number) => days < 0 ? <span className="font-medium text-danger">{-days} day{days === -1 ? "" : "s"} overdue</span>
    : days === 0 ? <span className="font-medium text-danger">Due today</span> : <span className="text-muted">in {days} day{days === 1 ? "" : "s"}</span>;

  return (
    <>
      <PageHeader title={`Good day, ${firstName}`} description={`My day · ${formatDate(today)}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {!seeDocs ? <p className="card text-sm text-muted">Nothing to show for your role yet.</p> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Leads to review" soon="Leads arrive with the public start page (Phase 2)." />
          <Card title="Gates waiting" soon="Year-end gates arrive with Year-End & T2 (Phase 3)." />
{pricing && (
          <Card title="Proposals awaiting signature" count={proposals.length}>
            {proposals.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="grid gap-2 text-sm">{proposals.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href="/proposals?status=Sent" className="font-medium text-navy-700 hover:underline">{r.title}</Link>
                  <span className="text-muted">sent {formatDate(r.date_sent)}</span>
                  {r.valid_until && (r.valid_until < today ? <span className="text-danger">past valid date {formatDate(r.valid_until)}</span> : <span className="text-muted">valid until {formatDate(r.valid_until)}</span>)}
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
            <Card title={`T2 filing deadlines, overdue or in the next ${AHEAD_DAYS} days`} count={deadlines.length}>
              {deadlines.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <table className="table">
                  <thead><tr><th>Client</th><th>Engagement</th><th>Year end</th><th>T2 due</th><th></th></tr></thead>
                  <tbody>{deadlines.map(({ e, due: d, days }) => (
                    <tr key={e.id}>
                      <td>{e.client_id ? <Link href={`/clients/${e.client_id}`} className="font-medium text-navy-700 hover:underline">{e.clients?.legal_name ?? ""}</Link> : ""}</td>
                      <td>{e.type}<span className="block text-xs text-muted">{e.status}</span></td>
                      <td>{formatDate(e.fiscal_year_end)}</td><td>{formatDate(d)}</td><td>{due(days)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-muted">T2 due six months after the year end (month-end year ends: last day of the sixth month). Weekends and holidays are not moved. Open engagements only (not Issued or Cancelled). Tax payment deadlines arrive with Year-End &amp; T2.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
