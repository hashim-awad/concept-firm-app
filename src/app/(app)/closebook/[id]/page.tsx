import { loadEntryForm } from "@/lib/closebook/entry-form-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { readMenuPins } from "@/lib/menu-pins";
import { TipLink } from "./shell/ui";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { dataSourceLabel, fileBy, firstName } from "@/lib/closebook/files";
import { fileSteps, fromStatements, SIGNED_STEPS, stepFromLegacy, stepPapers, STEP_KEYS, type Paper, type PaperKey, type StepKey } from "@/lib/closebook/steps";
import { loadReview, stepSigns } from "@/lib/closebook/review-server";
import { CB_CHECKLIST, CB_CHECKLIST_V1, cbText } from "@/lib/closebook/client-wording";
import { loadWordingState } from "@/lib/studio/wording-state";
import { entryNo, pctChange } from "@/lib/closebook/reports";
import { AREAS, FileShell, PageTitle, PanelHead, PanelLink, PaperMark, SignCircles, StepMark, StepTitle, type Area, type FileStatus } from "./shell/shell";
import { paperProgress, stepProgress, stepsDone, type ProgressFacts } from "@/lib/closebook/step-progress";
import { SaveForm, SaveFormButton, SaveFormDiscard } from "@/components/save-state";
import { stepHelp } from "./shell/help";
import { TbArea } from "./areas/tb-area";
import { entriesArea } from "./areas/entries-area";
import { adjustmentsTop } from "./areas/adjustments";
import { notesArea } from "./areas/notes-area";
import { statementsArea } from "./areas/statements-area";
import { ReportingBack, ReportingList, questionsReport } from "./areas/reporting-area";
import { ReclassifyPage } from "./areas/reclassify";
import { loadReclassify } from "@/lib/closebook/reclassify-server";
import { statements as fsStatements, trialBalance } from "@/lib/closebook/reports";
import { ReviewNotes } from "./review-notes";
import { loadHistory } from "@/lib/closebook/history";
import { HistoryView, ReviewStep, type ChecklistRow, type ReviewGroup, type ReviewItem } from "./review-step";
import { ReviewLines, type ReviewAccountRow } from "./feed/review-lines";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { sideFlag, sideFlagText, typeFlag, typeFlagText } from "@/lib/closebook/matching";
import { TbTab } from "./tb-tab";
import { CompareStep, NewAccountsReview, MarkReviewed } from "./compare-step";
import { compareLists, flagRuleText, YEAR_QUESTIONS } from "@/lib/closebook/compare";
import { entryDialog } from "./areas/entry-dialog";
import { RevenueCheck } from "./revenue-check";
import { ShReview, owedLine, type ShNotedRow } from "./sh-review";
import { loadShLoans } from "@/lib/closebook/sh-server";
import { flagText, type ShFlag } from "@/lib/closebook/sh-loans";
import { cardTitle } from "@/lib/closebook/sh-report";
import { T2Step } from "./t2-step";
import { env } from "@/lib/env";
import { StatementsStep } from "./statements-step";
import { CloseStep } from "./close-step";
import { GstSection } from "./gst-section";
import { GstRevenueBox } from "./gst-revenue-box";
import { gstFor } from "@/lib/closebook/gst-server";
import type { Line } from "@/lib/closebook/gst-return";
import { loadClose } from "@/lib/closebook/close-server";
import { FirstYearQuestion } from "./opening-first-year";
import { loadPackage, type PackageData } from "@/lib/closebook/fs-server";
import { gstRevenueWaiting, loadRevenue, revenueWaiting } from "@/lib/closebook/expenses-server";
import { BankingPage } from "./step3/banking-page";
import { LineWindow } from "./step3/feed-windows";
import { feedLock, loadRounding, loadSignoffPill, loadSubsteps, SUBS, type SubKey } from "@/lib/closebook/banking-server";
import { BankFeed } from "./feed/bank-feed";
import { saveSetup } from "../actions";
import { addRevenueCheck } from "../round9-actions";
import { ShReportView } from "./areas/sh-report";
import { loadShNames, loadShReport } from "@/lib/closebook/sh-report-server";
import { loadFeed } from "@/lib/closebook/feed-server";
import { gifiCodeInfo, livePostings, rebuildTb } from "@/lib/closebook/tb-build-server";
import { OpeningSchedule } from "./opening-schedule";
import { accountChoices } from "@/lib/closebook/schedule";
import { loadReportData } from "@/lib/closebook/report-data";
import { ReportView, REPORTS, type ReportKey } from "./report-view";
import { gifiFor } from "@/lib/closebook/gifi-server";
import { loadBank } from "@/lib/closebook/bank-server";
import { accountCoverage, missingCount } from "@/lib/closebook/coverage";
import { InfoTip } from "@/components/ds/info-tip";
import { AcceptanceForm } from "./acceptance-form";
import { emptyAcc, type AccRow, type Statements } from "@/lib/closebook/acceptance";

// A Closebook file (Hashim, Nov 13, 2026; BRIEF.md "Closebook file page", 10 steps since Nov 14; mockup
// https://claude.ai/artifact/XkgKhoP3v9jG395A5Meqho): the steps down the left, the page opens on the
// current step with one "next job" bar. Each step shows the work built so far; the rest says what comes.
export default async function FilePage({ params, searchParams }: PageProps<"/closebook/[id]">) {
  // Speed (Hashim, Nov 16, 2026): what does not depend on something else loads at the same time. On Live each
  // read crosses the network; one after another, twenty of them made every click slow.
  const [access, { id }, sp, supabase] = await Promise.all([requireAccess("closebook", "view"), params, searchParams, createClient()]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // Rebuild the stored trial balance BEFORE reading the file: Next.js memoizes identical reads within one
  // render, so a read after the rebuild returned the rows from before it (round 4b, found on Birch).
  const { data: meta } = await supabase.from("cb_files").select("books, phase").eq("id", id).maybeSingle();
  if (meta && fromStatements(meta.books as string) && canEdit(access, "closebook") && meta.phase !== "locked") {
    const [{ count: built }, { count: stmts }, { count: stale }] = await Promise.all([
      supabase.from("cb_accounts").select("id", { count: "exact", head: true }).eq("file_id", id).or("account_key.like.chart:%,account_key.like.bank:%,account_key.eq.opening"),
      supabase.from("cb_bank_statements").select("id", { count: "exact", head: true }).eq("file_id", id),
      supabase.from("cb_accounts").select("id", { count: "exact", head: true }).eq("file_id", id).eq("account_key", "uncoded").neq("this_year", 0)]);
    // Bank-statement files coded before the trial balance was built from them: build it once now. Round 24
    // (Hashim, Nov 16, 2026): the trial balance rebuilds only when something posts, so steps 6 and 7 no longer
    // rebuild on every visit. A file built before round 24 still holds "Transactions not yet coded": built once.
    if ((!built && stmts) || stale) {
      const e = await rebuildTb(supabase, id);
      if (e) console.error(e);
    }
  }
  // Everything the steps list and the header need, at once (after the rebuild above: Next.js memoizes reads).
  const isBank = !!meta && fromStatements(meta.books as string);
  const head = (t: string) => supabase.from(t).select("file_id", { count: "exact", head: true }).eq("file_id", id);
  const [data, ref, bankPre, { data: st }, review, subs, [accN, obN, revN, shN, gifiN, tieN, gstN, chkN, closeN, { data: fsRow }]] = await Promise.all([
    loadFile(supabase, id), loadReference(supabase),
    isBank ? loadBank(supabase, id, typeof sp.account === "string" ? sp.account : undefined) : Promise.resolve(null),
    isBank ? supabase.from("cb_bank_lines").select("status, chart_account, is_split, transfer_account, asked_at").eq("file_id", id).limit(50000) : Promise.resolve({ data: [] }),
    // Round 8: each step's sign-offs, open items and review notes, from the database's own rules.
    loadReview(supabase, id),
    // Round 23: Banking's sub-steps (3.1 to 3.3), each with its own sign-offs.
    isBank ? loadSubsteps(supabase, id) : Promise.resolve(null),
    Promise.all([
      head("cb_acceptance"), head("cb_opening_balances"), head("cb_revenue_checks"), head("cb_sh_flags").not("noted_at", "is", null), head("cb_gifi_exports"),
      head("cb_t2_tieouts"), head("cb_gst_returns").not("prepared_at", "is", null), head("cb_checklist_answers"), head("cb_file_close"),
      supabase.from("cb_file_fs").select("first_year, dividends, mal_sent_at").eq("file_id", id).maybeSingle(),
    ]),
  ]);
  // Piece 10: step 6's ticks and answers (the step list's progress, step 6 and step 7 read them).
  const [{ data: naRaw }, { data: seenRow }, { data: ycRaw }] = await Promise.all([
    supabase.from("cb_new_accounts").select("account_key, confirmed_line, reviewed_line, reviewed_by, reviewed_at").eq("file_id", id),
    supabase.from("cb_compare_seen").select("seen_key").eq("file_id", id).maybeSingle(),
    supabase.from("cb_year_changes").select("question, answer, note, reviewed_by, reviewed_at").eq("file_id", id),
  ]);
  const newTicks = (naRaw ?? []) as { account_key: string; confirmed_line: string | null; reviewed_line: string | null; reviewed_by: string | null; reviewed_at: string | null }[];
  const yearChanges = (ycRaw ?? []) as { question: string; answer: boolean; note: string; reviewed_by: string | null; reviewed_at: string | null }[];
  if (!data) notFound();
  // Round 34: on a bank file step 3 is signed as soon as 3.1, 3.2 and 3.3 are, and only then.
  if (subs) {
    const all = SUBS.map((x) => subs[x.key]);
    const last = (k: "prepared" | "reviewed") => all.filter((x) => x[`${k}_at`]).sort((a, b) => String(b[`${k}_at`]).localeCompare(String(a[`${k}_at`])))[0];
    const p = all.every((x) => x.prepared_at) ? last("prepared") : undefined, r = p && all.every((x) => x.reviewed_at) ? last("reviewed") : undefined;
    const was = review.status.records;
    review.status.records = { problems: [], waiting: [], notes: 0, ...was, prepared_by: p?.prepared_by ?? null, prepared_at: p?.prepared_at ?? null,
      reviewed_by: r?.reviewed_by ?? null, reviewed_at: r?.reviewed_at ?? null };
  }
  const { file, client, docs, accounts, imports, names, entries } = data;
  // Started now, read at the end: the report figures for the header and the people on the file.
  const rdataP = loadReportData(supabase, file, accounts, entries, ref.lines, ref.sheets);
  const staffP = supabase.from("staff").select("id, full_name, is_active, role:roles!staff_role_id_fkey(is_owner, role_permissions(area_key, level))").order("full_name");
  const isReviewer = access.staff_id === file.reviewer_id;
  // Notes by role (round 15b): the file's reviewer, or an owner who does not prepare it, reviews; everyone
  // else prepares (replies and marks fixed).
  const preparerRole = !isReviewer && (!access.is_owner || access.staff_id === file.preparer_id);
  const editable = canEdit(access, "closebook");
  // Full names (round 8b item 9): two staff can share a first name.
  const people = { preparer: names.get(file.preparer_id) ?? "", reviewer: names.get(file.reviewer_id) ?? "" };
  const bankFile = fromStatements(file.books);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  // Bank files: the months still missing per account set step 2's note and next job.
  const bank = bankFile ? bankPre : null;
  const statements = bank?.statements.length ?? 0;
  const bankGaps = bank ? missingCount(bank.accounts.map((a) => ({ name: a.name,
    gaps: accountCoverage(file.year_start, file.year_end, bank.statements.filter((x) => x.account_id === a.id), bank.txnMonths.get(a.id) ?? new Set()).gaps }))) : "";
  // Bank files: how far the coding has got (step 3).
  // Round 31 (QuickBooks Online's Pending and Posted): Pending lines, the posted ones with the reviewer, and those asked of the client.
  const sts = (st ?? []) as { status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null; asked_at: string | null }[];
  const pendingLine = (x: (typeof sts)[number]) => x.status === "new" || x.status === "ask_client" || (x.status === "reviewer" && !x.chart_account && !x.is_split && !x.transfer_account);
  const coding = { lines: sts.length, open: sts.filter(pendingLine).length, reviewer: sts.filter((x) => x.status === "reviewer" && !pendingLine(x)).length,
    ask: sts.filter((x) => pendingLine(x) && !!x.asked_at).length };
  // An account's balance after entries (round 10: the wrong-side check uses it).
  const entryTotal = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) entryTotal.set(l.account_id, (entryTotal.get(l.account_id) ?? 0) + l.amount);
  const finalOf = (a: { id: string; this_year: number }) => Math.round((Number(a.this_year) + (entryTotal.get(a.id) ?? 0)) * 100) / 100;
  const setup = (file.setup ?? {}) as Record<string, unknown>;
  // Bank files: step 2, last year's balance sheet; after sign-off, any difference with the first statements.
  const openingRow = accounts.find((a) => a.account_key === "opening");
  const opening = { signed: !!file.opening_signed_at, entered: !!file.opening_source || !!file.first_year, firstYear: !!file.first_year };
  let setupOpen = ["realtor", "owner_paid", "dividends", "payroll", "holdco", "gst_registered"].filter((k) => !(k in setup)).length;
  if (setup.gst_registered === true) setupOpen += ("gst_frequency" in setup ? 0 : 1) + ("quick_method" in setup ? 0 : 1);
  // Round 21 (ProFile, TurboTax): each step's progress in the list, from what the file already holds.
  const signMap = stepSigns(review);
  const progress: ProgressFacts = { bank: bankFile, setupAnswers: Object.keys(setup).length, acceptance: !!accN.count, openingRows: obN.count ?? 0,
    openingTyped: !!file.opening_source || !!file.first_year || (fsRow?.first_year !== null && fsRow?.first_year !== undefined) || file.opening_re_stated !== null && file.opening_re_stated !== undefined, imported: imports.some((i) => i.target === "this_year"),
    statements, coded: coding.lines - coding.open, matched: accounts.filter((a) => a.mapping_source === "preparer").length,
    entries: entries.length, revenueCheck: !!revN.count, shNotes: shN.count ?? 0, expensesBooked: entries.some((e) => e.origin === "expenses_personal"),
    compareWork: data.notes.size + newTicks.length + (seenRow ? 1 : 0) + yearChanges.length,
    reviewNotes: review.notes.length, reviewedSteps: Object.values(signMap).filter((x) => x?.reviewed).length,
    gifiExports: gifiN.count ?? 0, t2Tieout: !!tieN.count, gstReturn: !!gstN.count, fsTyped: (() => { const d = fsRow?.dividends as unknown; return Array.isArray(d) ? d.length > 0 : !!d && typeof d === "object" && Object.keys(d).length > 0; })(), malSent: !!fsRow?.mal_sent_at,
    checklistAnswers: chkN.count ?? 0, closeTyped: !!closeN.count,
    signs: Object.fromEntries(Object.entries(signMap).map(([k, v]) => [k, { prepared: !!v?.prepared, reviewed: !!v?.reviewed }])),
    banking: subs ? { accounts: !!subs["3.1"].prepared_at, feeds: !!subs["3.2"].prepared_at, reconcile: !!subs["3.3"].prepared_at } : undefined,
    bankAccounts: bank?.accounts.length ?? 0 };
  const { steps, current, next } = fileSteps({ bankGaps, coding, opening, signs: stepSigns(review), setupOpen,
    books: file.books, docs, statements, imported: imports.some((i) => i.target === "this_year"), accounts: accounts.length,
    unmatched: accounts.filter((a) => !a.line_no && !a.needs_reviewer && a.account_key !== "chart:10900"
      // An account with no balance either year and no entries is "not used": no decision (round 4b item 4).
      && !(a.this_year === 0 && a.last_year === 0 && !entries.some((e) => e.lines.some((l) => l.account_id === a.id)))).length, waiting: accounts.filter((a) => a.needs_reviewer).length,
    typeFlags: accounts.filter((a) => typeFlag(a, ref.lines.find((l) => l.line_no === a.line_no)) === "open"
      || sideFlag(a, ref.lines.find((l) => l.line_no === a.line_no), finalOf(a)) === "open").length,
    entries: entries.length, people,
  });
  // Piece 10: an old link to the retired step 6 key opens the new step 6.
  const asked = (str(sp.step) === "mapping" ? "compare" : str(sp.step)) as StepKey | undefined;
  const step: StepKey = asked && STEP_KEYS.includes(asked) ? asked : stepFromLegacy(str(sp.tab), str(sp.view), file.books) ?? current;
  const view = str(sp.view);
  const showHistory = access.is_owner && str(sp.history) === "1";
  const cur = steps.find((s) => s.key === step)!;
  const href = (k: StepKey) => `/closebook/${id}?step=${k}`;
  // Round 15b (CaseWare's document map): a step's working papers, each its own screen. The step's branch
  // below sets which papers apply; the one asked for, or the first.
  const pp: { list: Paper[]; key?: PaperKey } = { list: [] };
  const pickPaper = (list: Paper[]) => { pp.list = list; pp.key = (list.find((x) => x.key === str(sp.paper))?.key ?? list[0]?.key) as PaperKey | undefined; return pp.key; };
  const paperHref = (k: StepKey, p: PaperKey) => `${href(k)}&paper=${p}`;
  // Piece 9: extra.at, the page the screen sits on when it is not the step's own (Trial balance tab > GIFI matching).
  const tb = (base: StepKey, pills: string[], dflt: string, showImport: boolean, extra: { importOnly?: boolean; at?: string } = {}) => (
    <TbTab file={file} accounts={accounts} imports={imports} entries={entries} editable={editable} isReviewer={isReviewer} lines={ref.lines} sheets={ref.sheets}
      taxes={ref.taxes} flag={ref.flag} view={view && pills.includes(view) || view === "attention" ? view : dflt} craText={ref.craText} notes={data.notes}
      edit={str(sp.edit)} base={extra.at ?? href(base)} pills={pills} showImport={showImport} importOnly={extra.importOnly} causes={openingCauses} names={names}
      noteStep={access.is_owner && ["code", "compare"].includes(base) ? base : undefined} />
  );
  const soon = (text: string) => <p className="card text-sm text-ink-2">{text}</p>;

  // Reports (Hashim, Nov 15, 2026): full pages under "Reports" in the step list, built live every time.
  const report = REPORTS.find(([k]) => k === str(sp.report))?.[0] as ReportKey | undefined;
  // Back from a drill-down: only to a page of this file.
  const back = str(sp.back);
  const backHref = back && back.startsWith(`/closebook/${id}?`) ? back : null;

  // What makes up "Opening balances to enter", shown when its row is opened (round 2 item 8).
  const openingCauses = bankFile && (step === "compare" || step === "review") && openingRow ? (await livePostings(supabase, id))?.causes ?? [] : [];
  let body: React.ReactNode;
  let pk: PackageData | null = null;
  if (step === "opening") {
    // Round 21 (Hashim, Nov 15, 2026, item 7): one question first, worded as on the T2 (line 070):
    // "Is this the first year of filing after incorporation?" Yes: no opening balances, the step is one
    // confirmation the reviewer signs. No: last year's T2 (Schedule 100 and 125). Never both. Unanswered
    // until chosen, unless the file already has last year's figures or an earlier file exists (then No).
    const [{ count: earlier }, { data: ffs }, { data: ob }, { data: s125 }] = await Promise.all([
      supabase.from("cb_files").select("id", { count: "exact", head: true }).eq("client_id", file.client_id).lt("year_end", file.year_end),
      supabase.from("cb_file_fs").select("first_year").eq("file_id", id).maybeSingle(),
      supabase.from("cb_opening_balances").select("code, amount, chart_account, bank_account").eq("file_id", id).order("code"),
      supabase.from("cb_opening_s125").select("code, amount").eq("file_id", id).order("code"),
    ]);
    const hasData = (ob ?? []).length > 0 || (s125 ?? []).length > 0 || !!file.opening_source || file.opening_re_stated != null;
    const answer: "yes" | "no" | null = file.first_year ? "yes" : ffs?.first_year === false || !!earlier || hasData || (!bankFile && accounts.some((a) => Number(a.last_year) !== 0)) ? "no" : null;
    const question = <FirstYearQuestion fileId={id} back={href("opening")} answer={answer} earlier={!!earlier} hasData={hasData} editable={editable && file.phase !== "locked"} />;
    if (answer !== "no") body = question;
    else if (!bankFile) body = <>{question}{soon("Last year's balances come with the trial balance import, in its last-year column.")}</>;
    else {
      const { info } = await gifiCodeInfo(supabase);
      const { data: gn } = await supabase.from("cb_gifi_codes").select("code, name, cb_gifi_versions!inner(is_current)").eq("cb_gifi_versions.is_current", true);
      const gname = new Map(((gn ?? []) as { code: string; name: string }[]).map((g) => [g.code, g.name]));
      const codes: [string, { name: string; type: string }][] = [...info.entries()].map(([c, i]) => [c, { name: c === "3660" ? "Retained earnings, start of last year" : gname.get(c) ?? i.name, type: i.type }]);
      // The Account column's choice on every Schedule 100 line (item 13): the standard chart accounts on the
      // GIFI line, then on its detail lines when it is a summary line (Recommendation A, Nov 16), or the
      // file's own bank accounts on a bank line (round 4b). src/lib/closebook/schedule.ts accountChoices.
      const [{ data: ch }, { data: bas }, { data: gp }] = await Promise.all([
        supabase.from("cb_chart_accounts").select("number, name, line_no").order("sort_order"),
        supabase.from("cb_bank_accounts").select("id, name, number, chart_account").eq("file_id", id).order("number"),
        supabase.from("cb_gifi_parts").select("summary, detail"),
      ]);
      const chart = (ch ?? []) as { number: string; name: string; line_no: string | null }[];
      const lineOfChart = new Map(chart.map((c) => [c.number, c.line_no]));
      const choices = accountChoices(chart,
        ((bas ?? []) as { id: string; name: string; number: string; chart_account: string }[]).map((b) => ({ ...b, code: (lineOfChart.get(b.chart_account) ?? "").slice(0, 4) })),
        ((gp ?? []) as { summary: string; detail: string }[]).map((x) => [x.summary, x.detail] as [string, string]));
      const initialAccounts = Object.fromEntries(((ob ?? []) as { code: string; chart_account: string | null; bank_account: string | null }[])
        .filter((o) => o.chart_account || o.bank_account).map((o) => [o.code, o.bank_account ? `bank:${o.bank_account}` : o.chart_account!]));
      const cents = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100));
      const pairs = (rows: { code: string; amount: number }[] | null) => (rows ?? []).map((o) => [o.code, Math.round(Number(o.amount) * 100)] as [string, number]);
      // Item 8: one place for last year's income statement, the Schedule 125 tab. A Schedule 125 saved in
      // the old separate box (cb_opening_s125) before Nov 15 shows in the tab until saved with the rest.
      body = <>{question}<OpeningSchedule fileId={id} codes={codes} initial={pairs(ob as { code: string; amount: number }[] | null)} s125Before={pairs(s125 as { code: string; amount: number }[] | null)}
        reStated={cents(file.opening_re_stated)} niTyped={cents(file.opening_ni_typed)} note={file.opening_note ?? ""} savedAt={file.opening_set_at ?? null}
        pdf={file.opening_pdf ? { href: `/closebook/${id}/opening-pdf`, name: "Source PDF" } : null}
        signed={file.opening_signed_at ? { by: firstName(names.get(file.opening_signed_by ?? "") ?? ""), at: formatDate(file.opening_signed_at) } : null}
        source={file.opening_source ?? null} bankIssue={openingRow?.reviewer_reason ?? ""} editable={editable && file.phase !== "locked"} choices={choices} initialAccounts={initialAccounts} /></>;
    }
  } else if (step === "setup" && pickPaper(stepPapers("setup", { full: true, shareholders: false, ownerPaid: false, gst: false })) === "acceptance") {
    // Round 16: the acceptance and continuance record (CSRS 4200), rolled forward from the client's last file.
    const [{ data: accRow }, { data: prior }] = await Promise.all([
      supabase.from("cb_acceptance").select("*").eq("file_id", id).maybeSingle(),
      supabase.from("cb_files").select("id, year_end").eq("client_id", file.client_id).lt("year_end", file.year_end).order("year_end", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const [{ data: lastRow }, { data: cl }] = await Promise.all([
      prior ? supabase.from("cb_acceptance").select("*").eq("file_id", prior.id).maybeSingle() : Promise.resolve({ data: null }),
      // Round 18: the client's basis and users of the statements, confirmed here each year.
      supabase.from("clients").select("basis, custom_basis_wording, statement_users").eq("id", file.client_id).maybeSingle(),
    ]);
    const norm = (r: Record<string, unknown> | null): AccRow | null => (r ? { ...emptyAcc(), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ""])), users: (r.users as AccRow["users"]) ?? [], answered: (r.answered as AccRow["answered"]) ?? {}, confirmed: (r.confirmed as AccRow["confirmed"]) ?? null } : null);
    const client: Statements = { basis: (cl?.basis as string) ?? "standard", custom_basis_wording: (cl?.custom_basis_wording as string) ?? "", users: ((cl?.statement_users as Statements["users"]) ?? []) };
    body = <AcceptanceForm fileId={id} clientId={file.client_id} back={`${href("setup")}&paper=acceptance`} row={norm(accRow)} last={norm(lastRow)} lastYear={prior ? formatDate(prior.year_end as string) : null}
      editable={editable && file.phase !== "locked"} locked={file.phase === "locked"} client={client} names={Object.fromEntries(names)} me={access.staff_id ?? ""} signed={!!review.status.setup?.prepared_at} />;
  } else if (step === "setup") {
    // A form: one column about 1,100 px wide, each Yes/No right after its question (round 2 items 9 and 13).
    body = (
      <div className="form-col">
        <section className="card text-sm">
          <h2 className="mb-2 font-semibold">File settings</h2>
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Year</dt><dd>{formatDate(file.year_start)} to {formatDate(file.year_end)}</dd></div>
            <div><dt className="text-xs text-muted">Data source</dt><dd>{dataSourceLabel(file)}</dd></div>
            <div><dt className="text-xs text-muted">Preparer</dt><dd>{people.preparer}</dd></div>
            <div><dt className="text-xs text-muted">Reviewer</dt><dd>{people.reviewer}</dd></div>
          </dl>
        </section>
        <section className="card mt-4">
          <h2 className="font-semibold">Setup questions</h2>
          {/* Round 21: "Saved 2:14 PM", Discard changes, and a question before leaving or changing a signed step. */}
          <SaveForm action={saveSetup} className="group grid gap-1" aria-label="Setup questions"
            signed={review.status.setup?.prepared_at ? "Step 1 is signed." : null}>
            <input type="hidden" name="file_id" value={id} />
              <SetupQ name="realtor" q="Is the client a realtor, a team or a PREC?" adds="Yes adds: T4A check" value={setup.realtor as boolean | undefined} />
              <SetupQ name="owner_paid" q="Did the owner pay company expenses personally?" adds="Yes adds: expenses paid personally" value={setup.owner_paid as boolean | undefined} />
              <SetupQ name="dividends" q="Were dividends paid this year?" adds="Yes adds: T5 slips and summary" value={setup.dividends as boolean | undefined} />
              <SetupQ name="payroll" q="Does the company run payroll?" adds="Yes adds: T4 reconciliation" value={setup.payroll as boolean | undefined} />
              <SetupQ name="holdco" q="Does it own, or is it owned by, another company?" adds="Yes adds: investments and intercompany balances" value={setup.holdco as boolean | undefined} />
              <SetupQ name="gst_registered" q="Is it registered for GST/HST?" adds="No: the tax stays in the expense; nothing is split out" value={setup.gst_registered as boolean | undefined} />
            <div className="grid items-center gap-2 border-t border-sand-100 py-2 sm:grid-cols-[30rem_auto]">
              <span className="text-sm"><label htmlFor="gst_frequency">GST/HST filing frequency</label><InfoTip>Annual adds: the annual GST/HST return</InfoTip></span>
              <select id="gst_frequency" name="gst_frequency" defaultValue={(setup.gst_frequency as string) ?? ""} className="input input-compact max-w-[9rem]">
                <option value="">Choose</option><option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option>
              </select>
            </div>
              <SetupQ name="quick_method" q="Does it use the quick method?" adds="Yes: no ITCs on operating expenses, meals included; capital purchases still claim them" value={setup.quick_method as boolean | undefined} />
            {/* Round 20: which quick method rate applies, shown while the quick method is Yes. Services by default. */}
            <fieldset className="hidden items-center gap-2 border-t border-sand-100 py-2 group-has-[#setup-quick-method-yes:checked]:grid sm:grid-cols-[30rem_auto]">
              <legend className="sr-only">Which quick method rate applies?</legend>
              <span className="text-sm">Which quick method rate applies?<InfoTip>The GST/HST return uses this rate for the client&rsquo;s province, from Settings, Sales tax rates, Quick method rates</InfoTip></span>
              <span className="inline-flex w-fit overflow-hidden rounded-md border border-sand-300">
                {([["services", "Services (most real estate businesses)"], ["goods", "Goods for resale"]] as const).map(([v, label]) => (
                  <label key={v} className="cursor-pointer px-3 py-1 text-sm has-[:checked]:bg-navy-700 has-[:checked]:text-white [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-300">
                    <input type="radio" name="quick_method_type" value={v} defaultChecked={(setup.quick_method_type === "goods" ? "goods" : "services") === v} className="sr-only" />{label}
                  </label>
                ))}
              </span>
            </fieldset>
            <div className="grid items-center gap-2 border-t border-sand-100 py-2 sm:grid-cols-[30rem_auto]">
              <label htmlFor="gst_rt" className="text-sm">GST/HST account</label>
              <input id="gst_rt" name="gst_rt" defaultValue={(setup.gst_rt as string) ?? "RT0001"} className="input input-compact max-w-[9rem]" />
            </div>
              <SetupQ name="gst_year_same" q="GST/HST year same as the fiscal year?" adds="No: no return is built; ask the client to change the reporting period with CRA" value={(setup.gst_year_same as boolean | undefined) ?? true} />
            {editable && <div className="flex items-center gap-2 pt-3"><SaveFormButton className="btn" /><SaveFormDiscard className="btn-secondary" /></div>}
          </SaveForm>
        </section>
      </div>
    );
  } else if (step === "records") {
    // Round 23 (Hashim, Nov 16, 2026): step 3 is "Banking" on a bank file, with sub-steps 3.1 to 3.3. Without a
    // sub-step asked for, the first one the preparer has not signed opens.
    if (bankFile && subs) {
      const asked = SUBS.find((x) => x.paper === str(sp.paper));
      const first = asked ?? SUBS.find((x) => !subs[x.key].prepared_at) ?? SUBS[0];
      pp.list = stepPapers("records", { full: true, shareholders: false, ownerPaid: false, gst: false, bank: true });
      pp.key = first.paper;
      body = <BankingPage supabase={supabase} file={{ id: file.id, year_start: file.year_start, year_end: file.year_end, opening_source: file.opening_source ?? null, first_year: file.first_year ?? null }}
        names={names} sp={sp} editable={editable && file.phase !== "locked"} sub={first.key} subs={subs} isOwner={access.is_owner}
        lock={feedLock(subs, access.is_owner || access.staff_id === file.reviewer_id, access.staff_id)} />;
    } else body = tb("records", [], "accounts", true, { importOnly: true });
  } else if (step === "code") {
    body = bankFile
      // Round 31 (Hashim, Nov 17, 2026): QuickBooks Online's Bank transactions page (Pending, Posted, Excluded).
      ? <BankFeed data={await loadFeed(supabase, { id, client_id: file.client_id, year_start: file.year_start, year_end: file.year_end }, client?.province ?? "ON", setup)}
          editable={editable && file.phase !== "locked"} isReviewer={isReviewer || access.is_owner} initialAccount={str(sp.account)} focusLine={str(sp.line) ?? null} initialRules={str(sp.rules) === "1"} openAsk={str(sp.ask) === "1"} />
      : tb("code", ["accounts", "lines"], "accounts", false);   // the uploads stay on step 3 (round 8b item 8)
    // Round 24: a line's accounting date and memo, from step 4 (the date opens it).
    if (bankFile && str(sp.ln) && editable && file.phase !== "locked") {
      const { data: ln } = await supabase.from("cb_bank_lines").select("id, txn_date, acct_date, description, amount, memo, account:account_id(name)").eq("id", str(sp.ln)!).eq("file_id", id).maybeSingle();
      if (ln) body = <>{body}<LineWindow fileId={id} closeHref={`${href("code")}${str(sp.account) ? `&account=${str(sp.account)}` : ""}`} yearStart={file.year_start} yearEnd={file.year_end}
        line={{ id: ln.id as string, bankDate: ln.txn_date as string, acctDate: (ln.acct_date ?? ln.txn_date) as string, description: ln.description as string,
          cents: Math.round(Number(ln.amount) * 100), memo: (ln.memo ?? "") as string, account: ((ln.account as unknown as { name: string } | null)?.name ?? "") }} /></>;
    }
  } else if (step === "entries") {
    // Step 5, Adjustments (piece 5; round 15b's papers kept): the revenue check is a working paper
    // under the step, each on its own screen when chosen. With no paper chosen, the Adjustments page: last
    // year's line, the Schedules table and the Entries tab's list. Piece 4b: the Expenses paid personally paper is retired.
    const full = file.file_type === "full";
    // Piece 7: the revenue check shows only once added ("+ Add revenue check", or anything saved in it before piece 7).
    const rev5 = full ? await loadRevenue(supabase, id) : null;
    // Piece 8: the shareholder loans moved to Reporting and step 7.
    const list5 = stepPapers("entries", { full, shareholders: false, ownerPaid: setup.owner_paid === true, gst: false, revenue: !!rev5?.state.added });
    pp.list = list5; pp.key = list5.find((x) => x.key === str(sp.paper))?.key;
    const p = pp.key;
    const open = editable && file.phase !== "locked";
    if (!full) body = soon("Monthly file: entries are made in QuickBooks.");
    else if (p === "revenue") {
      const form = await loadEntryForm(supabase, file, client?.province ?? "ON", client?.legal_name ?? "The client");
      const rev = rev5!;
      body = <RevenueCheck fileId={id} st={rev.state} sources={rev.sources} opts={form.opts} revenueOpts={form.opts.filter((o) => o.type === "Revenue")} editable={open}
        isOwner={access.is_owner} names={names} hasFix={entries.some((e) => e.origin === "revenue_check")} fixHref={`${paperHref("entries", "revenue")}&new=revenue`} />;
    }
    else {
      const base5 = href("entries");
      const std = (await loadEntryForm(supabase, file, client?.province ?? "ON", client?.legal_name ?? "The client")).standard.map((x) => ({ id: x.id, name: x.name }));
      const [top, ea] = await Promise.all([
        adjustmentsTop({ supabase, file, entries, base: base5, editable, addRevenue: open && rev5 && !rev5.state.added ? (
          <form action={addRevenueCheck}><input type="hidden" name="file_id" value={id} />
            <button className="text-[13px] font-medium text-navy-700 underline" data-add-revenue>+ Add revenue check</button></form>) : undefined, papers: list5.map((x) => ({ name: x.name, href: paperHref("entries", x.key), status: paperProgress("entries", x.key, progress) })) }),
        entriesArea({ supabase, file, entries, accounts, names, editable, isReviewer, standard: std, listBase: base5, title: "Entries this year",
          rounding: bankFile ? await loadRounding(supabase, { id: file.id, opening_source: file.opening_source ?? null, first_year: file.first_year ?? null }) : [],
          sp: { type: str(sp.type), status: str(sp.status), source: str(sp.source) } }),
      ]);
      body = <>{top}{ea.content}</>;
    }
  } else if (step === "review") {
    // Step 7 (round 8): the reviewer's list, the open notes and the completion checklist. Piece 10: the lead sheets moved to step 6.
    {
      // Every amount as the working papers show it: a negative in brackets (round 9b item 2).
      const amt = (v: number) => { const t = Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${t})` : t; };
      const lineOf = (no: string | null) => ref.lines.find((l) => l.line_no === no);
      const { data: rl } = bankFile ? await supabase.from("cb_bank_lines").select("id, account_id, txn_date, description, amount, reviewer_reason").eq("file_id", id).eq("status", "reviewer").order("txn_date") : { data: [] };
      const rev7 = file.file_type === "full" ? (await loadRevenue(supabase, id)).state : null;
      // Piece 8: the shareholder loans (the report, the saved figures and the reviewer's notes).
      const [shRep, shData, { data: shNotedRaw }] = await Promise.all([loadShReport(supabase, file, accounts, entries, ref.lines, ref.sheets),
        loadShLoans(supabase, file, accounts, entries, ref.lines, ref.sheets), supabase.from("cb_sh_noted").select("account_key, closing, due_on, noted_by, noted_at").eq("file_id", id)]);
      const shNoted = ((shNotedRaw ?? []) as ShNotedRow[]).map((x) => ({ ...x, closing: Number(x.closing) }));
      const groups: ReviewGroup[] = [
        { key: "opening", title: "Opening balance differences", step: "step 2", items: openingRow?.needs_reviewer
          ? [{ href: href("opening"), label: "Difference with last year's closing balances", detail: openingRow.reviewer_reason ?? "", amount: amt(openingRow.this_year) }] : [] },
        // Round 35: on a bank file the lines for the reviewer are a working list (below), not links to step 4.
        { key: "code", title: "Lines for the reviewer", step: "step 4", items: bankFile ? [] : ((rl ?? []) as { id: string; account_id: string; txn_date: string; description: string; amount: number; reviewer_reason: string }[]).map((l) => (
          { href: `${href("code")}&account=${l.account_id}&line=${l.id}`, label: `${formatDate(l.txn_date)} ${l.description}`, detail: l.reviewer_reason ?? "", amount: amt(Number(l.amount)) })) },
        { key: "entries", title: "Entries to approve", step: "step 5", items: entries.filter((e) => e.needs_review && !e.reviewed_at).map((e) => (
          { href: `/closebook/${id}?area=entries&open=${e.id}`, label: `Entry ${entryNo(file.year_end, e)}`, detail: e.note, amount: amt(e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0)) })) },
        { key: "revenue", title: "Revenue check", step: "step 5", items: rev7 ? revenueWaiting(rev7).map((w) => ({ href: paperHref("entries", "revenue"), label: w.label,
          detail: w.explained ? w.text : w.text ? `Explained for another amount: ${w.text}` : "Not explained yet.", amount: amt(w.diff) })) : [] },
        // Piece 7: the GST/HST revenue comparison moved to step 8; a difference over the threshold still waits here.
        { key: "gst_revenue", title: "GST/HST revenue", step: "step 8", items: rev7 ? gstRevenueWaiting(rev7).map((w) => ({ href: `${paperHref("t2", "gst")}#gst-revenue`, label: w.label,
          detail: w.explained ? w.text : w.text ? `Explained for another amount: ${w.text}` : "Not explained yet.", amount: amt(w.diff) })) : [] },
        // Piece 8: the shareholder loans are the reviewer's, here in step 7 (the panel below answers them).
        { key: "sh", title: "Shareholder loans", step: "step 7", items: [
          ...shRep.cards.filter((c) => c.owedBy).map((c) => {
            const n = shNoted.find((x) => x.account_key === c.key);
            const ok = !!n && Math.round(n.closing * 100) === -c.closingCents && n.due_on === c.dueOn;
            return { href: `${href("review")}#sh-review`, label: `${cardTitle(c)}: ${owedLine(-c.closingCents, c.dueOn!)}`, detail: ok ? "Noted." : "To note.", amount: amt(c.closingCents / 100) };
          }),
          ...((await supabase.from("cb_sh_flags").select("account_key, flag, closing").eq("file_id", id).is("accepted_at", null)).data ?? [] as { account_key: string; flag: ShFlag; closing: number }[])
            .map((f: { account_key: string; flag: ShFlag; closing: number }) => ({ href: `${href("review")}#sh-review`,
              label: `${f.account_key.startsWith("sh:") ? `Shareholder ${f.account_key.slice(3)}` : "Shareholder"}: ${flagText(f.flag, Math.round(Number(f.closing) * 100), file.year_end)}`, detail: "To decide.", amount: amt(Number(f.closing)) })),
        ] },
        // Piece 10: the reviewer's GIFI checks are step 7's; each opens the account on the Trial balance tab's GIFI matching view.
        { key: "mapping", title: "Accounts for the reviewer's decision", step: "step 7", items: bankFile ? [] : accounts.filter((a) => (a.needs_reviewer && !["opening", "uncoded"].includes(a.account_key)) || typeFlag(a, lineOf(a.line_no)) === "open"
          || sideFlag(a, lineOf(a.line_no), finalOf(a)) === "open").map((a) => (
          { href: `/closebook/${id}?area=tb&tbv=match&edit=${a.id}`, label: `${a.number ? `${a.number} ` : ""}${a.name}`,
            detail: a.needs_reviewer ? a.reviewer_reason : [typeFlag(a, lineOf(a.line_no)) === "open" ? typeFlagText(a, lineOf(a.line_no)) : "", sideFlagText(a, lineOf(a.line_no), finalOf(a))].filter(Boolean).join(" "),
            amount: amt(finalOf(a)) })) },
      ];
      // Piece 10: each "yes" in step 6's "What changed this year" waits here until the reviewer marks it reviewed.
      const ycOpen = file.phase !== "locked" && editable && access.is_owner;
      groups.push({ key: "year_changes", title: "What changed this year", step: "step 6", items: YEAR_QUESTIONS.flatMap(([q, text]) => {
        const y = yearChanges.find((x) => x.question === q && x.answer && !x.reviewed_at);
        return y ? [{ href: `${href("compare")}#year-changes`, label: `${text}: Yes`, detail: y.note, action: ycOpen ? <MarkReviewed fileId={id} question={q} /> : undefined }] : [];
      }) });
      // Piece 10: the new accounts of step 6 and their GIFI lines, each marked reviewed by the reviewer.
      const cmp7 = compareLists(accounts, entries, ref.lines, ref.sheets, ref.flag);
      const amt7 = (c: number) => amt(c / 100);
      const lineName7 = (no: string | null) => { if (!no) return ""; const l = ref.lines.find((x) => x.line_no === no); return `${no.replace(/\.00$/, "")}${l ? ` ${l.name}` : ""}`; };
      const newList = cmp7.newAccounts.length ? <NewAccountsReview fileId={id} editable={editable && file.phase !== "locked"} isOwner={access.is_owner}
        rows={cmp7.newAccounts.map((r) => { const t = newTicks.find((x) => x.account_key === r.key);
          return { key: r.key, label: `${r.number ? `${r.number} ` : ""}${r.name}`, line: lineName7(r.line), amount: amt7(r.finalCents),
            ledger: `/closebook/${id}?area=reporting&report=gl&account=${encodeURIComponent(r.key)}&back=${encodeURIComponent(href("review"))}`,
            confirmed: !!t && t.confirmed_line === r.line,
            reviewed: t?.reviewed_at && t.reviewed_line === r.line ? `${firstName(names.get(t.reviewed_by ?? "") ?? "")} ${formatDate(t.reviewed_at)}`.trim() : "" }; })} /> : null;
      const stepName = (k: string) => { const x = steps.find((y) => y.key === k); return x ? `Step ${x.n}, ${x.name}` : k; };
      const openNotes: ReviewItem[] = review.notes.filter((n) => n.status !== "cleared").map((n) => (
        { href: `${href(n.step)}#note-${n.id}`, label: `${stepName(n.step)}${n.target_label ? `: ${n.target_label}` : ""}`,
          detail: `${n.status === "fixed" ? "Fixed, to clear. " : ""}${n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body}` }));
      // Round 35 (Hashim; QuickBooks Online Accountant's Reclassify, TaxDome's Mark reviewed): the lines with the reviewer
      // on step 4's table, and the accounts for the reviewer's decision, each marked reviewed in place.
      let list: React.ReactNode = null, listCount = 0;
      if (bankFile) {
        const reviewHref = href("review");
        const acctRows: ReviewAccountRow[] = accounts.filter((a) => !["opening", "uncoded"].includes(a.account_key)).flatMap((a): ReviewAccountRow[] => {
          const line = lineOf(a.line_no), label = `${a.number ? `${a.number} ` : ""}${a.name}`, cents = Math.round(finalOf(a) * 100);
          const ledgerHref = `/closebook/${id}?area=reporting&report=gl&account=${encodeURIComponent(a.account_key)}&back=${encodeURIComponent(reviewHref)}`;
          if (a.needs_reviewer) return [{ id: a.id, label, cents, why: a.reviewer_reason ?? "", kind: "reviewer", ledgerHref }];
          if (typeFlag(a, line) === "open") return [{ id: a.id, label, cents, why: typeFlagText(a, line), kind: "type", ledgerHref }];
          if (sideFlag(a, line, finalOf(a)) === "open") return [{ id: a.id, label, cents, why: sideFlagText(a, line, finalOf(a)), kind: "side", ledgerHref }];
          return [];
        });
        const feed = await loadFeed(supabase, { id, client_id: file.client_id, year_start: file.year_start, year_end: file.year_end }, client?.province ?? "ON", setup);
        listCount = feed.lines.filter((l) => l.status === "reviewer").length + acctRows.length;
        list = <ReviewLines data={feed} editable={editable && file.phase !== "locked"} isReviewer={isReviewer || access.is_owner} focusLine={str(sp.line) ?? null}
          accounts={acctRows} stepFour={href("code")} />;
      }
      body = <ReviewStep groups={groups} notes={openNotes} list={list} listCount={listCount}
        extra={<>{newList}{shData.status.applies || shRep.cards.length ? <ShReview fileId={id} sh={shData} report={shRep} noted={shNoted} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} names={names} /> : null}</>} />;
    }
  } else if (step === "compare") {
    // Piece 10 (Hashim, Nov 19, 2026; mock L; CaseWare Cloud's analytical review): "Compare to last year", the preparer's page.
    // The lead sheets view moved here from step 7. GIFI matching is on the Trial balance tab (piece 9).
    if (view === "lead") body = accounts.length ? <><Link href={href("compare")} className="mb-2 inline-block text-[12.5px] font-semibold text-navy-700 hover:underline" data-compare-back>‹ Compare to last year</Link>
      {tb("compare", ["lead"], "lead", false)}</> : soon("The lead sheets open once there is a trial balance.");
    else {
      const amt6 = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
      const lineName = (no: string | null) => { if (!no) return ""; const l = ref.lines.find((x) => x.line_no === no); return `${no.replace(/\.00$/, "")}${l ? ` ${l.name}` : ""}`; };
      const ledger = (key: string) => `/closebook/${id}?area=reporting&report=gl&account=${encodeURIComponent(key)}&back=${encodeURIComponent(href("compare"))}`;
      const label = (r: { number: string; name: string }) => `${r.number ? `${r.number} ` : ""}${r.name}`;
      const cmp = compareLists(accounts, entries, ref.lines, ref.sheets, ref.flag);
      const seenKeys = new Set((seenRow?.seen_key ?? "").split(",").filter(Boolean));
      const seen = cmp.unused.length > 0 && cmp.unused.length === seenKeys.size && cmp.unused.every((r) => seenKeys.has(r.key));
      const st6 = review.status.compare;
      body = <CompareStep fileId={id} editable={editable && file.phase !== "locked"} flagRule={flagRuleText(ref.flag)} leadHref={`${href("compare")}&view=lead`}
        flagged={cmp.flagged.map((r) => ({ id: r.id, label: label(r), last: amt6(r.lastCents), final: amt6(r.finalCents), change: amt6(r.changeCents),
          pct: pctChange(r.finalCents, r.lastCents), ledger: ledger(r.key), note: data.notes.get(r.id) }))}
        newAccounts={cmp.newAccounts.map((r) => ({ key: r.key, label: label(r), line: lineName(r.line), amount: amt6(r.finalCents), ledger: ledger(r.key),
          confirmed: newTicks.some((t) => t.account_key === r.key && t.confirmed_line === r.line) }))}
        unused={cmp.unused.map((r) => ({ key: r.key, label: label(r), line: lineName(r.line), amount: amt6(r.lastCents), ledger: ledger(r.key) }))}
        seen={seen} answers={Object.fromEntries(yearChanges.map((y) => [y.question, { answer: y.answer, note: y.note }]))}
        canSign={editable && file.phase !== "locked" && !st6?.prepared_at} back={href("compare")} />;
    }
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
    // Round 15b: the papers GIFI file, Tax workpaper, T2 tie-out and, for a registrant's full file, GST/HST return.
    const p = pickPaper(stepPapers("t2", { full: file.file_type === "full", shareholders: false, ownerPaid: false, gst: !!gst }));
    // Piece 7: the revenue on the year's GST/HST returns against the books (moved from step 5), a registrant's full file.
    const rev8 = p === "gst" && file.file_type === "full" ? await loadRevenue(supabase, id) : null;
    const revenueBox = rev8?.state.registrant ? <GstRevenueBox fileId={id} st={rev8.state} sources={rev8.sources} editable={editable && file.phase !== "locked"} isOwner={access.is_owner}
      names={names} back={`/closebook/${id}?step=t2&paper=gst`} /> : undefined;
    body = p === "gst" && gst ? <GstSection fileId={id} g={gst} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} drill={dl} names={names} revenueBox={revenueBox} />
      : g ? <T2Step fileId={id} g={g} staff={names} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} rounding={rounding} paper={p} />
      : soon("The GIFI file opens once there is a trial balance.");
  } else if (step === "statements") {
    // Step 9 (round 11): the year-end package, its fields and the MAL's signing.
    pk = accounts.length ? await loadPackage(supabase, id) : null;
    const p = pickPaper(stepPapers("statements", { full: true, shareholders: false, ownerPaid: false, gst: false }));
    body = pk ? <StatementsStep fileId={id} pk={pk} editable={editable && file.phase !== "locked"} isOwner={access.is_owner} siteUrl={env.siteUrl()} paper={p} />
      : soon("The package opens once there is a trial balance.");
  } else {
    // Step 10 (round 8b, round 12): the completion checklist, then delivery and the lock.
      const [{ data: qs }, { data: ans }, wording, { data: appr }, { data: acc }] = await Promise.all([
        supabase.from("cb_checklist_questions").select("key, active").order("sort_order"),
        supabase.from("cb_checklist_answers").select("question, answer, note").eq("file_id", id),
        loadWordingState(supabase),
        supabase.from("template_approvals").select("approved_on").eq("template_key", "cbchecklist").limit(1).maybeSingle(),
        supabase.from("cb_acceptance").select("q5").eq("file_id", id).maybeSingle(),
      ]);
      // Round 16: the 13 questions; a file answered on the first 12, and none of the 13, keeps those.
      const allQs = (qs ?? []) as { key: string; active: boolean }[];
      const answered = new Set(((ans ?? []) as { question: string }[]).map((a) => a.question));
      const v1 = allQs.some((q) => !q.active && answered.has(q.key)) && !allQs.some((q) => q.active && answered.has(q.key));
      const checklistVersion: "v1" | "v2" = v1 ? "v1" : "v2";
      const texts = wording.live?.texts ?? {};
      const ansOf = new Map(((ans ?? []) as { question: string; answer: ChecklistRow["answer"]; note: string }[]).map((a) => [a.question, a]));
      const checklist: ChecklistRow[] = allQs.filter((q) => q.active !== v1).map((q) => {
        const piece = [...CB_CHECKLIST, ...CB_CHECKLIST_V1].find((c) => c.key === q.key);
        return { key: q.key, text: piece ? cbText(texts, piece) : q.key, answer: ansOf.get(q.key)?.answer ?? "", note: ansOf.get(q.key)?.note ?? "" };
      });
    // Round 12: step 10, "Deliver and lock": the checklist, the client email, the documents, the filing
    // record and the lock.
    const cd = accounts.length ? await loadClose(supabase, id) : null;
    const p = pickPaper(stepPapers("lock", { full: true, shareholders: false, ownerPaid: false, gst: false }));
    body = cd ? <CloseStep fileId={id} d={cd} checklist={checklist} checklistTrial={!appr} checklistVersion={checklistVersion} notIndependent={(acc as { q5?: string } | null)?.q5 === "no"} editable={editable} isOwner={access.is_owner} names={names} paper={p} />
      : soon("Step 10 opens once there is a trial balance.");
  }

  // Round 15 (CaseWare Cloud): the sign-offs are circles in the title row and the step rail; what is open
  // and waiting, and the step's review notes, sit in the Issues panel; explanations in the help panel.
  const papers = pp.list, paper = pp.key;
  const stepBack = `${href(step)}${paper ? `&paper=${paper}` : ""}${view ? `&view=${view}` : ""}`;
  const paperName = papers.find((x) => x.key === paper)?.name;
  // Step 9: a stopped package (a failed tie-out, named) blocks the sign-off like the database's own checks.
  const stStep = step === "statements" && pk?.blocked.length && review.status[step] ? { ...review.status[step], problems: [...new Set([...pk.blocked, ...(review.status[step].problems ?? [])])] } : review.status[step];
  const stepNotesList = review.notes.filter((n) => n.step === step);
  const stepNotes = <ReviewNotes fileId={id} notes={stepNotesList} names={names} isOwner={access.is_owner}
    canFix={preparerRole} editable={editable && file.phase !== "locked"} back={stepBack} />;
  const signFor = (k: StepKey, st = review.status[k], back = href(k)) => ({ fileId: id, step: k, st, names, me: access.staff_id, isOwner: access.is_owner,
    editable: editable && file.phase !== "locked", back, preparerElsewhere: k === "opening" && bankFile && !file.first_year,
    // Round 34: step 3 on a bank file is signed in 3.1, 3.2 and 3.3; its own circles say which are left.
    subsOf: k === "records" && subs ? SUBS.map((x) => ({ key: x.key, href: paperHref("records", x.paper), prepared: !!subs[x.key].prepared_at, reviewed: !!subs[x.key].reviewed_at })) : undefined });
  if (showHistory) {
    const hstep = str(sp.hstep) ?? null;
    const hist = await loadHistory(supabase, id, names, hstep);
    const stepName = (k: string) => { const x = steps.find((y) => y.key === k); return x ? `${x.n}. ${x.name}` : ""; };
    body = <><PageTitle>File history</PageTitle><HistoryView stepName={stepName} rows={hist} current={hstep} base={`/closebook/${id}?history=1`}
      exportBase={`/closebook/${id}/report-export?report=history`} steps={steps.map((x) => ({ key: x.key, label: `${x.n}. ${x.name}` }))} /></>;
  } else {
    const exports: [string, string][] = [[`/closebook/${id}/report-export?report=tb&format=xlsx`, "Trial balance, Excel"], [`/closebook/${id}/report-export?report=tb&format=pdf`, "Trial balance, PDF"],
      ...(step === "t2" ? [[`/closebook/${id}/tax-workpaper?format=xlsx`, "Tax workpaper, Excel"], [`/closebook/${id}/tax-workpaper?format=pdf`, "Tax workpaper, PDF"]] as [string, string][] : [])];
    // Round 23: on Banking the circles, the issues and the one button are the sub-step's.
    const sub = step === "records" && subs ? SUBS.find((x) => x.paper === paper) : undefined;
    const subSt = sub && subs ? { ...subs[sub.key], waiting: [], notes: 0 } : undefined;
    const subAction = sub && editable && file.phase !== "locked" ? (sub.key === "3.1" ? <Link href={`${href("records")}&paper=accounts&add=1`} scroll={false} className="btn h-10 px-5">+ Add account</Link>
      : sub.key === "3.2" ? <Link href={`${href("records")}&paper=feeds&upload=1`} scroll={false} className="btn h-10 px-5">Upload statements</Link> : null) : null;
    const title = (
      <StepTitle n={cur.n} name={cur.name} paper={paperName} action={subAction} sub={paper === "revenue" ? "W/P Revenue check" : paper === "acceptance" ? <InfoTip>CSRS 4200, acceptance and continuance: the preparer answers; the reviewer signs it with step 1. It rolls forward each year for confirmation.</InfoTip> : undefined} sign={sub && subSt ? { ...signFor(step, subSt, stepBack), sub: sub.key as SubKey, subsOf: undefined } : SIGNED_STEPS.includes(step) ? signFor(step, stStep, stepBack) : null}
        issues={sub && subSt ? { problems: subSt.reviewed_at ? [] : subSt.problems, waiting: [], review: false } : { problems: stStep?.reviewed_at ? [] : stStep?.problems ?? [], waiting: stStep?.reviewed_at ? [] : stStep?.waiting ?? [], review: step === "review" }}
        notesPanel={stepNotesList.length ? stepNotes : null} notesOpen={stepNotesList.filter((x) => x.status !== "cleared").length} next={step === current ? next : undefined}
        addNoteFor={access.is_owner && editable && file.phase !== "locked" ? { fileId: id, step, back: stepBack } : null}
        exports={exports} help={stepHelp(step, bankFile)}
        menu={editable && file.phase !== "locked" ? { fileId: id, step, n: cur.n, back: stepBack,
          clear: step === "records" || step === "review" ? "nothing" : stStep?.prepared_at ? "signed" : "ok" } : null} />
    );
    body = <>{title}
      {body}</>;
  }

  // The file's status chip, from the sign-offs (CaseWare's workflow status).
  const signs = SIGNED_STEPS.map((k) => review.status[k]);
  const status: FileStatus = file.phase === "locked" ? "Locked" : signs.every((x) => x?.reviewed_at) ? "Reviewed" : signs.every((x) => x?.prepared_at || x?.reviewed_at) ? "Ready for review"
    : signs.some((x) => x?.prepared_at || x?.reviewed_at) ? "In progress" : "Open";
  const rdata = await rdataP;
  const netCents = accounts.length ? fsStatements(trialBalance(rdata.accounts, rdata.postings), rdata.info).pl.net.now : null;
  const openNotes = review.notes.filter((n) => n.status !== "cleared").length;
  const area: Area = str(sp.area) === "reporting" ? "reporting" : report ? "tb" : (AREAS.find(([k]) => k === str(sp.area))?.[0] ?? "steps");

  // The left panel follows the tab.
  const stepRail = (
    <>
      <PanelHead>Steps</PanelHead>
      {steps.flatMap((x) => [
        <div key={x.key} data-step-row={x.key} className={`mx-1.5 flex h-10 items-center gap-2 rounded-lg pr-1.5 ${x.key === step && area === "steps" && !showHistory && (!papers.length || !paper) ? "bg-navy-50" : "hover:bg-sand-50"}`}>
          <Link href={href(x.key)} aria-current={x.key === step && area === "steps" ? "step" : undefined} className={`flex h-10 min-w-0 flex-1 items-center gap-2 pl-2 text-[12.5px] ${x.key === step && area === "steps" ? "font-semibold text-navy-900" : "text-ink-2"}`}>
            <StepMark n={x.n} p={stepProgress(x.key, progress)} /><span className="leading-snug">{x.name}</span>
          </Link>
          {x.notes > 0 && <span className="grid h-[15px] min-w-[15px] place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white" title={`${x.notes} review note${x.notes === 1 ? "" : "s"} open`}>{x.notes}</span>}
          <SignCircles {...signFor(x.key)} />
        </div>,
        ...(x.key === step && area === "steps" && !showHistory ? papers.map((pp) => (
          <Link key={`${x.key}-${pp.key}`} href={paperHref(x.key, pp.key)} aria-current={pp.key === paper ? "page" : undefined}
            className={`mx-1.5 flex h-10 items-center gap-2 rounded-lg pr-3 pl-8 text-[12.5px] leading-snug ${pp.key === paper ? "bg-navy-50 font-semibold text-navy-900" : "text-ink-2 hover:bg-sand-50"}`}>
            <PaperMark p={paperProgress(x.key, pp.key, progress)} />{pp.name}</Link>)) : []),
      ])}
    </>
  );
  const stepRailFolded = (
    <>{steps.map((x) => (
      <TipLink key={x.key} href={href(x.key)} label={`${x.n}. ${x.name}`} className={`relative mx-1.5 flex h-10 items-center justify-center rounded-lg text-xs tabular-nums ${x.key === step && area === "steps" ? "bg-navy-50 font-bold text-navy-900" : "text-ink-2 hover:bg-sand-50"}`}>
        <StepMark n={x.n} p={stepProgress(x.key, progress)} />{x.notes > 0 && <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-danger" />}
        {x.word === "signed" && <span className="absolute right-2 bottom-1 h-1.5 w-1.5 rounded-full bg-success" title="Reviewed" />}
      </TipLink>))}</>
  );
  const tbv = str(sp.tbv) ?? (report === "tb" && view === "flat" ? "accounts" : "groups");
  const tool = str(sp.tool) === "reclassify" && area === "tb" ? "reclassify" : undefined;
  const tbLeft = (
    <>
      <PanelHead>Views</PanelHead>
      {([["groups", "Groups"], ["accounts", "Accounts"], ["gifi", "GIFI lines"], ["match", "GIFI matching"]] as const).map(([k, l]) => <PanelLink key={k} href={`/closebook/${id}?area=tb&tbv=${k}`} on={(!report || report === "tb") && tbv === k && !tool}>{l}</PanelLink>)}
      <PanelHead>Reports</PanelHead>
      {REPORTS.filter(([k]) => k !== "tb").map(([k, l]) => <PanelLink key={k} href={`/closebook/${id}?report=${k}`} on={report === k && !tool}>{l}</PanelLink>)}
    </>
  );
  let left: React.ReactNode = stepRail, folded: React.ReactNode = stepRailFolded, content: React.ReactNode = body;
  if (area === "tb") {
    left = tbLeft; folded = null;
    content = tool === "reclassify"
      ? <ReclassifyPage data={await loadReclassify(supabase, file, rdata, entries)} initialAccount={str(sp.account)} />
      // Piece 9 (benchmark CaseWare Cloud): step 6's matching screen, whole, on the Trial balance tab (Tools > Match accounts to GIFI).
      : tbv === "match" && !report
      ? (accounts.length ? <><PageTitle>Trial balance · GIFI matching</PageTitle>{tb("compare", ["accounts", "lines", "unmatched"], "accounts", false, { at: `/closebook/${id}?area=tb&tbv=match` })}</>
        : soon("GIFI matching opens once the trial balance is there."))
      : report && report !== "tb"
      ? <ReportView fileId={id} p={{ report, account: str(sp.account), from: str(sp.from), to: str(sp.to), source: str(sp.source), expand: str(sp.expand), back: backHref ?? undefined, view: str(sp.view) }}
          data={rdata} yearEnd={file.year_end} yearStart={file.year_start}
          todo={[
            // What the preparer acts on, by cause, each linked (round 2 item 15). Zero counts are left out.
            { n: coding.open, one: "to code", many: "to code", href: href("code") },
            { n: coding.reviewer, one: "with the reviewer", many: "with the reviewer", href: href("code") },
            { n: coding.ask, one: "with the client", many: "with the client", href: href("code") },
            { n: openingRow && Math.round(openingRow.this_year * 100) !== 0 ? 1 : 0, one: "opening balance to enter", many: "opening balances to enter", href: href("opening") },
            { n: accounts.filter((a) => !a.line_no && !["opening", "uncoded"].includes(a.account_key) && (a.account_key !== "chart:10900" || Math.round(a.this_year * 100) !== 0)).length, one: "account without a GIFI line", many: "accounts without a GIFI line", href: `/closebook/${id}?area=tb&tbv=match` },
          ].filter((t) => t.n > 0)} />
      : <TbArea fileId={id} data={rdata} file={file} accounts={accounts} entries={entries} notes={review.notes} isOwner={access.is_owner} editable={editable && file.phase !== "locked"}
          view={tbv === "accounts" || tbv === "gifi" ? tbv : "groups"} drill={str(sp.drill)} col={str(sp.col)} flag={ref.flag}
          lineTax={new Map(ref.lines.map((l) => [l.line_no, l.default_tax_code ?? null]))} shNames={await loadShNames(supabase, file)} />;
  } else if (area === "reporting") {
    // Round 32: the Reporting tab. A report opens full page with "‹ Reporting" at the top left.
    left = null; folded = null;
    content = str(sp.report) === "questions"
      ? await questionsReport({ supabase, fileId: id, editable: editable && file.phase !== "locked", sp: { acct: str(sp.qacct), status: str(sp.qstatus) } })
      // Piece 8: Reporting > Shareholder loans.
      : str(sp.report) === "sh" ? <ShReportView fileId={id} r={await loadShReport(supabase, file, accounts, entries, ref.lines, ref.sheets)} yearStart={file.year_start} yearEnd={file.year_end} />
      : report
        ? <><ReportingBack fileId={id} back={backHref} /><ReportView fileId={id} p={{ report, account: str(sp.account), from: str(sp.from), to: str(sp.to), source: str(sp.source), expand: str(sp.expand), back: backHref ?? undefined, view: str(sp.view) }}
            data={rdata} yearEnd={file.year_end} yearStart={file.year_start} todo={[]} /></>
        : <ReportingList fileId={id} />;
  } else if (area === "entries") {
    const std = file.file_type === "full" ? (await loadEntryForm(supabase, file, client?.province ?? "ON", client?.legal_name ?? "The client")).standard.map((x) => ({ id: x.id, name: x.name })) : [];
    const ea = await entriesArea({ supabase, file, entries, accounts, names, editable, isReviewer, standard: std, rounding: bankFile ? await loadRounding(supabase, { id: file.id, opening_source: file.opening_source ?? null, first_year: file.first_year ?? null }) : [],
      sp: { type: str(sp.type), status: str(sp.status), source: str(sp.source), entry: str(sp.entry), back: backHref ?? undefined } });
    left = ea.left; folded = null; content = ea.content;
  } else if (area === "notes") {
    const na = notesArea({ fileId: id, notes: review.notes, steps, names, isOwner: access.is_owner, canFix: preparerRole,
      editable: editable && file.phase !== "locked", sp: { status: str(sp.status), step: str(sp.nstep), who: str(sp.who) } });
    left = na.left; folded = null; content = na.content;
  } else if (area === "statements") {
    const sa = await statementsArea({ supabase, fileId: id, data: rdata, isOwner: access.is_owner, sp: { doc: str(sp.doc), line: str(sp.line) } });
    left = sa.left; folded = null; content = sa.content;
  }

  // Round 16: the people on the file (CaseWare engagement properties). Only owners are offered as reviewer.
  const { data: staffRows } = await staffP;
  type StaffRow = { id: string; full_name: string; is_active: boolean; role: { is_owner: boolean; role_permissions: { area_key: string; level: string }[] } | null };
  const staffAll = ((staffRows ?? []) as unknown as StaffRow[]).filter((x) => x.is_active);
  const peopleProps = {
    preparer: { id: file.preparer_id, name: people.preparer }, reviewer: { id: file.reviewer_id, name: people.reviewer },
    canChange: access.is_owner && file.phase !== "locked",
    preparers: staffAll.filter((x) => x.role?.is_owner || x.role?.role_permissions.some((r) => r.area_key === "closebook" && r.level === "edit")).map((x) => ({ id: x.id, name: x.full_name })),
    reviewers: staffAll.filter((x) => x.role?.is_owner).map((x) => ({ id: x.id, name: x.full_name })),
    back: `/closebook/${id}${Object.keys(sp).length ? `?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && !["msg", "error", "people_error"].includes(k)) as [string, string][])}` : ""}`,
    error: str(sp.people_error) ?? null,
  };

  // Round 15b: the journal entry dialog, over whichever tab opened it.
  const keep = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && !["new", "open", "edit", "acct", "sched", "msg", "error"].includes(k)) as [string, string][]);
  const closeHref = `/closebook/${id}${keep.toString() ? `?${keep}` : ""}`;
  const dialogQ = new URLSearchParams(keep);
  for (const k of ["new", "open", "acct"]) if (str(sp[k])) dialogQ.set(k, str(sp[k])!);
  const dialog = await entryDialog({ supabase, file, province: client?.province ?? "ON", clientName: client?.legal_name ?? "The client", entries, accounts, names,
    me: access.staff_id ?? "", isReviewer: isReviewer || access.is_owner, editable, closeHref, here: `/closebook/${id}?${dialogQ}`, rdata: rdataP,
    sp: { new: str(sp.new), open: str(sp.open), edit: str(sp.edit), acct: str(sp.acct), sched: str(sp.sched), error: messageFrom(sp.error) } });

  // Round 34: "3.3 sign-off removed: <reason>", from History, for the person whose action removed it (last minute).
  const signoffPill = subs ? await loadSignoffPill(supabase, id, access.staff_id ?? "") : null;

  return (
    <FileShell people={peopleProps} fileId={id} client={client?.legal_name ?? ""} yearEnd={file.year_end} status={status} netCents={netCents} t2Due={fileBy(file.year_end)} source={dataSourceLabel(file)} area={area}
      tools={{ on: !!tool || (area === "tb" && tbv === "match" && !report), journal: editable && file.file_type === "full" && file.phase !== "locked" }}
      history={access.is_owner} left={left} folded={folded} pinned={(await readMenuPins(supabase, access.staff_id)).steps} notes={openNotes} done={{ n: stepsDone(STEP_KEYS, progress), of: STEP_KEYS.length }}
      toast={{ msg: messageFrom(sp.msg), error: sp.upload || sp.opening ? undefined : messageFrom(sp.error), info: signoffPill }}>
      {backHref && area !== "entries" && area !== "reporting" && <Link href={backHref} className="mb-2 inline-block text-[12.5px] font-semibold text-navy-700 hover:underline">← Back</Link>}
      {content}
      {dialog}
    </FileShell>
  );
}

// One Yes/No setup question (step 1). Blank until answered.
function SetupQ({ name, q, adds, value }: { name: string; q: string; adds: string; value: boolean | undefined }) {
  return (
    <fieldset className="grid items-center gap-2 border-t border-sand-100 py-2 sm:grid-cols-[30rem_auto]">
      <legend className="sr-only">{q}</legend>
      <span className="text-sm">{q}<InfoTip>{adds}</InfoTip></span>
      {/* A small two-button control right after the question, like QuickBooks Online's settings toggles. */}
      <span className="inline-flex w-fit overflow-hidden rounded-md border border-sand-300">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="cursor-pointer px-3 py-1 text-sm has-[:checked]:bg-navy-700 has-[:checked]:text-white [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-300">
            <input type="radio" id={`setup-${name.replace(/_/g, "-")}-${v}`} name={name} value={v} defaultChecked={value === (v === "yes")} className="sr-only" />{v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </span>
    </fieldset>
  );
}
