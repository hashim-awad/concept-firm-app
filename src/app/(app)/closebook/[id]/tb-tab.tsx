import Link from "next/link";
import { fileInputClass } from "@/components/ds/primitives";
import { formatDateTime } from "@/lib/dates";
import { effectiveLine, leadSheets, typeMismatch, type Line } from "@/lib/closebook/matching";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry, CbImport } from "@/lib/closebook/server";
import { importTrialBalance, mapAccount, runMatching, sendToReviewer, setTaxCode } from "../actions";

const SOURCES: Record<string, string> = { quickbooks: "QuickBooks", client_software: "the client's software", bookkeeper: "the bookkeeper", prior_accountant: "the prior accountant" };
export const amt = (v: number) => (Math.round(v) === 0 ? "0" : v < 0 ? `(${Math.round(-v).toLocaleString("en-CA")})` : Math.round(v).toLocaleString("en-CA"));
const SOURCE_LABEL: Record<string, string> = { history: "From last year", suggested: "Suggested", preparer: "Preparer", reviewer: "Reviewer" };

type Props = {
  file: CbFileRow; accounts: CbAccount[]; imports: CbImport[]; entries: CbEntry[]; editable: boolean; isReviewer: boolean;
  lines: Line[]; sheets: { code: string; name: string }[]; taxes: { code: string; name: string }[]; flag: { amount: number; percent: number };
  view: string; acc?: string; q?: string;
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
  const chosen = p.acc ? accounts.find((a) => a.id === p.acc) : undefined;
  const needle = (p.q ?? "").toLowerCase();
  const options = chosen ? lines.filter((l) => l.mappable && (!needle || `${l.line_no} ${l.name} ${l.statement_line ?? ""}`.toLowerCase().includes(needle))).slice(0, 40) : [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {pill("accounts", "Accounts")}
        {pill("reviewer", `Needs reviewer decision${waiting.length ? ` (${waiting.length})` : ""}`)}
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

      {accounts.length > 0 && (unmatched.length > 0 || waiting.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <p>{unmatched.length > 0 && <>{unmatched.length} account{unmatched.length === 1 ? "" : "s"} not matched to a GIFI line. </>}{waiting.length > 0 && <>{waiting.length} wait{waiting.length === 1 ? "s" : ""} for the reviewer&rsquo;s decision. </>}Lead sheets open when every account is matched.</p>
          {editable && !locked && unmatched.length > 0 && (
            <form action={runMatching}><input type="hidden" name="file_id" value={file.id} /><button type="submit" className="btn">Match accounts to GIFI</button></form>
          )}
        </div>
      )}

      {chosen && (
        <section className="card mb-4 grid gap-3" id="match">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{chosen.number && <span className="mr-2 text-ink-3">{chosen.number}</span>}{chosen.name}</h2>
            <Link href={base} className="text-sm text-navy-700 underline">Close</Link>
          </div>
          <p className="text-sm text-ink-2">Now: {chosen.line_no ? lineLabel(chosen.line_no) : chosen.needs_reviewer ? `waiting for the reviewer (${chosen.reviewer_reason})` : "not matched"}. This year {amt(finalOf(chosen))}.</p>
          {(!chosen.needs_reviewer || isReviewer) && editable && !locked && (
            <>
              <form action={`/closebook/${file.id}`} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="tab" value="tb" /><input type="hidden" name="acc" value={chosen.id} />
                <div className="min-w-64 flex-1"><label htmlFor="q" className="label">Find a GIFI line</label><input id="q" name="q" defaultValue={p.q} placeholder="Line number or words, for example 8810 or office" className="input" /></div>
                <button type="submit" className="btn-secondary">Search</button>
              </form>
              <ul className="grid max-h-80 gap-1 overflow-y-auto">
                {options.map((l) => (
                  <li key={l.line_no}>
                    <form action={mapAccount} className="flex items-center justify-between gap-3 rounded-md border border-sand-200 px-3 py-2 text-sm">
                      <input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="account" value={chosen.id} /><input type="hidden" name="line" value={l.line_no} />
                      <span><b className="tabular-nums">{l.line_no}</b> {l.name}<span className="ml-2 text-xs text-muted">{l.lead_sheet} · {l.statement_line} · {l.default_tax_code}</span></span>
                      <button type="submit" className="btn-secondary h-8 px-3 text-sm">Use this line</button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
          {chosen.needs_reviewer && !isReviewer && <p className="text-sm">This account is on the reviewer&rsquo;s list. The reviewer decides it once, for this client&rsquo;s future years too.</p>}
          {editable && !locked && !chosen.needs_reviewer && !isReviewer && (
            <form action={sendToReviewer} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="account" value={chosen.id} />
              <div className="min-w-64 flex-1"><label htmlFor="why" className="label">Not sure? Send it to the reviewer</label><input id="why" name="reason" placeholder="What is unclear" className="input" /></div>
              <button type="submit" className="btn-secondary">Send to the reviewer</button>
            </form>
          )}
          {isReviewer && chosen.line_no && !locked && (
            <form action={setTaxCode} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="account" value={chosen.id} />
              <div><label htmlFor="tax_code" className="label">Tax code (reviewer only)</label>
                <select id="tax_code" name="tax_code" defaultValue={chosen.tax_code ?? ""} className="input">
                  <option value="">The line&rsquo;s default ({byNo.get(chosen.line_no)?.default_tax_code})</option>
                  {taxes.map((t) => <option key={t.code} value={t.code}>{t.code}: {t.name}</option>)}
                </select></div>
              <button type="submit" className="btn-secondary">Save tax code</button>
            </form>
          )}
        </section>
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
        ) : (
          <section className="card overflow-x-auto p-0">
            <table className="table min-w-[980px]">
              <thead><tr><th>Account</th><th>GIFI line</th><th>Tax code</th><th className="text-right">Last year</th><th className="text-right">This year</th><th className="text-right">Change</th><th></th></tr></thead>
              <tbody>
                {(view === "reviewer" ? waiting : accounts).map((a) => {
                  const fin = finalOf(a);
                  const eff = effectiveLine(a.line_no, fin, byNo);
                  const mismatch = typeMismatch(a.number, a.line_no ? byNo.get(a.line_no) : undefined);
                  return (
                    <tr key={a.id}>
                      <td>{a.number && <span className="mr-2 text-ink-3 tabular-nums">{a.number}</span>}{a.name}</td>
                      <td>
                        {a.line_no ? <>{lineLabel(eff)}{eff !== a.line_no && <span className="block text-xs text-muted">Opposite balance: moved from {a.line_no}</span>}<span className="block text-xs text-muted">{SOURCE_LABEL[a.mapping_source ?? ""] ?? ""}</span></>
                          : a.needs_reviewer ? <span className="text-danger">Sent to reviewer<span className="block text-xs text-muted">{a.reviewer_reason}</span></span>
                          : <span className="text-ink-3">Not matched yet</span>}
                        {mismatch && <span className="mt-0.5 block text-xs font-semibold text-warning">Type mismatch: the account number says {a.number[0] === "1" ? "asset" : a.number[0] === "2" ? "liability" : a.number[0] === "3" ? "equity" : a.number[0] === "4" ? "revenue" : "expense"}</span>}
                      </td>
                      <td>{taxOf(a)}{a.tax_code && <span className="block text-xs text-muted">Reviewer&rsquo;s choice</span>}</td>
                      <td className="text-right tabular-nums">{amt(a.last_year)}</td>
                      <td className="text-right tabular-nums">{amt(a.this_year)}</td>
                      <td className="text-right tabular-nums">{a.last_year === 0 ? (a.this_year === 0 ? "" : "new") : `${Math.round(((a.this_year - a.last_year) / Math.abs(a.last_year)) * 100)}%`}</td>
                      <td>{editable && !locked && <Link href={`${base}&acc=${a.id}#match`} className="text-sm text-navy-700 hover:underline">{a.line_no ? "Change" : "Match"}</Link>}</td>
                    </tr>
                  );
                })}
                {view !== "reviewer" && <tr className="font-semibold"><td>Total (must be 0)</td><td></td><td></td><td className="text-right tabular-nums">{amt(accounts.reduce((n, a) => n + a.last_year, 0))}</td><td className="text-right tabular-nums">{amt(total)}</td><td></td><td></td></tr>}
              </tbody>
            </table>
          </section>
        )}
      <p className="mt-2 text-xs text-muted">Debits show as positive, credits in brackets. An account whose balance flips sign moves to its paired line automatically. Only the reviewer changes a tax code. The trial balance sign-off arrives with build step 3.</p>
    </>
  );
}
