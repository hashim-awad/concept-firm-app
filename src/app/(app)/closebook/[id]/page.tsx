import { loadEntryForm } from "@/lib/closebook/entry-form-server";
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
import { gifiCodeInfo, livePostings, rebuildTb } from "@/lib/closebook/tb-build-server";
import { OpeningSchedule } from "./opening-schedule";
import { loadReportData } from "@/lib/closebook/report-data";
import { keepsOwnBooks } from "@/lib/closebook/books";
import { ReportView, REPORTS, type ReportKey } from "./report-view";
import { gifiFor } from "@/lib/closebook/gifi-server";
import { loadBank } from "@/lib/closebook/bank-server";
import { accountCoverage, missingCount } from "@/lib/closebook/coverage";

// A Closebook file (Hashim, Nov 13, 2026; BRIEF.md "Closebook file page", 10 steps since Nov 14; mockup
// https://claude.ai/artifact/XkgKhoP3v9jG395A5Meqho): the steps down the left, the page opens on the
// current step with one "next job" bar. Each step shows the work built so far; the rest says what comes.
export default async function FilePage({ params, searchParams }: PageProps<"/closebook/[id]">) {
  const access = await requireAccess("closebook", "view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  // Rebuild the stored trial balance BEFORE reading the file: Next.js memoizes identical reads within one
  // render, so a read after the rebuild returned the rows from before it (round 4b, found on Birch).
  const { data: meta } = await supabase.from("cb_files").select("books, phase").eq("id", id).maybeSingle();
  if (meta && fromStatements(meta.books as string) && canEdit(access, "closebook") && meta.phase !== "locked") {
    const { count: built } = await supabase.from("cb_accounts").select("id", { count: "exact", head: true }).eq("file_id", id).or("account_key.like.chart:%,account_key.like.bank:%,account_key.eq.opening");
    const { count: stmts } = await supabase.from("cb_bank_statements").select("id", { count: "exact", head: true }).eq("file_id", id);
    // Bank-statement files coded before the trial balance was built from them: build it once now. Steps 6
    // and 7 read the stored trial balance: build it fresh first, so a fix to the build shows at once.
    if ((!built && stmts) || ["mapping", "review"].includes(String(sp.step ?? ""))) {
      const e = await rebuildTb(supabase, id);
      if (e) console.error(e);
    }
  }
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
  const bankGaps = bank ? missingCount(bank.accounts.map((a) => ({ name: a.name,
    gaps: accountCoverage(file.year_start, file.year_end, bank.statements.filter((x) => x.account_id === a.id), bank.txnMonths.get(a.id) ?? new Set()).gaps }))) : "";
  // Bank files: how far the coding has got (step 3).
  const { data: st } = bankFile ? await supabase.from("cb_bank_lines").select("status").eq("file_id", id).limit(50000) : { data: [] };
  const sts = (st ?? []) as { status: string }[];
  const coding = { lines: sts.length, open: sts.filter((x) => x.status === "new").length, reviewer: sts.filter((x) => x.status === "reviewer").length, ask: sts.filter((x) => x.status === "ask_client").length };
  const setup = (file.setup ?? {}) as Record<string, unknown>;
  // Bank files: step 2, last year's balance sheet; after sign-off, any difference with the first statements.
  const openingRow = accounts.find((a) => a.account_key === "opening");
  const opening = { signed: !!file.opening_signed_at, entered: !!file.opening_source };
  const { steps, current, next } = fileSteps({ bankGaps, coding, opening,
    books: file.books, docs, statements, imported: imports.some((i) => i.target === "this_year"), accounts: accounts.length,
    unmatched: accounts.filter((a) => !a.line_no && !a.needs_reviewer && a.account_key !== "chart:10900"
      // An account with no balance either year and no entries is "not used": no decision (round 4b item 4).
      && !(a.this_year === 0 && a.last_year === 0 && !entries.some((e) => e.lines.some((l) => l.account_id === a.id)))).length, waiting: accounts.filter((a) => a.needs_reviewer).length,
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
      edit={str(sp.edit)} base={href(base)} pills={pills} showImport={showImport} causes={openingCauses} />
  );
  const soon = (text: string) => <p className="card text-sm text-ink-2">{text}</p>;
  const planning = docs.filter((d) => d.phase === "planning");
  const who = (uid: string | null, at: string | null) => (uid ? `${firstName(names.get(uid) ?? "")}${at ? `, ${formatDate(at)}` : ""}` : "");
  const docStatus = (d: CbDoc) => d.status === "signed" ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Signed</span>
    : d.status === "prepared" ? <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">For review</span>
    : <span className="rounded bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-3">Open</span>;

  // Reports (Hashim, Nov 15, 2026): full pages under "Reports" in the step list, built live every time.
  const report = REPORTS.find(([k]) => k === str(sp.report))?.[0] as ReportKey | undefined;
  // Back from a drill-down: only to a page of this file.
  const back = str(sp.back);
  const backHref = back && back.startsWith(`/closebook/${id}?`) ? back : null;

  // What makes up "Opening balances to enter", shown when its row is opened (round 2 item 8).
  const openingCauses = bankFile && (step === "mapping" || step === "review") && openingRow ? (await livePostings(supabase, id))?.causes ?? [] : [];
  // Below 1,536 px the step list folds on every step page; the step picker sits in the blue banner
  // (round 4 item 6). On report pages, which have no banner, it sits above the report.
  const stepPicker = (dark: boolean) => (
    <details className="relative 2xl:hidden">
      <summary className={`inline-flex cursor-pointer list-none items-center gap-2 text-xs font-semibold tracking-wide uppercase ${dark ? "text-white/85" : "card px-3 py-2 text-ink"}`}>
        {report ? REPORTS.find(([k]) => k === report)?.[1] : `Step ${cur.n} of ${STEP_KEYS.length} · ${cur.name}`}<span aria-hidden>▾</span><span className="sr-only">: all steps and reports</span></summary>
      {/* One column in step order, each with its status line, as in the full list (round 4b item 5). */}
      <div className="card absolute z-20 mt-2 grid w-max min-w-[17rem] gap-0.5 p-2 text-sm text-ink normal-case tracking-normal">
        {steps.map((x) => (
          <Link key={x.key} href={href(x.key)} className={`flex items-start gap-2.5 rounded px-2 py-1.5 hover:bg-sand-100 ${!report && x.key === step ? "bg-navy-50" : ""}`}>
            <span aria-hidden className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${x.state === "done" ? "bg-success-soft text-success" : x.key === current ? "bg-navy-700 text-white" : "bg-sand-100 text-ink-3"}`}>{x.state === "done" ? "✓" : x.n}</span>
            <span><span className={`block whitespace-nowrap ${!report && x.key === step ? "font-semibold" : "font-normal"}`}>{x.name}</span>{x.note && <span className="block text-xs font-normal text-ink-3">{x.note}</span>}</span>
          </Link>
        ))}
        <p className="mt-1 border-t border-sand-200 px-2 pt-2 text-xs font-semibold text-ink-3 uppercase">Reports</p>
        {REPORTS.map(([k, label]) => <Link key={k} href={`/closebook/${id}?report=${k}`} className={`rounded px-2 py-1 font-normal whitespace-nowrap hover:bg-sand-100 ${report === k ? "bg-navy-50 font-semibold" : ""}`}>{label}</Link>)}
      </div>
    </details>
  );
  let body: React.ReactNode;
  if (step === "opening") {
    if (!bankFile) body = soon("Last year's balances come with the trial balance import, in its last-year column.");
    else {
      const { info } = await gifiCodeInfo(supabase);
      const { data: gn } = await supabase.from("cb_gifi_codes").select("code, name, cb_gifi_versions!inner(is_current)").eq("cb_gifi_versions.is_current", true);
      const gname = new Map(((gn ?? []) as { code: string; name: string }[]).map((g) => [g.code, g.name]));
      const codes: [string, { name: string; type: string }][] = [...info.entries()].map(([c, i]) => [c, { name: c === "3660" ? "Retained earnings, start of last year" : gname.get(c) ?? i.name, type: i.type }]);
      const { data: ob } = await supabase.from("cb_opening_balances").select("code, amount, chart_account, bank_account").eq("file_id", id).order("code");
      // GIFI lines with more than one standard chart account: the row shows the choice (QuickBooks practice).
      const { data: ch } = await supabase.from("cb_chart_accounts").select("number, name, line_no").order("sort_order");
      const onCode = new Map<string, { number: string; name: string }[]>();
      for (const c of (ch ?? []) as { number: string; name: string; line_no: string | null }[]) {
        if (!c.line_no) continue;
        const code = c.line_no.slice(0, 4);
        for (const k of code === "3600" ? ["3600", "3660"] : [code]) onCode.set(k, [...(onCode.get(k) ?? []), { number: c.number, name: c.name }]);
      }
      // Every line's standard chart accounts: a choice in the Account column when there is more than one.
      // A bank or card line lists the file's own bank accounts instead (round 4b), so last year's balance
      // sits on the account the statements post to.
      const { data: bas } = await supabase.from("cb_bank_accounts").select("id, name, number, chart_account").eq("file_id", id).order("number");
      const lineOfChart = new Map(((ch ?? []) as { number: string; line_no: string | null }[]).map((c) => [c.number, c.line_no]));
      const onBank = new Map<string, { number: string; name: string; label: string }[]>();
      for (const b of (bas ?? []) as { id: string; name: string; number: string; chart_account: string }[]) {
        const code = (lineOfChart.get(b.chart_account) ?? "").slice(0, 4);
        if (code) onBank.set(code, [...(onBank.get(code) ?? []), { number: `bank:${b.id}`, name: b.name, label: `${b.number} ${b.name}` }]);
      }
      const choices = Object.fromEntries([...onCode, ...onBank]);
      const initialAccounts = Object.fromEntries(((ob ?? []) as { code: string; chart_account: string | null; bank_account: string | null }[])
        .filter((o) => o.chart_account || o.bank_account).map((o) => [o.code, o.bank_account ? `bank:${o.bank_account}` : o.chart_account!]));
      const cents = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100));
      body = <OpeningSchedule fileId={id} codes={codes} initial={((ob ?? []) as { code: string; amount: number }[]).map((o) => [o.code, Math.round(Number(o.amount) * 100)] as [string, number])}
        reStated={cents(file.opening_re_stated)} niTyped={cents(file.opening_ni_typed)} note={file.opening_note ?? ""}
        pdf={file.opening_pdf ? { href: `/closebook/${id}/opening-pdf`, name: "Source PDF" } : null}
        signed={file.opening_signed_at ? { by: firstName(names.get(file.opening_signed_by ?? "") ?? ""), at: formatDate(file.opening_signed_at) } : null}
        source={file.opening_source ?? null} bankIssue={openingRow?.reviewer_reason ?? ""} editable={editable && file.phase !== "locked"} choices={choices} initialAccounts={initialAccounts} />;
    }
  } else if (step === "setup") {
    // A form: one column about 1,100 px wide, each Yes/No right after its question (round 2 items 9 and 13).
    body = (
      <div className="form-col">
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
            <div className="grid items-center gap-2 border-t border-sand-100 py-2 sm:grid-cols-[30rem_auto]">
              <label htmlFor="gst_frequency" className="text-sm">GST/HST filing frequency<span className="block text-xs text-ink-3">Annual adds: the annual GST/HST return</span></label>
              <select id="gst_frequency" name="gst_frequency" defaultValue={(setup.gst_frequency as string) ?? ""} className="input input-compact max-w-[9rem]">
                <option value="">Choose</option><option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option>
              </select>
            </div>
              <SetupQ name="quick_method" q="Does it use the quick method?" adds="Yes: no ITCs on operating expenses, meals included; capital purchases still claim them" value={setup.quick_method as boolean | undefined} />
            {editable && <div className="pt-3"><button type="submit" className="btn">Save answers</button></div>}
          </form>
        </section>
      </div>
    );
  } else if (step === "records") {
    body = bankFile
      ? <div className="grid gap-4"><BankView dups={((await supabase.rpc("cb_file_duplicates", { p_file: id })).data ?? []) as never} fileId={id} bank={bank!} editable={editable} locked={file.phase === "locked"} yearStart={file.year_start} yearEnd={file.year_end} upload={str(sp.upload) ?? null} error={str(sp.upload) ? messageFrom(sp.error) ?? null : null} /></div>
      : tb("records", [], "accounts", true);
  } else if (step === "code") {
    body = bankFile
      ? <CodingView fileId={id} data={await loadCoding(supabase, id, file.client_id, file.year_end, client?.province ?? "ON", setup)} accounts={bank!.accounts}
          selected={bank!.selected} editable={editable && file.phase !== "locked"} isReviewer={isReviewer || access.is_owner} focusLine={str(sp.line) ?? null} />
      : tb("code", ["accounts", "lines"], "accounts", true);
  } else if (step === "entries") {
    // Bank-statement files: an entry line on a GIFI line shows the chart account on that line, as the reports do.
    const onLine: Record<string, { number: string; name: string }> = {};
    if (bankFile) for (const c of ((await supabase.from("cb_chart_accounts").select("number, name, line_no").order("sort_order")).data ?? []) as { number: string; name: string; line_no: string }[]) onLine[c.line_no] ??= { number: c.number, name: c.name };
    // The entry form's choices: accounts, sales tax, standard entries resolved to this file (round 2 item 11).
    const form = await loadEntryForm(supabase, file, client?.province ?? "ON", client?.legal_name ?? "The client");
    body = <EntriesTab file={file} entries={entries} accounts={accounts} editable={editable} isReviewer={isReviewer} names={names} clientList={keepsOwnBooks(file)} chartOnLine={onLine} form={form} />;
  } else if (step === "review") {
    body = accounts.length ? tb("review", ["lead"], "lead", false) : soon("The lead sheets open once there is a trial balance.");
  } else if (step === "mapping") {
    body = accounts.length ? tb("mapping", ["accounts", "lines"], "accounts", false) : soon("GIFI mapping opens once the transactions are coded.");
  } else if (step === "t2") {
    body = accounts.length ? tb("t2", ["gifi"], "gifi", false, { gifi: await gifiFor(supabase, id) }) : soon("The GIFI file opens once there is a trial balance.");
  } else if (step === "statements") {
    // Not built yet: nothing is shown beyond the step's own line (round 2 item 18).
    body = null;
  } else {
    body = null;
  }

  return (
    <>
      <nav className="mb-2 text-sm text-ink-3"><Link href="/closebook" className="text-navy-700 hover:underline">My files</Link> › {client?.legal_name}</nav>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client?.legal_name}</h1>
          <p className="mt-1 text-sm text-ink-2">{FILE_TYPE[file.file_type]} file · Year-end {formatDate(file.year_end)}{file.year_change_reason ? ` (from ${formatDate(file.year_start)}: ${file.year_change_reason})` : ""} · {BOOKS[file.books]} · Preparer {people.preparer} · Reviewer {people.reviewer}</p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-sand-200 bg-surface px-3 py-1 text-sm">T2 due <b>{formatDate(fileBy(file.year_end))}</b></span>
        </span>
      </header>
      <Notice msg={messageFrom(sp.msg)} error={sp.upload || sp.opening ? undefined : messageFrom(sp.error)} />

      {/* Tables use the full width (round 2 item 9): on table screens the step list is narrower. */}
      {/* The step list keeps each name on one line (round 3 item 10). On table screens narrower than
          1,536 px it folds into a step picker above the table, so the table has the width (QuickBooks Online
          keeps its bank feed full width the same way). */}
      {report && <div className="mb-3">{stepPicker(false)}</div>}
      <div className="flex flex-wrap items-start gap-6 lg:flex-nowrap">
        <nav aria-label="Year-end steps" className="card hidden w-[16rem] flex-none p-3 2xl:block">
          <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Year-end steps</p>
          <ol className="grid gap-1">
            {steps.map((s) => (
              <li key={s.key}>
                <Link href={href(s.key)} aria-current={!report && s.key === step ? "step" : undefined}
                  className={`flex items-start gap-3 rounded-lg px-2 py-2 ${!report && s.key === step ? "bg-navy-50" : "hover:bg-sand-100"}`}>
                  <span aria-hidden className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold ${s.state === "done" ? "bg-success-soft text-success" : s.key === current ? "bg-navy-700 text-white" : "bg-sand-100 text-ink-3"}`}>{s.state === "done" ? "✓" : s.n}</span>
                  <span className="min-w-0">
                    <span className={`block text-sm whitespace-nowrap ${!report && s.key === step ? "font-semibold" : ""}`}>{s.name}{s.state === "done" && <span className="sr-only"> (done)</span>}{s.key === current && <span className="sr-only"> (current step)</span>}</span>
                    {s.note && <span className="block text-xs text-ink-3">{s.note}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-sand-200 px-2 pt-3 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Reports</p>
          <ul className="grid gap-0.5">
            {REPORTS.map(([k, label]) => (
              <li key={k}>
                <Link href={`/closebook/${id}?report=${k}`} aria-current={report === k ? "page" : undefined}
                  className={`block rounded-lg px-2 py-1.5 text-sm ${report === k ? "bg-navy-50 font-semibold" : "hover:bg-sand-100"}`}>{label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          {backHref && <Link href={backHref} className="mb-3 inline-block text-sm font-semibold text-navy-700 hover:underline">← Back</Link>}
          {report ? <ReportView fileId={id} p={{ report, account: str(sp.account), from: str(sp.from), to: str(sp.to), source: str(sp.source), open: str(sp.open), back: backHref ?? undefined, view: str(sp.view) }}
            data={await loadReportData(supabase, file, accounts, entries, ref.lines, ref.sheets)} yearEnd={file.year_end} yearStart={file.year_start}
            todo={[
              // What the preparer acts on, by cause, each linked (round 2 item 15). Zero counts are left out.
              // Step 4's own words and numbers (round 3 item 13).
              { n: coding.open, one: "to code", many: "to code", href: href("code") },
              { n: coding.reviewer, one: "with the reviewer", many: "with the reviewer", href: href("code") },
              { n: coding.ask, one: "with the client", many: "with the client", href: href("code") },
              { n: openingRow && Math.round(openingRow.this_year * 100) !== 0 ? 1 : 0, one: "opening balance to enter", many: "opening balances to enter", href: href("opening") },
              { n: accounts.filter((a) => !a.line_no && !["opening", "uncoded"].includes(a.account_key) && (a.account_key !== "chart:10900" || Math.round(a.this_year * 100) !== 0)).length, one: "account without a GIFI line", many: "accounts without a GIFI line", href: href("mapping") },
            ].filter((t) => t.n > 0)} /> : <>
          <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-navy-700 px-5 py-4 text-white">
            <div className="max-w-2xl">
              {stepPicker(true)}
              <p className="hidden text-xs font-semibold tracking-wide text-white/75 uppercase 2xl:block">Step {cur.n} of {STEP_KEYS.length} · {cur.name}</p>
              <p className="mt-1 text-base">{step === current ? next : STEP_LINE[step]}</p>
            </div>
          </section>
          {body}</>}
        </main>
      </div>
    </>
  );
}

// Each step's one-line description, shown on a step that is not the next job (Hashim, Nov 15, 2026,
// layout item 7): no "current step is X / Go to step X" on a step that can already be worked.
const STEP_LINE: Record<StepKey, string> = {
  setup: "Answer the setup questions and confirm the planning items.",
  opening: "Last year's closing balances by GIFI code, checked and signed.",
  records: "Every bank and card statement for the year, uploaded and balanced.",
  code: "Each bank and card line gets an account and a sales tax code.",
  entries: "Adjusting, reclassifying and tax entries, each with its working paper reference.",
  review: "The reviewer works through the lead sheets and the items to look at.",
  mapping: "Every account on its GIFI line.",
  t2: "The GIFI goes to ProFile; net income and total assets tie out.",
  statements: "The statements, the management acknowledgement and the compilation report.",
  lock: "Deliver the package and lock the file.",
};

// One Yes/No setup question (step 1). Blank until answered.
function SetupQ({ name, q, adds, value }: { name: string; q: string; adds: string; value: boolean | undefined }) {
  return (
    <fieldset className="grid items-center gap-2 border-t border-sand-100 py-2 sm:grid-cols-[30rem_auto]">
      <legend className="sr-only">{q}</legend>
      <span className="text-sm">{q}<span className="block text-xs text-ink-3">{adds}</span></span>
      {/* A small two-button control right after the question, like QuickBooks Online's settings toggles. */}
      <span className="inline-flex w-fit overflow-hidden rounded-md border border-sand-300">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="cursor-pointer px-3 py-1 text-sm has-[:checked]:bg-navy-700 has-[:checked]:text-white [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-300">
            <input type="radio" name={name} value={v} defaultChecked={value === (v === "yes")} className="sr-only" />{v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </span>
    </fieldset>
  );
}
