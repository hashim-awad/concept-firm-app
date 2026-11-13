import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { BOOKS, fileBy, FILE_TYPE, firstName, type CbDoc } from "@/lib/closebook/files";
import { fileSteps, fromStatements, stepFromLegacy, STEP_KEYS, type StepKey } from "@/lib/closebook/steps";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { TbTab } from "./tb-tab";
import { EntriesTab } from "./entries-tab";
import { BankView } from "./bank-view";
import { CodingView } from "./coding-view";
import { saveSetup } from "../actions";
import { loadCoding } from "@/lib/closebook/coding-server";
import { gifiFor } from "@/lib/closebook/gifi-server";
import { loadBank } from "@/lib/closebook/bank-server";
import { accountCoverage, missingText } from "@/lib/closebook/coverage";

// A Closebook file (Hashim, Nov 13, 2026; BRIEF.md "Closebook file page, 9 steps"; mockup
// https://claude.ai/artifact/XkgKhoP3v9jG395A5Meqho): the 9 steps down the left, the page opens on the
// current step with one "next job" bar. Each step shows the work built so far; the rest says what comes.
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
  const editable = canEdit(access, "closebook");
  const people = { preparer: firstName(names.get(file.preparer_id) ?? ""), reviewer: firstName(names.get(file.reviewer_id) ?? "") };
  const bankFile = fromStatements(file.books);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  // Bank files: the months still missing per account set step 2's note and next job.
  const bank = bankFile ? await loadBank(supabase, id, str(sp.account)) : null;
  const statements = bank?.statements.length ?? 0;
  const bankGaps = bank ? missingText(bank.accounts.map((a) => ({ name: a.name,
    gaps: accountCoverage(file.year_start, file.year_end, bank.statements.filter((x) => x.account_id === a.id), bank.txnMonths.get(a.id) ?? new Set()).gaps }))) : "";
  // Bank files: how far the coding has got (step 3).
  const { data: st } = bankFile ? await supabase.from("cb_bank_lines").select("status").eq("file_id", id).limit(50000) : { data: [] };
  const sts = (st ?? []) as { status: string }[];
  const coding = { lines: sts.length, open: sts.filter((x) => x.status === "new").length, reviewer: sts.filter((x) => x.status === "reviewer").length, ask: sts.filter((x) => x.status === "ask_client").length };
  const setup = (file.setup ?? {}) as Record<string, unknown>;
  const { steps, current, next } = fileSteps({ bankGaps, coding,
    books: file.books, docs, statements, imported: imports.some((i) => i.target === "this_year"), accounts: accounts.length,
    unmatched: accounts.filter((a) => !a.line_no && !a.needs_reviewer).length, waiting: accounts.filter((a) => a.needs_reviewer).length,
    entries: entries.length, people,
  });
  const asked = str(sp.step) as StepKey | undefined;
  const step: StepKey = asked && STEP_KEYS.includes(asked) ? asked : stepFromLegacy(str(sp.tab), str(sp.view), file.books) ?? current;
  const view = str(sp.view);
  const cur = steps.find((s) => s.key === step)!;
  const href = (k: StepKey) => `/closebook/${id}?step=${k}`;
  const tb = (base: StepKey, pills: string[], dflt: string, showImport: boolean, extra: { gifi?: Awaited<ReturnType<typeof gifiFor>> } = {}) => (
    <TbTab file={file} accounts={accounts} imports={imports} entries={entries} editable={editable} isReviewer={isReviewer} lines={ref.lines} sheets={ref.sheets}
      taxes={ref.taxes} flag={ref.flag} view={view && pills.includes(view) || view === "attention" ? view : dflt} gifi={extra.gifi ?? null} craText={ref.craText} notes={data.notes}
      edit={str(sp.edit)} base={href(base)} pills={pills} showImport={showImport} />
  );
  const soon = (text: string) => <p className="card text-sm text-ink-2">{text}</p>;
  const planning = docs.filter((d) => d.phase === "planning");
  const who = (uid: string | null, at: string | null) => (uid ? `${firstName(names.get(uid) ?? "")}${at ? `, ${formatDate(at)}` : ""}` : "");
  const docStatus = (d: CbDoc) => d.status === "signed" ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Signed</span>
    : d.status === "prepared" ? <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">For review</span>
    : <span className="rounded bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-3">Open</span>;

  let body: React.ReactNode;
  if (step === "setup") {
    body = (
      <>
        <section className="card mb-4 overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">Set up the file</h2>
          <table className="table">
            <thead><tr><th>Item</th><th>Prepared by</th><th>Reviewed by</th><th>Status</th></tr></thead>
            <tbody>{planning.map((d) => (
              <tr key={d.code}><td><span className="font-medium">{d.title}</span>{d.detail && <span className="block text-xs text-muted">{d.detail}</span>}</td>
                <td>{who(d.prepared_by, d.prepared_at)}</td><td>{who(d.reviewed_by, d.reviewed_at)}</td><td>{docStatus(d)}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <section className="card text-sm">
          <h2 className="mb-2 font-semibold">File settings</h2>
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Year</dt><dd>{formatDate(file.year_start)} to {formatDate(file.year_end)}</dd></div>
            <div><dt className="text-xs text-muted">Books</dt><dd>{BOOKS[file.books]}</dd></div>
            <div><dt className="text-xs text-muted">Preparer</dt><dd>{people.preparer}</dd></div>
            <div><dt className="text-xs text-muted">Reviewer</dt><dd>{people.reviewer}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted">Sign-offs, editing and deleting the file arrive with the next pieces.</p>
        </section>
        <section className="card mt-4">
          <h2 className="font-semibold">Setup questions</h2>
          <p className="mb-2 text-sm text-ink-2">They decide which extra work the file needs, and the GST/HST answers set the sales tax on every line.</p>
          <form action={saveSetup} className="grid gap-1">
            <input type="hidden" name="file_id" value={id} />
              <SetupQ name="realtor" q="Is the client a realtor, a team or a PREC?" adds="Yes adds: T4A check" value={setup.realtor as boolean | undefined} />
              <SetupQ name="owner_paid" q="Did the owner pay company expenses personally?" adds="Yes adds: expenses paid personally" value={setup.owner_paid as boolean | undefined} />
              <SetupQ name="dividends" q="Were dividends paid this year?" adds="Yes adds: T5 slips and summary" value={setup.dividends as boolean | undefined} />
              <SetupQ name="payroll" q="Does the company run payroll?" adds="Yes adds: T4 reconciliation" value={setup.payroll as boolean | undefined} />
              <SetupQ name="holdco" q="Does it own, or is it owned by, another company?" adds="Yes adds: investments and intercompany balances" value={setup.holdco as boolean | undefined} />
              <SetupQ name="gst_registered" q="Is it registered for GST/HST?" adds="No: the tax stays in the expense; nothing is split out" value={setup.gst_registered as boolean | undefined} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 py-3">
              <label htmlFor="gst_frequency" className="text-sm">GST/HST filing frequency<span className="block text-xs text-ink-3">Annual adds: the annual GST/HST return</span></label>
              <select id="gst_frequency" name="gst_frequency" defaultValue={(setup.gst_frequency as string) ?? ""} className="input max-w-[180px]">
                <option value="">Choose</option><option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option>
              </select>
            </div>
              <SetupQ name="quick_method" q="Does it use the quick method?" adds="Yes: no ITCs on operating expenses, meals included; capital purchases still claim them" value={setup.quick_method as boolean | undefined} />
            {editable && <div className="pt-3"><button type="submit" className="btn">Save answers</button></div>}
          </form>
        </section>
      </>
    );
  } else if (step === "records") {
    body = bankFile
      ? <BankView fileId={id} bank={bank!} editable={editable} locked={file.phase === "locked"} yearStart={file.year_start} yearEnd={file.year_end} upload={str(sp.upload) ?? null} error={str(sp.upload) ? messageFrom(sp.error) ?? null : null} />
      : tb("records", [], "accounts", true);
  } else if (step === "code") {
    body = bankFile
      ? <CodingView fileId={id} data={await loadCoding(supabase, id, file.client_id, file.year_end, client?.province ?? "ON", setup)} accounts={bank!.accounts}
          selected={bank!.selected} editable={editable && file.phase !== "locked"} isReviewer={isReviewer || access.is_owner} />
      : tb("code", ["accounts", "lines"], "accounts", true);
  } else if (step === "entries") {
    body = <EntriesTab file={file} entries={entries} accounts={accounts} lines={ref.lines} editable={editable} isReviewer={isReviewer} names={names} />;
  } else if (step === "review") {
    body = accounts.length ? tb("review", ["lead"], "lead", false) : soon("The lead sheets open once there is a trial balance.");
  } else if (step === "mapping") {
    body = accounts.length ? tb("mapping", ["accounts", "lines"], "accounts", false) : soon("GIFI mapping opens once the transactions are coded.");
  } else if (step === "t2") {
    body = accounts.length ? tb("t2", ["gifi"], "gifi", false, { gifi: await gifiFor(supabase, id) }) : soon("The GIFI file opens once there is a trial balance.");
  } else if (step === "statements") {
    body = soon("The statements, the management acknowledgement (MAL) and the compilation report arrive with a later piece.");
  } else {
    body = soon("Delivering the package and locking the file arrive with a later piece.");
  }

  return (
    <>
      <nav className="mb-2 text-sm text-ink-3"><Link href="/closebook" className="text-navy-700 hover:underline">My files</Link> › {client?.legal_name}</nav>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client?.legal_name}</h1>
          <p className="mt-1 text-sm text-ink-2">{FILE_TYPE[file.file_type]} file · Year-end {formatDate(file.year_end)}{file.year_change_reason ? ` (from ${formatDate(file.year_start)}: ${file.year_change_reason})` : ""} · {BOOKS[file.books]} · Preparer {people.preparer} · Reviewer {people.reviewer}</p>
        </div>
        <span className="rounded-full border border-sand-200 bg-surface px-3 py-1 text-sm">T2 due <b>{formatDate(fileBy(file.year_end))}</b></span>
      </header>
      <Notice msg={messageFrom(sp.msg)} error={sp.upload ? undefined : messageFrom(sp.error)} />

      <div className="flex flex-wrap items-start gap-6">
        <nav aria-label="Year-end steps" className="card flex-[1_1_240px] p-3 lg:max-w-[280px]">
          <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Year-end steps</p>
          <ol className="grid gap-1">
            {steps.map((s) => (
              <li key={s.key}>
                <Link href={href(s.key)} aria-current={s.key === step ? "step" : undefined}
                  className={`flex items-start gap-3 rounded-lg px-2 py-2 ${s.key === step ? "bg-navy-50" : "hover:bg-sand-100"}`}>
                  <span aria-hidden className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold ${s.state === "done" ? "bg-success-soft text-success" : s.key === current ? "bg-navy-700 text-white" : "bg-sand-100 text-ink-3"}`}>{s.state === "done" ? "✓" : s.n}</span>
                  <span className="min-w-0">
                    <span className={`block text-sm ${s.key === step ? "font-semibold" : ""}`}>{s.name}{s.state === "done" && <span className="sr-only"> (done)</span>}{s.key === current && <span className="sr-only"> (current step)</span>}</span>
                    {s.note && <span className="block text-xs text-ink-3">{s.note}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <main className="min-w-0 flex-[999_1_640px]">
          <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-navy-700 px-5 py-4 text-white">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wide text-white/75 uppercase">Step {cur.n} of 9 · {cur.name}</p>
              <p className="mt-1 text-base">{step === current ? next : `The current step is ${steps.find((s) => s.key === current)!.n}: ${steps.find((s) => s.key === current)!.name}.`}</p>
            </div>
            {step !== current && <Link href={href(current)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-navy-700">Go to step {steps.find((s) => s.key === current)!.n}</Link>}
          </section>
          {body}
        </main>
      </div>
    </>
  );
}

// One Yes/No setup question (step 1). Blank until answered.
function SetupQ({ name, q, adds, value }: { name: string; q: string; adds: string; value: boolean | undefined }) {
  return (
    <fieldset className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 py-3">
      <legend className="sr-only">{q}</legend>
      <span className="text-sm">{q}<span className="block text-xs text-ink-3">{adds}</span></span>
      <span className="flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-sand-200 px-3 py-1.5 text-sm has-[:checked]:border-navy-700 has-[:checked]:bg-navy-50">
            <input type="radio" name={name} value={v} defaultChecked={value === (v === "yes")} className="h-4 w-4 accent-accent" />{v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </span>
    </fieldset>
  );
}
