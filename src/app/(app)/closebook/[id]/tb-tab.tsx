import Link from "next/link";
import { fileInputClass } from "@/components/ds/primitives";
import { formatDateTime } from "@/lib/dates";
import { effectiveLine, leadSheets, typeMismatch, wrongSign, type Line } from "@/lib/closebook/matching";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry, CbImport } from "@/lib/closebook/server";
import { importTrialBalance, runMatching } from "../actions";
import { MatchWorkspace, type Group, type Row } from "./accounts-table";
import { LeadSheetsView, type LeadAcc, type LeadGroup } from "./lead-sheets";

const SOURCES: Record<string, string> = { quickbooks: "QuickBooks", client_software: "the client's software", bookkeeper: "the bookkeeper", prior_accountant: "the prior accountant" };
export const amt = (v: number) => (Math.round(v) === 0 ? "0" : v < 0 ? `(${Math.round(-v).toLocaleString("en-CA")})` : Math.round(v).toLocaleString("en-CA"));
const SOURCE_LABEL: Record<string, string> = { history: "From last year", suggested: "Suggested", preparer: "Preparer", reviewer: "Reviewer" };

type Props = {
  file: CbFileRow; accounts: CbAccount[]; imports: CbImport[]; entries: CbEntry[]; editable: boolean; isReviewer: boolean;
  lines: Line[]; sheets: { code: string; name: string }[]; taxes: { code: string; name: string }[]; flag: { amount: number; percent: number };
  view: string; craText: Map<string, string>; notes: Map<string, { reason: string; note: string }>;
};

// Trial balance tab (Phase 3 batch, section 2 and 4.5; mockup FileTrialBalance): Accounts with their
// GIFI line and tax code, the reviewer's list, and Lead sheets. Transactions arrive with part 2b.
export function TbTab(p: Props) {
  const { file, accounts, imports, entries, editable, isReviewer, lines, sheets, taxes, flag, view } = p;
  const base = `/closebook/${file.id}?tab=tb`;
  const byNo = new Map(lines.map((l) => [l.line_no, l]));
  const entryTotals = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
  const finalOf = (a: CbAccount) => a.this_year + (entryTotals.get(a.id) ?? 0);
  const thisImport = imports.find((i) => i.target === "this_year");
  const total = accounts.reduce((n, a) => n + a.this_year, 0);
  const balanced = accounts.length > 0 && Math.round(total * 100) === 0;
  const unmatched = accounts.filter((a) => !a.line_no && !a.needs_reviewer);
  const waiting = accounts.filter((a) => a.needs_reviewer);
  const locked = file.phase === "locked";
  const pill = (k: string, label: string, off?: boolean) => (
    <Link href={`${base}&view=${k}`} className={`rounded-full px-3 py-1 ${view === k ? "bg-navy-700 font-medium text-white" : off ? "border border-sand-200 text-ink-3" : "border border-sand-200 text-ink-2 hover:border-navy-300"}`}>{label}</Link>
  );
  const lineLabel = (no: string | null) => (no ? `${no} ${byNo.get(no)?.name ?? ""}` : "");
  const taxOf = (a: CbAccount) => a.tax_code ?? (a.line_no ? byNo.get(effectiveLine(a.line_no, finalOf(a), byNo) ?? a.line_no)?.default_tax_code ?? "" : "");
  const typeWord: Record<string, string> = { "1": "an asset", "2": "a liability", "3": "equity", "4": "revenue" };
  // A type mismatch needs a look, unless the reviewer matched the account: their match confirms it.
  const isMismatch = (a: CbAccount) => typeMismatch(a.number, a.line_no ? byNo.get(a.line_no) : undefined);
  const confirmed = (a: CbAccount) => a.mapping_source === "reviewer";
  const mismatchText = (a: CbAccount) => (!isMismatch(a) ? "" : confirmed(a)
    ? `The account number says ${typeWord[a.number[0]] ?? "an expense"}; reviewer confirmed`
    : `Check: the account number says ${typeWord[a.number[0]] ?? "an expense"}`);
  const options = lines.filter((l) => l.mappable).map((l) => ({ no: l.line_no, label: `${l.line_no} ${l.name}`, section: l.section ?? "", hint: p.craText.get(l.gifi_code) ?? "" }));
  const rows: Row[] = accounts.map((a) => {
    const fin = finalOf(a);
    const eff = effectiveLine(a.line_no, fin, byNo);
    return {
      id: a.id, number: a.number, name: a.name, last: amt(a.last_year), current: amt(a.this_year), final: amt(fin), finalNum: fin,
      change: a.last_year === 0 ? (a.this_year === 0 ? "" : "new") : `${Math.round(((a.this_year - a.last_year) / Math.abs(a.last_year)) * 100)}%`,
      lineNo: a.line_no ?? "", lineLabel: eff ? `${eff} ${byNo.get(eff)?.name ?? ""}` : "", movedFrom: eff && eff !== a.line_no ? a.line_no ?? "" : "",
      source: SOURCE_LABEL[a.mapping_source ?? ""] ?? "", needsReviewer: a.needs_reviewer, reason: a.reviewer_reason, mismatch: mismatchText(a),
      tax: taxOf(a), taxDefault: eff ? byNo.get(eff)?.default_tax_code ?? "" : "", taxOverride: !!a.tax_code,
      attention: !a.line_no || a.needs_reviewer || (isMismatch(a) && !confirmed(a)),
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
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {pill("accounts", "Accounts")}
        {pill("lines", `By GIFI line${warnCount ? ` (${warnCount} to check)` : ""}`)}
        {pill("lead", "Lead sheets")}
        {file.file_type === "full" && <span className="rounded-full border border-sand-200 px-3 py-1 text-ink-3" title="Arrives with bank and card imports (part 2b)">Transactions</span>}
      </div>

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
      </div>

      {editable && !locked && unmatched.length > 0 && (
        <form action={runMatching} className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <input type="hidden" name="file_id" value={file.id} />
          <p>{unmatched.length} account{unmatched.length === 1 ? " was" : "s were"} imported before matching ran by itself.</p>
          <button type="submit" className="btn">Match them now</button>
        </form>
      )}
      {accounts.length === 0 ? <p className="card text-sm text-ink-2">Import the trial balance to see the accounts. {file.file_type === "monthly" ? "Monthly files: export QuickBooks' Trial Balance report after the year-end entries are booked." : "Bank-statement files build the trial balance from the Transactions view (part 2b)."}</p>
        : view === "lead" ? (
          unmatched.length + waiting.length > 0 ? <p className="card text-sm text-ink-2">Lead sheets open when every account is matched to a GIFI line. {unmatched.length + waiting.length} left.</p> : (
            <LeadSheetsView fileId={file.id} full={file.file_type === "full"} editable={editable && !locked}
              groups={leadSheets(accounts, entryTotals, byNo, sheets, flag).map((g): LeadGroup => {
                const rows: LeadAcc[] = g.rows.map((r) => ({
                  id: r.id, number: r.number, name: r.name, line: lineLabel(r.line), last: amt(r.last), before: amt(r.before), entries: r.entries ? amt(r.entries) : "",
                  final: amt(r.final), change: amt(r.change), pct: r.pct === null ? (r.final ? "new" : "") : `${Math.round(r.pct)}%`, flagged: r.flagged, note: p.notes.get(r.id),
                }));
                return { code: g.code, name: g.name, last: amt(g.last), before: amt(g.before), entries: amt(g.entries), final: amt(g.final), change: amt(g.final - g.last),
                  flags: rows.filter((r) => r.flagged).length, open: rows.filter((r) => r.flagged && !r.note).length, rows };
              })} />
          )
        ) : (
          <MatchWorkspace fileId={file.id} view={view} base={base} rows={rows} groups={groups} options={options} taxes={taxes} isReviewer={isReviewer}
            editable={editable && !locked} totals={{ last: amt(accounts.reduce((n, a) => n + a.last_year, 0)), current: amt(total) }} />
        )}
      <p className="mt-2 text-xs text-muted">Debits show as positive, credits in brackets. An account whose balance flips sign moves to its paired line automatically. Only the reviewer changes a tax code. The trial balance sign-off arrives with build step 3.</p>
    </>
  );
}
