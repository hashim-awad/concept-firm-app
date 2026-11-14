import { loadEntryForm } from "@/lib/closebook/entry-form-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { BOOKS, fileBy, FILE_TYPE, firstName } from "@/lib/closebook/files";
import { fileSteps, fromStatements, SIGNED_STEPS, stepFromLegacy, STEP_KEYS, type StepKey } from "@/lib/closebook/steps";
import { loadReview, stepSigns } from "@/lib/closebook/review-server";
import { CB_CHECKLIST, cbText } from "@/lib/closebook/client-wording";
import { loadWordingState } from "@/lib/studio/wording-state";
import { entryNo } from "@/lib/closebook/reports";
import { StatusPill } from "@/components/ds/primitives";
import { SignoffBar } from "./signoff-bar";
import { ReviewNotes } from "./review-notes";
import { HistoryView, ReviewStep, type ChecklistRow, type ReviewGroup, type ReviewItem } from "./review-step";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { sideFlag, sideFlagText, typeFlag, typeFlagText } from "@/lib/closebook/matching";
import { TbTab } from "./tb-tab";
import { EntriesTab } from "./entries-tab";
import { RevenueCheck } from "./revenue-check";
import { ShSchedule } from "./sh-schedule";
import { loadShLoans } from "@/lib/closebook/sh-server";
import { flagText, type ShFlag } from "@/lib/closebook/sh-loans";
import { T2Step } from "./t2-step";
import { env } from "@/lib/env";
import { StatementsStep } from "./statements-step";
import { CloseStep } from "./close-step";
import { GstSection } from "./gst-section";
import { gstFor } from "@/lib/closebook/gst-server";
import type { Line } from "@/lib/closebook/gst-return";
import { loadClose } from "@/lib/closebook/close-server";
import { OpeningS125 } from "./opening-s125";
import { loadPackage, type PackageData } from "@/lib/closebook/fs-server";
import { ExpensesForm } from "./expenses-form";
import { loadExpenses, loadRevenue, revenueWaiting } from "@/lib/closebook/expenses-server";
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
  // Full names (round 8b item 9): two staff can share a first name.
  const people = { preparer: names.get(file.preparer_id) ?? "", reviewer: names.get(file.reviewer_id) ?? "" };
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
  // An account's balance after entries (round 10: the wrong-side check uses it).
  const entryTotal = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) entryTotal.set(l.account_id, (entryTotal.get(l.account_id) ?? 0) + l.amount);
  const finalOf = (a: { id: string; this_year: number }) => Math.round((Number(a.this_year) + (entryTotal.get(a.id) ?? 0)) * 100) / 100;
  const setup = (file.setup ?? {}) as Record<string, unknown>;
  // Bank files: step 2, last year's balance sheet; after sign-off, any difference with the first statements.
  const openingRow = accounts.find((a) => a.account_key === "opening");
  const opening = { signed: !!file.opening_signed_at, entered: !!file.opening_source };
  // Round 8: each step's sign-offs, open items and review notes, from the database's own rules.
  const review = await loadReview(supabase, id);
  let setupOpen = ["realtor", "owner_paid", "dividends", "payroll", "holdco", "gst_registered"].filter((k) => !(k in setup)).length;
  if (setup.gst_registered === true) setupOpen += ("gst_frequency" in setup ? 0 : 1) + ("quick_method" in setup ? 0 : 1);
  const { steps, current, next } = fileSteps({ bankGaps, coding, opening, signs: stepSigns(review), setupOpen,
    books: file.books, docs, statements, imported: imports.some((i) => i.target === "this_year"), accounts: accounts.length,
    unmatched: accounts.filter((a) => !a.line_no && !a.needs_reviewer && a.account_key !== "chart:10900"
      // An account with no balance either year and no entries is "not used": no decision (round 4b item 4).
      && !(a.this_year === 0 && a.last_year === 0 && !entries.some((e) => e.lines.some((l) => l.account_id === a.id)))).length, waiting: accounts.filter((a) => a.needs_reviewer).length,
    typeFlags: accounts.filter((a) => typeFlag(a, ref.lines.find((l) => l.line_no === a.line_no)) === "open"
      || sideFlag(a, ref.lines.find((l) => l.line_no === a.line_no), finalOf(a)) === "open").length,
    entries: entries.length, people,
  });
  const asked = str(sp.step) as StepKey | undefined;
  const step: StepKey = asked && STEP_KEYS.includes(asked) ? asked : stepFromLegacy(str(sp.tab), str(sp.view), file.books) ?? current;
  const view = str(sp.view);
  const showHistory = access.is_owner && str(sp.history) === "1";
  const cur = steps.find((s) => s.key === step)!;
  const href = (k: StepKey) => `/closebook/${id}?step=${k}`;
  const tb = (base: StepKey, pills: string[], dflt: string, showImport: boolean, extra: { importOnly?: boolean } = {}) => (
    <TbTab file={file} accounts={accounts} imports={imports} entries={entries} editable={editable} isReviewer={isReviewer} lines={ref.lines} sheets={ref.sheets}
      taxes={ref.taxes} flag={ref.flag} view={view && pills.includes(view) || view === "attention" ? view : dflt} craText={ref.craText} notes={data.notes}
      edit={str(sp.edit)} base={href(base)} pills={pills} showImport={showImport} importOnly={extra.importOnly} causes={openingCauses} names={names}
      noteStep={access.is_owner && ["code", "mapping"].includes(base) ? base : undefined} />
  );
  const soon = (text: string) => <p className="card text-sm text-ink-2">{text}</p>;

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
            <span><span className={`block whitespace-nowrap ${!report && x.key === step ? "font-semibold" : "font-normal"}`}>{x.name}</span>{x.note && <span className="block text-xs font-normal text-ink-3">{x.note}</span>}
              <span className="mt-0.5 flex items-center gap-1.5"><StatusPill status={x.word} />{x.notes > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-semibold text-white">{x.notes}<span className="sr-only"> review notes open</span></span>}</span></span>
          </Link>
        ))}
        <p className="mt-1 border-t border-sand-200 px-2 pt-2 text-xs font-semibold text-ink-3 uppercase">Reports</p>
        {REPORTS.map(([k, label]) => <Link key={k} href={`/closebook/${id}?report=${k}`} className={`rounded px-2 py-1 font-normal whitespace-nowrap hover:bg-sand-100 ${report === k ? "bg-navy-50 font-semibold" : ""}`}>{label}</Link>)}
      </div>
    </details>
  );
  let body: React.ReactNode;
  let pk: PackageData | null = null;
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
      // Round 11: last year's Schedule 125, for step 9's prior-year column. Rows: the codes saved, and the
      // revenue and expense codes this year's accounts post to.
      const { data: s125 } = await supabase.from("cb_opening_s125").select("code, amount").eq("file_id", id);
      const { data: ffs } = await supabase.from("cb_file_fs").select("first_year").eq("file_id", id).maybeSingle();
      const pl = new Map([...info.entries()].filter(([, i]) => i.type === "Revenue" || i.type === "Expense"));
      const used = new Set(accounts.map((a) => a.line_no?.slice(0, 4) ?? "").filter((c) => pl.has(c)));
      const saved = new Map(((s125 ?? []) as { code: string; amount: number }[]).map((x) => [x.code, Number(x.amount)]));
      const rows = [...new Set([...used, ...saved.keys()])].sort().map((c) => ({ code: c, name: gname.get(c) ?? pl.get(c)?.name ?? c, amount: saved.get(c) ?? null }));
      body = <>{body}<OpeningS125 fileId={id} rows={rows} editable={editable && file.phase !== "locked"} needed={!saved.size && (ob ?? []).length > 0 && ffs?.first_year !== true} /></>;
    }
  } else if (step === "setup") {
    // A form: one column about 1,100 px wide, each Yes/No right after its question (round 2 items 9 and 13).
    body = (
      <div className="form-col">
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
            <div className="grid items-center gap-2 border-t border-sand-100 py-2 sm:grid-cols-[30rem_auto]">
              <label htmlFor="gst_rt" className="text-sm">GST/HST account<span className="block text-xs text-ink-3">The RT account the return is filed under</span></label>
              <input id="gst_rt" name="gst_rt" defaultValue={(setup.gst_rt as string) ?? "RT0001"} className="input input-compact max-w-[9rem]" />
            </div>
              <SetupQ name="gst_year_same" q="GST/HST year same as the fiscal year?" adds="No: no return is built; ask the client to change the reporting period with CRA" value={(setup.gst_year_same as boolean | undefined) ?? true} />
            {editable && <div className="pt-3"><button type="submit" className="btn">Save answers</button></div>}
          </form>
        </section>
      </div>
    );
  } else if (step === "records") {
    body = bankFile
      ? <div className="grid gap-4"><BankView dups={((await supabase.rpc("cb_file_duplicates", { p_file: id })).data ?? []) as never} fileId={id} bank={bank!} editable={editable} locked={file.phase === "locked"} yearStart={file.year_start} yearEnd={file.year_end} upload={str(sp.upload) ?? null} error={str(sp.upload) ? messageFrom(sp.error) ?? null : null} /></div>
      : tb("records", [], "accounts", true, { importOnly: true });
  } else if (step === "code") {
    body = bankFile
      ? <CodingView fileId={id} data={await loadCoding(supabase, id, file.client_id, file.year_end, client?.province ?? "ON", setup)} accounts={bank!.accounts}
          selected={bank!.selected} editable={editable && file.phase !== "locked"} isReviewer={isReviewer || access.is_owner} focusLine={str(sp.line) ?? null}
          noteBy={access.is_owner && editable && file.phase !== "locked" ? { back: `${href("code")}${str(sp.account) ? `&account=${str(sp.account)}` : ""}` } : undefined} />
      : tb("code", ["accounts", "lines"], "accounts", false);   // the uploads stay on step 3 (round 8b item 8)
  } else if (step === "entries") {
    // Bank-statement files: an entry line on a GIFI line shows the chart account on that line, as the reports do.
    const onLine: Record<string, { number: string; name: string }> = {};
    if (bankFile) for (const c of ((await supabase.from("cb_chart_accounts").select("number, name, line_no").order("sort_order")).data ?? []) as { number: string; name: string; line_no: string }[]) onLine[c.line_no] ??= { number: c.number, name: c.name };
    // The entry form's choices: accounts, sales tax, standard entries resolved to this file (round 2 item 11).
    const form = await loadEntryForm(supabase, file, client?.province ?? "ON", client?.legal_name ?? "The client");
    // Round 9: the revenue check (CaseWare's tie-out working paper) and, when the setup says the owner paid
    // business costs personally, the "Expenses paid personally" entry (QuickBooks Online's journal entry).
    const rev = file.file_type === "full" ? await loadRevenue(supabase, id) : null;
    const exp = file.file_type === "full" && setup.owner_paid === true ? await loadExpenses(supabase, file) : null;
    const open = editable && file.phase !== "locked";
    const booked = entries.filter((e) => e.origin === "expenses_personal").length;
    // Round 14: the shareholder loan schedule (CaseWare's continuity working paper), beside the revenue check.
    const sh = await loadShLoans(supabase, file, accounts, entries, ref.lines, ref.sheets);
    body = <>
      {rev && <RevenueCheck fileId={id} st={rev.state} sources={rev.sources} opts={form.opts} revenueOpts={form.opts.filter((o) => o.type === "Revenue")} editable={open}
        isOwner={access.is_owner} names={names} hasFix={entries.some((e) => e.origin === "revenue_check")} />}
      {(sh.rows.length > 0 || sh.status.applies) && <ShSchedule fileId={id} sh={sh} editable={open} isOwner={access.is_owner} names={names} />}
      {exp && (
        <details id="expenses-personal" className="card mb-4" open={open && !booked}>
          <summary className="cursor-pointer font-semibold">Expenses paid personally <span className="ml-1 text-sm font-normal text-ink-3">
            {booked ? `${booked} entr${booked === 1 ? "y" : "ies"} booked, marked below` : "Setup: the owner paid business costs personally. Book one entry from the client's sheet."}</span></summary>
          {open ? <div className="mt-3"><ExpensesForm fileId={id} yearEnd={file.year_end} defs={exp.defs} chart={exp.chart} province={client?.province ?? "ON"} autoEntry={exp.autoEntry}
            clientList={keepsOwnBooks(file)} ctx={{ registered: exp.registered, quick: exp.quick, autoTax: exp.autoTax }} shown={exp.shown} shareholders={exp.shareholders}
            options={exp.options} defaults={exp.defaults} chosen={exp.chosen} rolledFrom={exp.rolledFrom} /></div>
            : <p className="mt-2 text-sm text-ink-2">The file is locked, or you have view access only.</p>}
        </details>
      )}
      <EntriesTab file={file} entries={entries} accounts={accounts} editable={editable} isReviewer={isReviewer} names={names} clientList={keepsOwnBooks(file)} chartOnLine={onLine} form={form}
        noteBy={access.is_owner && editable && file.phase !== "locked" ? { back: href("entries") } : undefined} />
    </>;
  } else if (step === "review") {
    // Step 6 (round 8): the reviewer's list, the open notes and the completion checklist; the lead sheets
    // are one click away, where the preparer explains the flagged changes for step 5.
    if (view === "lead") body = accounts.length ? tb("review", ["lead"], "lead", false) : soon("The lead sheets open once there is a trial balance.");
    else {
      // Every amount as the working papers show it: a negative in brackets (round 9b item 2).
      const amt = (v: number) => { const t = Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${t})` : t; };
      const lineOf = (no: string | null) => ref.lines.find((l) => l.line_no === no);
      const { data: rl } = bankFile ? await supabase.from("cb_bank_lines").select("id, account_id, txn_date, description, amount, reviewer_reason").eq("file_id", id).eq("status", "reviewer").order("txn_date") : { data: [] };
      const groups: ReviewGroup[] = [
        { key: "opening", title: "Opening balance differences", step: "step 2", items: openingRow?.needs_reviewer
          ? [{ href: href("opening"), label: "Difference with last year's closing balances", detail: openingRow.reviewer_reason ?? "", amount: amt(openingRow.this_year) }] : [] },
        { key: "code", title: "Lines for the reviewer", step: "step 4", items: ((rl ?? []) as { id: string; account_id: string; txn_date: string; description: string; amount: number; reviewer_reason: string }[]).map((l) => (
          { href: `${href("code")}&account=${l.account_id}&line=${l.id}`, label: `${formatDate(l.txn_date)} ${l.description}`, detail: l.reviewer_reason ?? "", amount: amt(Number(l.amount)) })) },
        { key: "entries", title: "Entries to approve", step: "step 5", items: entries.filter((e) => e.needs_review && !e.reviewed_at).map((e) => (
          { href: `${href("entries")}#entry-${e.id}`, label: `Entry ${entryNo(file.year_end, e)}`, detail: e.note, amount: amt(e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0)) })) },
        { key: "revenue", title: "Revenue check", step: "step 5", items: await (async () => {
          const r = file.file_type === "full" ? (await loadRevenue(supabase, id)).state : null;
          return r ? revenueWaiting(r).map((w) => ({ href: `${href("entries")}#revenue-check`, label: w.label,
            detail: w.explained ? w.text : w.text ? `Explained for another amount: ${w.text}` : "Not explained yet.", amount: amt(w.diff) })) : [];
        })() },
        { key: "sh", title: "Shareholder loans", step: "step 5", items: await (async () => {
          // Round 14: flags the preparer answered, per shareholder (last year's part not repaid; repaid near year end).
          const { data: fl } = await supabase.from("cb_sh_flags").select("account_key, flag, note, closing").eq("file_id", id).neq("note", "").is("accepted_at", null);
          return ((fl ?? []) as { account_key: string; flag: ShFlag; note: string; closing: number }[]).map((f) => ({ href: `${href("entries")}#sh-loans`,
            label: `${f.account_key.startsWith("sh:") ? `Shareholder ${f.account_key.slice(3)}` : "Shareholder"}: ${flagText(f.flag, Math.round(Number(f.closing) * 100), file.year_end)}`, detail: f.note, amount: amt(Number(f.closing)) }));
        })() },
        { key: "mapping", title: "Accounts for the reviewer's decision", step: "step 7", items: accounts.filter((a) => (a.needs_reviewer && !["opening", "uncoded"].includes(a.account_key)) || typeFlag(a, lineOf(a.line_no)) === "open"
          || sideFlag(a, lineOf(a.line_no), finalOf(a)) === "open").map((a) => (
          { href: `${href("mapping")}&edit=${a.id}`, label: `${a.number ? `${a.number} ` : ""}${a.name}`,
            detail: a.needs_reviewer ? a.reviewer_reason : [typeFlag(a, lineOf(a.line_no)) === "open" ? typeFlagText(a, lineOf(a.line_no)) : "", sideFlagText(a, lineOf(a.line_no), finalOf(a))].filter(Boolean).join(" "),
            amount: amt(finalOf(a)) })) },
      ];
      const stepName = (k: string) => { const x = steps.find((y) => y.key === k); return x ? `Step ${x.n}, ${x.name}` : k; };
      const openNotes: ReviewItem[] = review.notes.filter((n) => n.status !== "cleared").map((n) => (
        { href: `${href(n.step)}#note-${n.id}`, label: `${stepName(n.step)}${n.target_label ? `: ${n.target_label}` : ""}`,
          detail: `${n.status === "fixed" ? "Fixed, to clear. " : ""}${n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body}` }));
      body = <ReviewStep groups={groups} notes={openNotes} />;
    }
  } else if (step === "mapping") {
    body = accounts.length ? tb("mapping", ["accounts", "lines"], "accounts", false) : soon("GIFI mapping opens once the transactions are coded.");
  } else if (step === "t2") {
    // Step 8 (round 10): checks, the two GIFI exports, the tax workpaper and the tie-out to ProFile.
    const g = accounts.length ? await gifiFor(supabase, id) : null;
    // The rounding line: the same whole-dollar figures as the statements in step 9.
    const fsm = g ? (await loadPackage(supabase, id))?.m : null;
    const curFail = fsm?.failed.find((t) => t.column === "current");
    const rounding = fsm ? (curFail ? { stopped: `Not worked out: a tie-out fails in step 9 (${curFail.name}).` } : { fix: fsm.profileFix }) : undefined;
    // Round 13: the GST/HST return beside the T2.
    const gst = await gstFor(supabase, id);
    const dl = /^\d+$/.test(str(sp.gst) ?? "") && /^1\d\d$/.test(str(sp.line) ?? "") ? { period: Number(str(sp.gst)), line: str(sp.line) as Line } : null;
    body = g ? <><T2Step fileId={id} g={g} staff={names} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} rounding={rounding} />
      {gst && <div className="mt-4"><GstSection fileId={id} g={gst} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} drill={dl} names={names} /></div>}</>
      : soon("The GIFI file opens once there is a trial balance.");
  } else if (step === "statements") {
    // Step 9 (round 11): the year-end package, its fields and the MAL's signing.
    pk = accounts.length ? await loadPackage(supabase, id) : null;
    body = pk ? <StatementsStep fileId={id} pk={pk} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} siteUrl={env.siteUrl()} />
      : soon("The package opens once there is a trial balance.");
  } else {
    // Step 10 (round 8b, round 12): the completion checklist, then delivery and the lock.
      const [{ data: qs }, { data: ans }, wording, { data: appr }] = await Promise.all([
        supabase.from("cb_checklist_questions").select("key").order("sort_order"),
        supabase.from("cb_checklist_answers").select("question, answer, note").eq("file_id", id),
        loadWordingState(supabase),
        supabase.from("template_approvals").select("approved_on").eq("template_key", "cbchecklist").limit(1).maybeSingle(),
      ]);
      const texts = wording.live?.texts ?? {};
      const ansOf = new Map(((ans ?? []) as { question: string; answer: ChecklistRow["answer"]; note: string }[]).map((a) => [a.question, a]));
      const checklist: ChecklistRow[] = ((qs ?? []) as { key: string }[]).map((q) => {
        const piece = CB_CHECKLIST.find((c) => c.key === q.key);
        return { key: q.key, text: piece ? cbText(texts, piece) : q.key, answer: ansOf.get(q.key)?.answer ?? "", note: ansOf.get(q.key)?.note ?? "" };
      });
    // Round 12: step 10, "Deliver and lock": the checklist, the client email, the documents, the filing
    // record and the lock.
    const cd = accounts.length ? await loadClose(supabase, id) : null;
    body = cd ? <CloseStep fileId={id} d={cd} checklist={checklist} checklistTrial={!appr} editable={editable} isOwner={access.is_owner} names={names} />
      : soon("Step 10 opens once there is a trial balance.");
  }

  // Round 8: each step with a sign-off shows "Prepared by" and "Reviewed by" at the top and its review
  // notes below. Step 6's bar sits under its list, where the reviewer finishes.
  const stepBack = `${href(step)}${view ? `&view=${view}` : ""}`;
  // Step 9: a stopped package (a failed tie-out, named) blocks the sign-off like the database's own checks.
  const stStep = step === "statements" && pk?.blocked.length && review.status[step] ? { ...review.status[step], problems: [...new Set([...pk.blocked, ...(review.status[step].problems ?? [])])] } : review.status[step];
  const bar = SIGNED_STEPS.includes(step) && !report ? (
    <SignoffBar fileId={id} step={step} st={stStep} names={names} me={access.staff_id} isOwner={access.is_owner} editable={editable && file.phase !== "locked"} back={stepBack}
      preparerElsewhere={step === "opening" && bankFile} />
  ) : null;
  const stepNotes = <ReviewNotes fileId={id} notes={review.notes.filter((n) => n.step === step)} names={names} isOwner={access.is_owner}
    canFix={!access.is_owner || access.staff_id === file.preparer_id} editable={editable && file.phase !== "locked"} back={stepBack} />;
  if (showHistory) {
    const { data: hist } = await supabase.from("cb_file_history").select("at, actor_id, action, step, detail").eq("file_id", id).order("at", { ascending: false }).limit(500);
    const stepName = (k: string) => { const x = steps.find((y) => y.key === k); return x ? `${x.n}. ${x.name}` : ""; };
    body = <HistoryView stepName={stepName} rows={((hist ?? []) as { at: string; actor_id: string | null; action: string; step: string | null; detail: string }[]).map((h) => (
      { at: h.at, who: h.actor_id ? names.get(h.actor_id) ?? "" : "System", action: h.action, step: h.step ?? "", detail: h.detail }))} />;
  } else if (bar) {
    body = step === "review"
      ? <>{(view !== "lead") && stepNotes}{body}<div className="mt-4">{bar}</div></>
      : <>{bar}{body}<div className="mt-4">{stepNotes}</div></>;
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
      {file.phase === "locked" && (
        <p role="status" className="mb-4 rounded-lg border border-navy-300 bg-navy-50 px-4 py-2.5 text-sm text-navy-800">
          <b>Locked:</b> this file is read-only. Its documents are kept as delivered. Only an owner can reopen it, on step 10, with a reason.</p>
      )}
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
                    <span className="mt-1 flex items-center gap-1.5"><StatusPill status={s.word} />
                      {s.notes > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-semibold text-white" title={`${s.notes} review note${s.notes === 1 ? "" : "s"} open`}>{s.notes}<span className="sr-only"> review notes open</span></span>}</span>
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
            {/* Round 8 item 8: owners see every sign-off, cleared sign-off, note and reply. */}
            {access.is_owner && <li><Link href={`/closebook/${id}?history=1`} aria-current={showHistory ? "page" : undefined}
              className={`block rounded-lg px-2 py-1.5 text-sm ${showHistory ? "bg-navy-50 font-semibold" : "hover:bg-sand-100"}`}>File history</Link></li>}
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
              <p className="mt-1 text-base">{step === current ? next : step === "records" && !bankFile ? RECORDS_TB : step === "code" && !bankFile ? CODE_TB : STEP_LINE[step]}</p>
            </div>
          </section>
          {step === "review" && !showHistory && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <Link href={href("review")} className={`rounded-full px-3 py-1 ${view !== "lead" ? "bg-navy-700 font-medium text-white" : "border border-sand-200 text-ink-2 hover:border-navy-300"}`}>Review list</Link>
              <Link href={`${href("review")}&view=lead`} className={`rounded-full px-3 py-1 ${view === "lead" ? "bg-navy-700 font-medium text-white" : "border border-sand-200 text-ink-2 hover:border-navy-300"}`}>Lead sheets</Link>
            </div>
          )}
          {body}</>}
        </main>
      </div>
    </>
  );
}

// Each step's one-line description, shown on a step that is not the next job (Hashim, Nov 15, 2026,
// layout item 7): no "current step is X / Go to step X" on a step that can already be worked.
const STEP_LINE: Record<StepKey, string> = {
  setup: "Answer the setup questions.",
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

// Step 3 for a file that imports a trial balance (round 7 item 2).
const RECORDS_TB = "Import the client's trial balance, and the QuickBooks Account List if they use QuickBooks.";
// Step 4 for a file that imports a trial balance (round 8b item 8).
const CODE_TB = "Match each account to its GIFI line.";

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
