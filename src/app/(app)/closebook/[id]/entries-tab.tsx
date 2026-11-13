import { formatDate } from "@/lib/dates";
import type { Line } from "@/lib/closebook/matching";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import { addEntry, deleteEntry, reviewEntry } from "../actions";
import { amt } from "./tb-tab";
import { entryNo } from "@/lib/closebook/reports";
import { EntryLines } from "./entry-lines";
import { StandardEntryPicker, type StdOption } from "./standard-entry-picker";

// QuickBooks Online account types, for a new account in the client's books.
export const QBO_TYPES = ["Bank", "Accounts receivable (A/R)", "Other Current Assets", "Fixed Assets", "Other Assets", "Accounts payable (A/P)", "Credit Card",
  "Other Current Liabilities", "Long Term Liabilities", "Equity", "Income", "Other Income", "Cost of Goods Sold", "Expenses", "Other Expense"];

const REASONS: Record<string, string> = { accrual: "Accrual", reclassification: "Reclassification", correction: "Correction", tax: "Tax", prior_period: "Prior period adjustment" };
// Working paper references staff pick from; any other step or schedule can be typed.
const WP_REFS = ["Opening balances", "Bank statements", "Code the transactions", "Capital assets schedule", "Revenue check", "Payables listing", "Receivables listing",
  "Prepaid expenses schedule", "Shareholder account", "GST/HST reconciliation", "Payroll reconciliation", "Income tax schedule", "Standard entry: accounting fee accrual", "Prior year file"];
const KIND: Record<string, string> = { AJE: "Adjusting (AJE): changes the result", RJE: "Reclassifying (RJE): no effect on the result", TJE: "Tax (TJE): from ProFile" };

// Entries tab (Phase 3 batch 5.4; mockup FileEntries). Full files only; monthly files make entries in
// QuickBooks. Free entries go to the reviewer; standard entries arrive with Settings, Closebook.
export function EntriesTab({ file, entries, accounts, lines, editable, isReviewer, names, clientList = false, chartOnLine = {}, standard = [], threshold = 0 }: {
  file: CbFileRow; entries: CbEntry[]; accounts: CbAccount[]; lines: Line[]; editable: boolean; isReviewer: boolean; names: Map<string, string>; clientList?: boolean; chartOnLine?: Record<string, { number: string; name: string }>; standard?: StdOption[]; threshold?: number;
}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (file.file_type === "monthly") return <p className="card text-sm text-ink-2">Entries are made in QuickBooks. This tab stays read-only for monthly files; import the trial balance again after the entries are booked.</p>;
  const accName = new Map(accounts.map((a) => [a.id, `${a.number ? `${a.number} ` : ""}${a.name}`]));
  const matched = accounts.filter((a) => a.line_no);
  const locked = file.phase === "locked";
  const totalOf = (e: CbEntry) => e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0);
  return (
    <>
      {clientList && entries.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sand-200 bg-surface px-4 py-3 text-sm">
          <span>This client keeps their own books. The client entry list shows the trial balance by group, the entries and the adjusted net income.</span>
          <a href={`/closebook/${file.id}/client-entries`} className="btn-secondary">Client entry list (PDF)</a>
        </p>
      )}
      {entries.length === 0 && <p className="card mb-4 text-sm text-ink-2">No entries yet.</p>}
      {/* Each entry as in the reference package: number and type, W/P ref, the lines, the total, the memo. */}
      <div className="mb-4 grid gap-3">
        {entries.map((e) => {
          const total = totalOf(e);
          return (
            <section key={e.id} id={`entry-${e.id}`} className="overflow-x-auto border border-[#C9CED8] bg-surface text-sm target:ring-2 target:ring-navy-700">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#EEF1F6] px-3 py-1.5">
                <span className="font-bold text-[#1A3C7C]">{entryNo(file.year_end, e).replace(" ", "\u2003")}<span className="ml-3 font-normal text-[#5B6475]">{REASONS[e.reason]}{e.reverse_next_year ? " · reverses next year" : ""}</span></span>
                <span className="text-[#5B6475]">W/P ref: {e.wp_ref || "–"}</span>
              </div>
              <table className="w-full min-w-[640px]">
                <thead><tr className="border-b border-[#C9CED8] text-left text-xs text-[#5B6475]"><th className="px-3 py-1 font-bold">Date</th><th className="px-3 py-1 font-bold">Account</th><th className="px-3 py-1 font-bold">Account name</th><th className="px-3 py-1 text-right font-bold">Debit</th><th className="px-3 py-1 text-right font-bold">Credit</th></tr></thead>
                <tbody>
                  {e.lines.map((l, i) => {
                    const raw = byId.get(l.account_id);
                    const c = raw?.account_key.startsWith("line:") && raw.line_no ? chartOnLine[raw.line_no] : undefined;
                    const a = c ? { number: c.number, name: c.name, line_no: raw!.line_no } : raw;
                    return (
                      <tr key={i}><td className="px-3 py-1 tabular-nums">{file.year_end}</td><td className="px-3 py-1 tabular-nums">{a?.number}</td>
                        <td className="px-3 py-1">{a?.name}{a && !a.number && a.line_no && <span className="ml-1 text-xs text-muted">(GIFI {a.line_no.replace(/\.00$/, "")})</span>}{l.memo && <span className="block text-xs text-muted">{l.memo}</span>}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{l.amount > 0 ? amt(l.amount) : ""}</td><td className="px-3 py-1 text-right tabular-nums">{l.amount < 0 ? amt(-l.amount) : ""}</td></tr>
                    );
                  })}
                  <tr className="font-bold"><td /><td /><td className="px-3 py-1">Total</td><td className="border-t border-ink px-3 py-1 text-right tabular-nums">{amt(total)}</td><td className="border-t border-ink px-3 py-1 text-right tabular-nums">{amt(total)}</td></tr>
                </tbody>
              </table>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1 pb-2">
                <span><i>Memo:</i> {e.note}<span className="ml-2 text-xs text-muted">{names.get(e.created_by ?? "")?.split(" ")[0]}, {formatDate(e.created_at)}</span></span>
                {e.reviewed_at
                  ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Approved</span>
                  : !e.needs_review ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Standard entry, under the review threshold</span>
                  : <span className="flex flex-wrap items-center gap-2"><span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">For the reviewer</span>
                    {isReviewer && !locked && <form action={reviewEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button className="btn-secondary h-7 px-2 text-xs" type="submit">Approve</button></form>}
                    {editable && !locked && <form action={deleteEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button className="h-7 px-2 text-xs text-danger underline" type="submit">Delete</button></form>}</span>}
              </div>
            </section>
          );
        })}
      </div>

      {editable && !locked && (
        <>{standard.length > 0 && <StandardEntryPicker fileId={file.id} options={standard} threshold={threshold} />}
        <form action={addEntry} className="card grid gap-4">
          <h2 className="font-semibold">New entry</h2>
          <input type="hidden" name="file_id" value={file.id} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label htmlFor="kind" className="label">Type</label><select id="kind" name="kind" className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label htmlFor="reason" className="label">Reason</label><select id="reason" name="reason" className="input">{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="reverse" className="h-4 w-4 accent-navy-700" />Accrual: reverse it next year</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="wp_ref" className="label">Working paper reference *</label><input id="wp_ref" name="wp_ref" required minLength={3} maxLength={120} list="wp-refs" placeholder="The step or schedule that supports it" className="input" />
              <datalist id="wp-refs">{WP_REFS.map((r) => <option key={r} value={r} />)}</datalist></div>
            <div><label htmlFor="note" className="label">Memo *</label><input id="note" name="note" required minLength={3} maxLength={500} placeholder="What the entry does and why" className="input" /></div>
          </div>
          <EntryLines accountHeading={clientList ? "Account in the client\u2019s books" : "Account or GIFI line"} groups={[
            { label: "This file's accounts", items: matched.map((a) => [a.id, accName.get(a.id) ?? ""]) },
            clientList ? { label: "A new account in the client's books", items: [["new:1", "New account 1 (named below)"], ["new:2", "New account 2 (named below)"]] }
              : { label: "A GIFI line (adds an account)", items: lines.filter((l) => l.mappable).map((l) => [`line:${l.line_no}`, `${l.line_no} ${l.name}`]) },
          ]}>
          {clientList && (
            <fieldset className="grid gap-2 rounded-lg border border-sand-200 p-3">
              <legend className="px-1 text-sm font-semibold">New accounts in the client&rsquo;s books</legend>
              <p className="text-xs text-ink-2">Only when none of the client&rsquo;s accounts fits. Name it in plain words, as the client will see it (for example &ldquo;Amortization expense&rdquo;). The GIFI line stays in our working papers.</p>
              {[1, 2].map((n) => (
                <div key={n} className="grid gap-2 sm:grid-cols-[2rem_1fr_14rem_1fr] sm:items-center">
                  <span className="text-sm text-ink-3">{n}</span>
                  <input name={`n${n}_name`} aria-label={`New account ${n} name`} maxLength={80} placeholder="Account name" className="input" />
                  <select name={`n${n}_type`} aria-label={`New account ${n} type`} defaultValue="" className="input"><option value="">QuickBooks account type</option>{QBO_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <select name={`n${n}_line`} aria-label={`New account ${n} GIFI line`} defaultValue="" className="input"><option value="">GIFI line (working papers)</option>{lines.filter((l) => l.mappable && !l.locked).map((l) => <option key={l.line_no} value={l.line_no}>{l.line_no} {l.name}</option>)}</select>
                </div>
              ))}
            </fieldset>
          )}
          <p className="text-xs text-muted">Debits must equal credits. Entries never post to a total line. A reclassifying entry cannot change the result. An entry that posts to retained earnings must use the reason &ldquo;Prior period adjustment&rdquo;: it posts to GIFI 3720. Every entry made here goes to the reviewer.</p>
          </EntryLines>
        </form></>
      )}
    </>
  );
}
