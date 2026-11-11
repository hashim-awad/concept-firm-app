import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { fileInputClass } from "@/components/ds/primitives";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { BOOKS, currentPhase, fileBy, FILE_TYPE, firstName, nextLine, PHASE_NAME, PHASES, progress, type CbDoc } from "@/lib/closebook/files";
import { loadFile, type CbAccount } from "@/lib/closebook/server";
import { importTrialBalance } from "../actions";

const TABS = [["documents", "Documents"], ["tb", "Trial balance"], ["entries", "Entries"], ["notes", "Review notes"], ["statements", "Statements"]] as const;
const SOURCES: Record<string, string> = { quickbooks: "QuickBooks", client_software: "the client's software", bookkeeper: "the bookkeeper", prior_accountant: "the prior accountant" };

// Amounts as on the statements: brackets for credits, no cents.
const amt = (v: number) => (v === 0 ? "0" : v < 0 ? `(${Math.round(-v).toLocaleString("en-CA")})` : Math.round(v).toLocaleString("en-CA"));
const pct = (a: CbAccount) => (a.last_year === 0 ? (a.this_year === 0 ? "" : "new") : `${Math.round(((a.this_year - a.last_year) / Math.abs(a.last_year)) * 100)}%`);

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
  const { file, client, docs, accounts, imports, names } = data;
  const tab = TABS.some(([k]) => k === sp.tab) ? String(sp.tab) : "documents";
  const people = { preparer: firstName(names.get(file.preparer_id) ?? ""), reviewer: firstName(names.get(file.reviewer_id) ?? "") };
  const next = nextLine(docs, people);
  const phase = currentPhase(docs);
  const editable = canEdit(access, "closebook");
  const nextHref = next.code === "F1" ? `/closebook/${id}?tab=tb` : `/closebook/${id}?tab=documents#${next.code ?? ""}`;
  const thisImport = imports.find((i) => i.target === "this_year");
  const total = (k: "last_year" | "this_year") => accounts.reduce((n, a) => n + a[k], 0);
  const balanced = accounts.length > 0 && Math.round(total("this_year") * 100) === 0;

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

      {tab === "tb" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-navy-700 px-3 py-1 font-medium text-white">Accounts</span>
            <span className="rounded-full border border-sand-200 px-3 py-1 text-ink-3" title="Arrives with matching (part 3)">Lead sheets</span>
            {file.file_type === "full" && <span className="rounded-full border border-sand-200 px-3 py-1 text-ink-3" title="Arrives with bank and card imports (part 2b)">Transactions</span>}
          </div>
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {thisImport ? <>Imported from {SOURCES[thisImport.source] ?? thisImport.source}, {formatDateTime(thisImport.imported_at)}{file.file_type === "monthly" ? " · read-only" : ""}</> : "No trial balance yet."}
              {accounts.length > 0 && (balanced
                ? <span className="ml-2 rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Balanced</span>
                : <span className="ml-2 rounded bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Out by {amt(total("this_year"))}</span>)}
            </p>
            {editable && file.phase !== "locked" && (
              <form action={importTrialBalance} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="file_id" value={id} />
                <div><label htmlFor="upload" className="label">Trial balance (CSV or Excel)</label><input id="upload" name="upload" type="file" accept=".csv,.xlsx" required className={fileInputClass} /></div>
                <div><label htmlFor="target" className="label">Column</label>
                  <select id="target" name="target" className="input"><option value="this_year">This year</option><option value="last_year">Last year (opening balances)</option></select></div>
                <div><label htmlFor="source" className="label">From</label>
                  <select id="source" name="source" defaultValue={file.file_type === "monthly" ? "quickbooks" : file.books === "bookkeeper" ? "bookkeeper" : "client_software"} className="input">
                    {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.replace(/^the /, "The ")}</option>)}
                  </select></div>
                <button type="submit" className="btn">{thisImport ? "Import again" : "Import"}</button>
              </form>
            )}
          </div>
          {accounts.length === 0 ? <p className="card text-sm text-ink-2">Import the trial balance to see the accounts. {file.file_type === "monthly" ? "Monthly files: export QuickBooks' Trial Balance report after the year-end entries are booked." : "Bank-statement files build the trial balance from the Transactions view (part 2b)."}</p> : (
            <section className="card overflow-x-auto p-0">
              <table className="table min-w-[860px]">
                <thead><tr><th>Account</th><th>GIFI line</th><th>Tax code</th><th className="text-right">Last year</th><th className="text-right">This year</th><th className="text-right">Change</th></tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.number && <span className="mr-2 text-ink-3 tabular-nums">{a.number}</span>}{a.name}</td>
                      <td className="text-ink-3">Not matched yet</td>
                      <td></td>
                      <td className="text-right tabular-nums">{amt(a.last_year)}</td>
                      <td className="text-right tabular-nums">{amt(a.this_year)}</td>
                      <td className="text-right tabular-nums">{pct(a)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td>Total (must be 0)</td><td></td><td></td><td className="text-right tabular-nums">{amt(total("last_year"))}</td><td className="text-right tabular-nums">{amt(total("this_year"))}</td><td></td></tr>
                </tbody>
              </table>
            </section>
          )}
          <p className="mt-2 text-xs text-muted">Debits show as positive, credits in brackets. Matching to GIFI lines, tax codes and the trial balance sign-off arrive with part 3.</p>
        </>
      )}

      {tab === "entries" && <p className="card text-sm text-ink-2">{file.file_type === "monthly" ? "Entries are made in QuickBooks. This tab stays read-only for monthly files." : "Adjusting, reclassifying and tax entries (AJE, RJE, TJE) arrive with part 3."}</p>}
      {tab === "notes" && <p className="card text-sm text-ink-2">No review notes. Notes attach to one document and arrive with build step 3.</p>}
      {tab === "statements" && <p className="card text-sm text-ink-2">The live preview of the year-end package arrives with build step 2.</p>}
    </>
  );
}
