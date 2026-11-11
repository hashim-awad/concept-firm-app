import Link from "next/link";
import { fileInputClass } from "@/components/ds/primitives";
import { formatDateTime } from "@/lib/dates";
import { effectiveLine, leadSheets, typeMismatch, type Line } from "@/lib/closebook/matching";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry, CbImport } from "@/lib/closebook/server";
import { importTrialBalance, runMatching } from "../actions";
import { AccountsTable, type Row } from "./accounts-table";

const SOURCES: Record<string, string> = { quickbooks: "QuickBooks", client_software: "the client's software", bookkeeper: "the bookkeeper", prior_accountant: "the prior accountant" };
export const amt = (v: number) => (Math.round(v) === 0 ? "0" : v < 0 ? `(${Math.round(-v).toLocaleString("en-CA")})` : Math.round(v).toLocaleString("en-CA"));
const SOURCE_LABEL: Record<string, string> = { history: "From last year", suggested: "Suggested", preparer: "Preparer", reviewer: "Reviewer" };

type Props = {
  file: CbFileRow; accounts: CbAccount[]; imports: CbImport[]; entries: CbEntry[]; editable: boolean; isReviewer: boolean;
  lines: Line[]; sheets: { code: string; name: string }[]; taxes: { code: string; name: string }[]; flag: { amount: number; percent: number };
  view: string;
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
  const mismatchText = (a: CbAccount) => (typeMismatch(a.number, a.line_no ? byNo.get(a.line_no) : undefined) ? `Check: the account number says ${typeWord[a.number[0]] ?? "an expense"}` : "");
  const attention = accounts.filter((a) => !a.line_no || a.needs_reviewer || mismatchText(a));
  const shown = view === "attention" ? attention : accounts;
  const options = lines.filter((l) => l.mappable).map((l) => ({ no: l.line_no, label: `${l.line_no} ${l.name}` }));
  const rows: Row[] = shown.map((a) => {
    const fin = finalOf(a);
    const eff = effectiveLine(a.line_no, fin, byNo);
    return {
      id: a.id, number: a.number, name: a.name, last: amt(a.last_year), current: amt(a.this_year),
      change: a.last_year === 0 ? (a.this_year === 0 ? "" : "new") : `${Math.round(((a.this_year - a.last_year) / Math.abs(a.last_year)) * 100)}%`,
      lineLabel: eff ? `${eff} ${byNo.get(eff)?.name ?? ""}` : "", movedFrom: eff && eff !== a.line_no ? a.line_no ?? "" : "",
      source: SOURCE_LABEL[a.mapping_source ?? ""] ?? "", needsReviewer: a.needs_reviewer, reason: a.reviewer_reason, mismatch: mismatchText(a),
      tax: taxOf(a), taxOverride: !!a.tax_code, editable: editable && !locked, reviewerRow: a.needs_reviewer,
    };
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {pill("accounts", "Accounts")}
        {pill("attention", `Needs attention (${attention.length})`)}
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
            leadSheets(accounts, entryTotals, byNo, sheets, flag).map((s) => (
              <section key={s.code} className="card mb-4 overflow-x-auto p-0">
                <h2 className="px-5 pt-4 pb-2 font-semibold">{s.code} {s.name}</h2>
                <table className="table min-w-[900px]">
                  <thead><tr><th>Account</th><th className="text-right">Last year</th><th className="text-right">This year before entries</th>{file.file_type === "full" && <th className="text-right">Entries</th>}<th className="text-right">This year final</th><th className="text-right">Change $</th><th className="text-right">Change %</th></tr></thead>
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.id} className={r.flagged ? "bg-warning-soft/60" : ""}>
                        <td>{r.number && <span className="mr-2 text-ink-3">{r.number}</span>}{r.name}<span className="block text-xs text-muted">{lineLabel(r.line)}</span></td>
                        <td className="text-right tabular-nums">{amt(r.last)}</td><td className="text-right tabular-nums">{amt(r.before)}</td>
                        {file.file_type === "full" && <td className="text-right tabular-nums">{r.entries ? amt(r.entries) : ""}</td>}
                        <td className="text-right tabular-nums font-medium">{amt(r.final)}</td><td className="text-right tabular-nums">{amt(r.change)}</td>
                        <td className="text-right tabular-nums">{r.pct === null ? (r.final ? "new" : "") : `${Math.round(r.pct)}%`}{r.flagged && <span className="ml-2 rounded bg-warning-soft px-1.5 text-xs font-semibold text-warning">Flag</span>}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold"><td>Total</td><td className="text-right tabular-nums">{amt(s.last)}</td><td className="text-right tabular-nums">{amt(s.before)}</td>{file.file_type === "full" && <td className="text-right tabular-nums">{amt(s.entries)}</td>}<td className="text-right tabular-nums">{amt(s.final)}</td><td className="text-right tabular-nums">{amt(s.final - s.last)}</td><td></td></tr>
                  </tbody>
                </table>
              </section>
            ))
          )
        ) : shown.length === 0 ? <p className="card text-sm text-success">Nothing needs attention: every account is matched and checked.</p> : (
          <AccountsTable fileId={file.id} rows={rows} options={options} taxes={taxes} isReviewer={isReviewer}
            totals={{ last: amt(accounts.reduce((n, a) => n + a.last_year, 0)), current: amt(total) }} />
        )}
      <p className="mt-2 text-xs text-muted">Debits show as positive, credits in brackets. An account whose balance flips sign moves to its paired line automatically. Only the reviewer changes a tax code. The trial balance sign-off arrives with build step 3.</p>
    </>
  );
}
