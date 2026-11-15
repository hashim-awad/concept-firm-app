import Link from "next/link";
import { QUOTE_KIND, QUOTE_STATUS, WAITING, type QuoteKind, type QuoteStatus } from "@/lib/quotes";
import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canView, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate, todayToronto } from "@/lib/dates";
import { deadlineKey, t2Deadlines, t2DeadlinesAll, t2DeadlinesDone, type DeadlineItem, type T2Client } from "@/lib/deadlines";
import { InfoTip } from "@/components/ds/info-tip";
import { T2DeadlineTable, type DeadlineRow } from "./t2-deadline-table";
import { MarkDoneBeforeDialog } from "./mark-done-before-dialog";
import { KIND_FALLBACK, loadKindLabels, loadT2, torontoDate, type DoneRow } from "./my-day-deadlines";
import { undoDeadlineBatch } from "./my-day-actions";
import { after } from "next/server";
import { readBusinessHours, runLeadAlerts } from "@/lib/leads/alerts";
import { LeadTimer } from "./leads/lead-timer";

const AHEAD_DAYS = 90;

// A My day card. `info` is the explanation, behind the "i" next to the title; `actions` sit in the header.
function Card({ title, count, children, soon, info, actions }: { title: string; count?: number; children?: React.ReactNode; soon?: string; info?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className={`card ${soon ? "opacity-70" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex flex-1 items-center font-semibold">{title}{info && <InfoTip label={`More about ${title}`}>{info}</InfoTip>}</h2>
        {actions}
        {soon ? <span className="rounded border border-sand-300 px-1.5 py-0.5 text-[11px] font-semibold text-ink-3">Soon</span>
          : count != null && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${count ? "bg-lime-500 text-navy-900" : "bg-sand-100 text-ink-3"}`}>{count}</span>}
      </div>
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
  // Letters waiting for signature: the same list as Engagements > Letters (Studio and outside Studio).
  type W = { id: string; source: "studio" | "outside"; kind: string; letter_type: string; status: string; client: string; sent_at: string | null; valid_until: string | null; lead_id: string | null };
  let proposals: P[] = [], letters: W[] = [];
  const seeLetters = seeDocs || seeLeads;
  if (seeLetters) await supabase.rpc("expire_quotes");
  if (seeLeads) {
    // Quotes sent and waiting for the client's signature, soonest to expire first.
    proposals = (((await supabase.rpc("quote_list")).data ?? []) as P[]).filter((q) => WAITING.includes(q.status))
      .sort((a, b) => (a.valid_until ?? "").localeCompare(b.valid_until ?? ""));
  }
  if (seeLetters) {
    letters = (((await supabase.rpc("letter_list")).data ?? []) as W[])
      .filter((r) => ["sent", "viewed"].includes(r.status) && (r.source === "outside" || (r.valid_until ?? "") >= today));
  }
  const letterHref = (r: W) => r.source === "outside" ? `/documents/engagements/${r.id}` : r.kind === "letter" ? `/engagement-letters/${r.id}`
    : r.kind === "proposal" ? `/quotes/${r.id}` : r.lead_id ? `/leads/${r.lead_id}/quote` : "/quotes";
  const letterType = (t: string) => (t === "t1" ? "T1" : "Corporate");

  // T2 deadlines (decision 43): T2 clients from TaxDome, not excluded, active.
  const showDone = sp.done === "1";
  let t2: T2Client[] = [], doneRows: DoneRow[] = [], doneKeys = new Set<string>(), labels: Record<string, string> = KIND_FALLBACK;
  if (seeClients) {
    [{ clients: t2, done: doneRows, doneKeys }, labels] = await Promise.all([loadT2(supabase), loadKindLabels(supabase)]);
  }
  const deadlines = t2Deadlines(t2, today, doneKeys, AHEAD_DAYS);
  const byKey = new Map(doneRows.map((d) => [deadlineKey({ clientId: d.client_id, yearEnd: d.year_end, kind: d.kind }), d]));
  const staffIds = [...new Set(doneRows.map((d) => d.done_by).filter((x): x is string => !!x))];
  const staffNames = new Map<string, string>();
  if (showDone && staffIds.length) {
    for (const x of ((await supabase.from("staff").select("id, full_name").in("id", staffIds)).data ?? []) as { id: string; full_name: string }[]) staffNames.set(x.id, x.full_name);
  }
  const row = (x: DeadlineItem): DeadlineRow => {
    const key = deadlineKey(x), d = byKey.get(key);
    return {
      key, clientId: x.clientId, client: x.client, kindLabel: labels[x.kind] ?? x.kind, yearEndText: formatDate(x.yearEnd), dueText: formatDate(x.due), days: x.days,
      done: d && doneKeys.has(key) ? {
        by: d.done_by ? staffNames.get(d.done_by) ?? "A former staff member" : d.source === "efile" ? "Closebook" : "Not recorded",
        when: formatDate(d.done_at), reason: d.reason,
      } : undefined,
    };
  };
  const tableRows = (showDone ? [...deadlines, ...t2DeadlinesDone(t2, today, doneKeys, AHEAD_DAYS)].sort((a, b) => a.due.localeCompare(b.due) || a.client.localeCompare(b.client)) : deadlines).map(row);
  // Owners: every open deadline for the latest and next year end, for "Mark done before a date" (no 90-day limit).
  const candidates = access.is_owner && seeClients ? t2DeadlinesAll(t2, today).filter((x) => !doneKeys.has(deadlineKey(x)))
    .map((x) => ({ key: deadlineKey(x), clientId: x.clientId, client: x.client, kind: x.kind, due: x.due, yearEndText: formatDate(x.yearEnd), dueText: formatDate(x.due) })) : [];
  // Owners: batches marked done today can be undone in one step. The date comes from the activity log.
  type Batch = { id: string; count: number; reason: string; before: string | null };
  const batches: Batch[] = [];
  if (access.is_owner) {
    for (const d of doneRows) {
      if (d.source !== "batch" || !d.batch_id || torontoDate(d.done_at) !== today) continue;
      const b = batches.find((x) => x.id === d.batch_id);
      if (b) b.count++; else batches.push({ id: d.batch_id, count: 1, reason: d.reason, before: null });
    }
    if (batches.length) {
      const { data } = await supabase.from("activity_log").select("entity_id, details").eq("action", "deadlines_marked_done_before").in("entity_id", batches.map((b) => b.id));
      for (const a of (data ?? []) as { entity_id: string; details: { before?: unknown } | null }[]) {
        const before = a.details?.before, b = batches.find((x) => x.id === a.entity_id);
        if (b && typeof before === "string" && /^\d{4}-\d{2}-\d{2}$/.test(before)) b.before = before;
      }
    }
  }
  // Round 14: each s.15(2) repayment date not yet confirmed in the client's next file. Owners see every
  // file; other staff the files they prepare.
  const seeCb = canView(access, "closebook");
  type S = { file_id: string; client_name: string; year_end: string; shareholder: number; accounts: string; amount: number; due_on: string; next_file: string | null; unpaid: number | null };
  const s152 = seeCb ? (((await supabase.rpc("cb_sh_due_list")).data ?? []) as S[]) : [];
  const noYearEnd = t2.filter((c) => !/^\d{2}-\d{2}$/.test(c.year_end_md));

  return (
    <>
      <PageHeader title={`Good day, ${firstName}`} description={`My day · ${formatDate(today)}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {!seeDocs && !seeClients && !seeLeads && !seeCb ? <p className="card text-sm text-muted">Nothing to show for your role yet.</p> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
          {seeLetters && (
            <Card title="Letters waiting for signature" count={letters.length}>
              {letters.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <ul className="grid gap-2 text-sm">{letters.slice(0, 8).map((r) => (
                  <li key={`${r.source}|${r.id}`} className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={letterHref(r)} className="font-medium text-navy-700 hover:underline">{r.client}</Link>
                    <span className="text-muted">{letterType(r.letter_type)}{r.sent_at && ` · sent ${formatDate(r.sent_at)}`}</span>
                    {r.source === "outside" && <span className="rounded-full bg-[#efe9fb] px-2 py-0.5 text-[11px] font-bold text-[#5b3fa0]">Outside Studio</span>}
                  </li>
                ))}{letters.length > 8 && <li><Link href="/engagements?tab=letters" className="text-navy-700 underline">All {letters.length} letters waiting</Link></li>}</ul>
              )}
            </Card>
          )}
          {seeCb && (
            <Card title="Shareholder loans: s.15(2) repayment dates" count={s152.length}
              info={<>A shareholder who owes the company at year end must repay it within one year after that year end (s.15(2.6)), or it is income to them. Only this year&rsquo;s part of the balance is listed: a balance left from the year before has passed its date and is with the reviewer. Each date stays here until the client&rsquo;s next Closebook file confirms it was repaid in full.</>}>
              {s152.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <ul className="grid gap-2 text-sm">{s152.map((x) => (
                  <li key={`${x.file_id}|${x.shareholder}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`font-semibold ${x.due_on < today ? "text-danger" : ""}`}>Repay by {formatDate(x.due_on)}</span>
                    <Link href={`/closebook/${x.file_id}?step=entries&paper=sh`} className="font-medium text-navy-700 hover:underline">{x.client_name}</Link>
                    <span className="text-muted">Shareholder {x.shareholder}: {Number(x.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} owed from loans made in the year to {formatDate(x.year_end)} ({x.accounts})</span>
                    <span className="text-muted">{x.unpaid !== null ? `· next year's file: ${Number(x.unpaid).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} not repaid, with the reviewer` : x.next_file ? "· next year's file: not confirmed yet" : "· next year's file not started"}</span>
                  </li>
                ))}</ul>
              )}
            </Card>
          )}
          <div className="lg:col-span-2">
            <Card title={`T2 deadlines, overdue or in the next ${AHEAD_DAYS} days`} count={deadlines.length}
              info={<>T2 clients from the TaxDome import. Balance due 2 or 3 months after the year end (set on each client); T2 filing due 6 months after (month-end year ends: last day of the month). Weekends and holidays are not moved. Shows the latest year end and the next one; press Done when a return is filed or a balance is paid. The T2 filing deadline is marked done by itself when Closebook records the EFILE confirmation number for that client&rsquo;s year end. Excluded clients are left out.</>}
              actions={<>
                <Link href={showDone ? "/" : "/?done=1"} role="switch" aria-checked={showDone} scroll={false} className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
                  <span aria-hidden className={`relative inline-block h-4 w-7 rounded-full transition-colors ${showDone ? "bg-navy-700" : "bg-sand-300"}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${showDone ? "left-3.5" : "left-0.5"}`} />
                  </span>
                  Show done
                </Link>
                {access.is_owner && <MarkDoneBeforeDialog candidates={candidates} labels={labels} showDone={showDone} />}
              </>}>
              {batches.map((b) => (
                <form key={b.id} action={undoDeadlineBatch} className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">
                  <input type="hidden" name="batch" value={b.id} />
                  {showDone && <input type="hidden" name="view" value="done" />}
                  <span className="flex-1">{b.count} marked done today{b.before ? `, due before ${formatDate(b.before)}` : ""}: &ldquo;{b.reason}&rdquo;.</span>
                  <button type="submit" className="btn-secondary h-8 px-3 text-sm">Undo the {b.count} marked done today</button>
                </form>
              ))}
              {tableRows.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <T2DeadlineTable editable={editClients} showDone={showDone} items={tableRows} />
              )}
              {noYearEnd.length > 0 && (
                <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
                  <p className="font-medium">{noYearEnd.length} T2 client{noYearEnd.length === 1 ? " has" : "s have"} no fiscal year-end in TaxDome, so no deadlines are shown for {noYearEnd.length === 1 ? "it" : "them"}:</p>
                  <p className="mt-1">{noYearEnd.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/clients/${c.id}`} className="underline">{c.legal_name}</Link></span>)}</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
