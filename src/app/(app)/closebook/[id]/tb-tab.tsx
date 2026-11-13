import { pctChange } from "@/lib/closebook/reports";
import Link from "next/link";
import { fileInputClass } from "@/components/ds/primitives";
import { formatDateTime } from "@/lib/dates";
import { effectiveLine, leadSheets, lockedLines, normalSide, typeFlag, typeFlagText, typeFromBooksMissing, typeNotChecked, wrongSign, type Line } from "@/lib/closebook/matching";
import { formatDate } from "@/lib/dates";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry, CbImport } from "@/lib/closebook/server";
import { importAccountList, importTrialBalance } from "../actions";
import { MatchWorkspace, type Group, type Row } from "./accounts-table";
import { LeadSheetsView, type LeadAcc, type LeadGroup } from "./lead-sheets";
import { GifiView } from "./gifi-view";
import type { BankData } from "@/lib/closebook/bank-server";

const SOURCES: Record<string, string> = { quickbooks: "QuickBooks", client_software: "the client's software", bookkeeper: "the bookkeeper", prior_accountant: "the prior accountant" };
// Dollars with thousands separators and two decimals everywhere (layout item 11); credits in brackets.
const two = (v: number) => v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const amt = (v: number) => (Math.round(v * 100) === 0 ? "–" : v < 0 ? `(${two(-v)})` : two(v));
const SOURCE_LABEL: Record<string, string> = { history: "Last year", suggested: "Suggested", preparer: "Preparer", reviewer: "Reviewer", chart: "Chart" };

type Props = {
  file: CbFileRow; accounts: CbAccount[]; imports: CbImport[]; entries: CbEntry[]; editable: boolean; isReviewer: boolean;
  lines: Line[]; sheets: { code: string; name: string }[]; taxes: { code: string; name: string }[]; flag: { amount: number; percent: number };
  view: string; craText: Map<string, string>; notes: Map<string, { reason: string; note: string }>; edit?: string;
  gifi?: Parameters<typeof GifiView>[0]["g"] | null;
  bank?: BankData | null;
  // The step page (10 steps): where links point, which views show, and whether the import card shows.
  base?: string; pills?: string[]; showImport?: boolean;
  // Bank-statement files: what makes up "Opening balances to enter" (round 2 item 8).
  causes?: { text: string; cents: number }[];
  // Staff names, for "Reviewer confirmed: reason (name, date)" (round 6).
  names?: Map<string, string>;
};

// Trial balance tab (Phase 3 batch, section 2 and 4.5; mockup FileTrialBalance): Accounts with their
// GIFI line and tax code, the reviewer's list, and Lead sheets. Transactions arrive with part 2b.
export function TbTab(p: Props) {
  const { file, accounts, imports, entries, editable, isReviewer, lines, sheets, taxes, flag, view } = p;
  const base = p.base ?? `/closebook/${file.id}?tab=tb`;
  const shown = (k: string) => !p.pills || p.pills.includes(k);
  const byNo = new Map(lines.map((l) => [l.line_no, l]));
  const entryTotals = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
  const finalOf = (a: CbAccount) => a.this_year + (entryTotals.get(a.id) ?? 0);
  const thisImport = imports.find((i) => i.target === "this_year");
  // Round 6 item 2: the QuickBooks Online Account List, an optional second upload for files that import a
  // trial balance. Without it, one line says how many accounts have no type from the client's books.
  const tbFile = !["statements", "paper"].includes(file.books);
  const listImport = imports.find((i) => i.target === "account_list");
  const noBooksType = tbFile && thisImport && !listImport ? accounts.filter((a) => typeFromBooksMissing(a) && !(a.this_year === 0 && a.last_year === 0)).length : 0;
  const total = accounts.reduce((n, a) => n + a.this_year, 0);
  const balanced = accounts.length > 0 && Math.round(total * 100) === 0;
  // A nil Clearing (10900) is not "unmatched": it has no GIFI line by design.
  const unmatched = accounts.filter((a) => !a.line_no && !a.needs_reviewer && a.account_key !== "chart:10900");
  const waiting = accounts.filter((a) => a.needs_reviewer);
  const locked = file.phase === "locked";
  const pill = (k: string, label: string, off?: boolean) => (
    <Link href={`${base}&view=${k}`} className={`rounded-full px-3 py-1 ${view === k ? "bg-navy-700 font-medium text-white" : off ? "border border-sand-200 text-ink-3" : "border border-sand-200 text-ink-2 hover:border-navy-300"}`}>{label}</Link>
  );
  const lineLabel = (no: string | null) => (no ? `${no} ${byNo.get(no)?.name ?? ""}` : "");
  const taxOf = (a: CbAccount) => a.tax_code ?? (a.line_no ? byNo.get(effectiveLine(a.line_no, finalOf(a), byNo) ?? a.line_no)?.default_tax_code ?? "" : "");
  // Round 5: the type check works from the account's type (standard chart, client's books, the type chosen
  // in Closebook, else the number). Round 6: a mismatch needs the reviewer until they keep it there with a
  // typed reason, shown on the line.
  const lineOf = (a: CbAccount) => (a.line_no ? byNo.get(a.line_no) : undefined);
  const isMismatch = (a: CbAccount) => typeFlag(a, lineOf(a)) !== "";
  const confirmed = (a: CbAccount) => typeFlag(a, lineOf(a)) === "confirmed";
  const mismatchText = (a: CbAccount) => typeFlagText(a, lineOf(a), a.type_confirmed_by ? (p.names?.get(a.type_confirmed_by) ?? "").split(" ")[0] : "", formatDate(a.type_confirmed_at));
  const lockedSet = lockedLines(lines);
  const options = lines.filter((l) => l.mappable).map((l) => ({ no: l.line_no, label: `${l.line_no} ${l.name}`, section: l.section ?? "", hint: p.craText.get(l.gifi_code) ?? "",
    locked: lockedSet.has(l.line_no), normal: normalSide(l) }));
  const unusedOf = (a: CbAccount) => a.this_year === 0 && a.last_year === 0 && !entryTotals.has(a.id) && !["opening", "uncoded"].includes(a.account_key);
  const rows: Row[] = accounts.map((a) => {
    const fin = finalOf(a);
    const eff = effectiveLine(a.line_no, fin, byNo);
    return {
      id: a.id, number: a.number, name: a.name, last: amt(a.last_year), current: amt(a.this_year), final: amt(fin), finalNum: fin,
      // The trial balance's rule, on the figures shown (round 4 item 1): this year after entries against last year.
      change: pctChange(Math.round(fin * 100), Math.round(a.last_year * 100)),
      lineNo: a.line_no ?? "", lineLabel: eff ? `${eff} ${byNo.get(eff)?.name ?? ""}` : "", movedFrom: eff && eff !== a.line_no ? a.line_no ?? "" : "",
      source: SOURCE_LABEL[a.mapping_source ?? ""] ?? "", needsReviewer: a.needs_reviewer, reason: a.reviewer_reason, mismatch: a.line_no && lockedSet.has(a.line_no) ? "Locked line: choose one of its sub-lines" : mismatchText(a),
      typeFlag: typeFlag(a, lineOf(a)), notChecked: typeNotChecked(a),
      tax: taxOf(a), taxDefault: eff ? byNo.get(eff)?.default_tax_code ?? "" : "", taxOverride: !!a.tax_code,
      // An account with no balance either year and no entries needs no decision (round 3 item 12).
      unused: a.account_key !== "chart:10900" && unusedOf(a),
      // Clearing (10900) has no GIFI line by design: it needs a decision only while it has a balance (round 4 item 3).
      attention: a.account_key === "chart:10900" ? Math.round(fin * 100) !== 0
        : !unusedOf(a) && (!a.line_no || a.needs_reviewer || lockedSet.has(a.line_no) || (isMismatch(a) && !confirmed(a))),
      buildUp: a.account_key === "opening" && p.causes?.length ? p.causes.map((c) => ({ text: c.text, amount: amt(c.cents / 100) })) : undefined,
    };
  });
  // By GIFI line: one row per line (after opposite balances move), with its accounts and the wrong-sign flag.
  const groupMap = new Map<string, { ids: string[]; total: number }>();
  for (const r of rows) {
    const eff = r.lineLabel ? r.lineLabel.split(" ")[0] : "";
    if (!eff) continue;
    const g = groupMap.get(eff) ?? { ids: [], total: 0 };
    g.ids.push(r.id); g.total += r.finalNum; groupMap.set(eff, g);
  }
  const groups: Group[] = [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([no, g]) => ({
    lineNo: no, label: byNo.get(no)?.name ?? "", count: g.ids.length, total: amt(g.total), warn: wrongSign(byNo.get(no), g.total), ids: g.ids,
  }));
  const warnCount = groups.filter((g) => g.warn).length;

  return (
    <>
      {(!p.pills || p.pills.length > 1) && <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {shown("accounts") && pill("accounts", "By account")}
        {shown("lines") && pill("lines", `By GIFI line${warnCount ? ` (${warnCount} to check)` : ""}`)}
        {shown("lead") && pill("lead", "Lead sheets")}
        {shown("gifi") && pill("gifi", "GIFI")}
      </div>}

      {p.showImport !== false && (
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {thisImport ? <>Imported from {SOURCES[thisImport.source] ?? thisImport.source}, {formatDateTime(thisImport.imported_at)}{file.file_type === "monthly" ? " · read-only" : ""}</> : "No trial balance yet."}
            {accounts.length > 0 && (balanced
              ? <span className="ml-2 rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Balanced</span>
              : <span className="ml-2 rounded bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Out by {amt(total)}</span>)}
          </p>
          {editable && !locked && (
            <form action={importTrialBalance} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="file_id" value={file.id} />
              <div><label htmlFor="upload" className="label">Trial balance (CSV or Excel)</label><input id="upload" name="upload" type="file" accept=".csv,.xlsx" required className={fileInputClass} /></div>
              <div><label htmlFor="target" className="label">Column</label>
                <select id="target" name="target" className="input"><option value="this_year">This year</option><option value="last_year">Last year (opening balances)</option></select></div>
              <div><label htmlFor="source" className="label">From</label>
                <select id="source" name="source" defaultValue={file.file_type === "monthly" ? "quickbooks" : file.books === "bookkeeper" ? "bookkeeper" : "client_software"} className="input">
                  {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.replace(/^the /, "The ")}</option>)}
                </select></div>
              <button type="submit" className="btn-secondary">{thisImport ? "Import again" : "Import"}</button>
            </form>
          )}
          {/* Round 6 item 2: optional, for the client's own account types (QuickBooks Online: Reports, Account List, Export to Excel). */}
          {tbFile && thisImport && (
            <div id="account-list" className="flex w-full flex-wrap items-end justify-between gap-3 border-t border-sand-200 pt-3">
              <p className="text-sm">{listImport ? <>Account types from {listImport.file_name || "the Account List"}, {formatDateTime(listImport.imported_at)}</> : <>Account types: <span className="text-ink-2">optional. Upload the QuickBooks Online Account List (Reports, Account List, Export to Excel).</span></>}</p>
              {editable && !locked && (
                <form action={importAccountList} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="file_id" value={file.id} />
                  <input type="hidden" name="back" value={base} />
                  <div><label htmlFor="list_upload" className="label">Account List (CSV or Excel)</label><input id="list_upload" name="upload" type="file" accept=".csv,.xlsx" required className={fileInputClass} /></div>
                  <button type="submit" className="btn-secondary">{listImport ? "Upload again" : "Upload"}</button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
      {noBooksType > 0 && (
        <p className="mb-4 rounded-lg border border-sand-200 bg-sand-50 px-4 py-2.5 text-sm">
          Account types not checked for {noBooksType} account{noBooksType === 1 ? "" : "s"}: <a href={`/closebook/${file.id}?step=records#account-list`} className="text-navy-700 underline">upload the QuickBooks Account List</a>.
        </p>
      )}

      {accounts.length === 0 ? <p className="card text-sm text-ink-2">Import the trial balance to see the accounts. {file.file_type === "monthly" ? "Monthly files: export QuickBooks' Trial Balance report after the year-end entries are booked." : "Bank-statement files: upload the statements in step 2."}</p>
        : view === "gifi" && p.gifi ? <GifiView fileId={file.id} g={p.gifi} />
        : view === "lead" ? (
          unmatched.length + waiting.length > 0 ? <p className="card text-sm text-ink-2">Lead sheets open when every account is matched to a GIFI line. {unmatched.length + waiting.length} left.</p> : (
            <LeadSheetsView fileId={file.id} full={file.file_type === "full"} editable={editable && !locked}
              groups={leadSheets(accounts, entryTotals, byNo, sheets, flag).map((g): LeadGroup => {
                const rows: LeadAcc[] = g.rows.map((r) => ({
                  id: r.id, number: r.number, name: r.name, line: lineLabel(r.line), last: amt(r.last), before: amt(r.before), entries: r.entries ? amt(r.entries) : "",
                  final: amt(r.final), change: amt(r.change), pct: pctChange(Math.round(r.final * 100), Math.round(r.last * 100)), flagged: r.flagged, note: p.notes.get(r.id),
                }));
                return { code: g.code, name: g.name, last: amt(g.last), before: amt(g.before), entries: amt(g.entries), final: amt(g.final), change: amt(g.final - g.last),
                  flags: rows.filter((r) => r.flagged).length, open: rows.filter((r) => r.flagged && !r.note).length, rows };
              })} />
          )
        ) : (
          <MatchWorkspace matchNow={editable && !locked && unmatched.some((a) => !unusedOf(a))} fileId={file.id} view={view} base={base} rows={rows} groups={groups} options={options} taxes={taxes} isReviewer={isReviewer}
            editable={editable && !locked} totals={(() => {
              // Last year's net income is not an account: when last year's income statement was not entered,
              // it shows as its own line so the last-year column adds to zero, as on the balance sheet.
              const lastSum = accounts.reduce((n, a) => n + a.last_year, 0);
              return Math.round(lastSum * 100) ? { last: "–", current: amt(total), niLast: amt(-lastSum) } : { last: amt(lastSum), current: amt(total) };
            })()} edit={p.edit} />
        )}
      <p className="mt-2 text-xs text-muted">Debits show as positive, credits in brackets. An account whose balance flips sign moves to its paired line automatically. Only the reviewer changes a tax code.</p>
    </>
  );
}
