import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { BOOKS, currentPhase, fileBy, FILE_TYPE, firstName, nextLine, PHASE_NAME, PHASES, progress, type CbDoc } from "@/lib/closebook/files";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { TbTab } from "./tb-tab";
import { EntriesTab } from "./entries-tab";
import { gifiFor } from "@/lib/closebook/gifi-server";
import { loadBank } from "@/lib/closebook/bank-server";

const TABS = [["documents", "Documents"], ["tb", "Trial balance"], ["entries", "Entries"], ["notes", "Review notes"], ["statements", "Statements"]] as const;

// A Closebook file (Phase 3 batch, section 2; mockups FileDocuments and FileTrialBalance): header,
// the "Next:" bar with Open next, five fixed tabs.
export default async function FilePage({ params, searchParams }: PageProps<"/closebook/[id]">) {
  const access = await requireAccess("closebook", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const data = await loadFile(supabase, id);
  if (!data) notFound();
  const { file, client, docs, accounts, imports, names, entries } = data;
  const ref = await loadReference(supabase);
  const isReviewer = access.staff_id === file.reviewer_id;
  const tab = TABS.some(([k]) => k === sp.tab) ? String(sp.tab) : "documents";
  const people = { preparer: firstName(names.get(file.preparer_id) ?? ""), reviewer: firstName(names.get(file.reviewer_id) ?? "") };
  const next = nextLine(docs, people);
  const phase = currentPhase(docs);
  const editable = canEdit(access, "closebook");
  const nextHref = next.code === "F1" ? `/closebook/${id}?tab=tb` : `/closebook/${id}?tab=documents#${next.code ?? ""}`;

  const statusCell = (d: CbDoc, isNext: boolean) => d.status === "signed"
    ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Signed</span>
    : isNext ? <span className="rounded bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-700">Next</span>
    : d.status === "prepared" ? <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">For review</span>
    : <span className="rounded bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-3">Open</span>;
  const who = (uid: string | null, at: string | null) => (uid ? `${firstName(names.get(uid) ?? "")}${at ? `, ${formatDate(at)}` : ""}` : "");

  return (
    <>
      <nav className="mb-2 text-sm text-ink-3"><Link href="/closebook" className="text-navy-700 hover:underline">My files</Link> › {client?.legal_name}</nav>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client?.legal_name}</h1>
          <p className="mt-1 text-sm text-ink-2">{FILE_TYPE[file.file_type]} file · Year-end {formatDate(file.year_end)}{file.year_change_reason ? ` (from ${formatDate(file.year_start)}: ${file.year_change_reason})` : ""} · File by {formatDate(fileBy(file.year_end))} · Preparer {people.preparer} · Reviewer {people.reviewer}</p>
        </div>
        {/* P3: owners set signed or waiting in step 3; staff only ever see this one line. */}
        <span className="rounded-full border border-sand-200 bg-surface px-3 py-1 text-sm">Engagement letter: waiting</span>
      </header>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-sand-200" aria-label="File">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/closebook/${id}?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap ${tab === k ? "border-navy-700 text-navy-700" : "border-transparent text-ink-2 hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "documents" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-200 bg-navy-50 px-4 py-3">
            <p className="text-sm"><b>{next.text.startsWith("Next:") ? "Next:" : ""}</b> {next.text.replace(/^Next: /, "")}</p>
            {next.code && <Link href={nextHref} className="btn">Open next</Link>}
          </div>
          {PHASES.map((p, i) => {
            const pr = progress(docs, p);
            const open = PHASES.indexOf(phase as (typeof PHASES)[number]) >= i || phase === "locked";
            const list = docs.filter((d) => d.phase === p);
            return open ? (
              <section key={p} className="card mb-4 overflow-x-auto p-0">
                <h2 className="px-5 pt-4 pb-2 font-semibold">{PHASE_NAME[p]} · {pr.signed} of {pr.total} signed</h2>
                <table className="table">
                  <thead><tr><th>Document</th><th>Prepared by</th><th>Reviewed by</th><th>Status</th></tr></thead>
                  <tbody>{list.map((d) => (
                    <tr key={d.code} id={d.code}>
                      <td><span className="font-medium">{d.title}</span>{d.detail && <span className="block text-xs text-muted">{d.detail}</span>}</td>
                      <td>{who(d.prepared_by, d.prepared_at)}</td>
                      <td>{who(d.reviewed_by, d.reviewed_at)}</td>
                      <td>{statusCell(d, d.code === next.code)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            ) : (
              <p key={p} className="card mb-4 text-sm text-ink-2"><b>{PHASE_NAME[p]}</b> · opens when {PHASE_NAME[PHASES[i - 1]]} is signed ({pr.total} documents)</p>
            );
          })}
          <p className="text-xs text-muted">Sign-offs, review notes and each document&rsquo;s own page arrive with build step 3. Books: {BOOKS[file.books]}.</p>
        </>
      )}

      {tab === "tb" && <TbTab file={file} accounts={accounts} imports={imports} entries={entries} editable={editable} isReviewer={isReviewer} lines={ref.lines} sheets={ref.sheets}
        taxes={ref.taxes} flag={ref.flag} view={["lead", "attention", "lines", "gifi", "transactions"].includes(String(sp.view)) ? String(sp.view) : "accounts"}
        gifi={tab === "tb" && sp.view === "gifi" ? await gifiFor(supabase, id) : null}
        bank={tab === "tb" && sp.view === "transactions" && file.file_type === "full" ? await loadBank(supabase, id, typeof sp.account === "string" ? sp.account : undefined) : null} craText={ref.craText} notes={data.notes} edit={typeof sp.edit === "string" ? sp.edit : undefined} />}
      {tab === "entries" && <EntriesTab file={file} entries={entries} accounts={accounts} lines={ref.lines} editable={editable} isReviewer={isReviewer} names={names} />}
      {tab === "notes" && <p className="card text-sm text-ink-2">No review notes. Notes attach to one document and arrive with build step 3.</p>}
      {tab === "statements" && <p className="card text-sm text-ink-2">The live preview of the year-end package arrives with build step 2.</p>}
    </>
  );
}
