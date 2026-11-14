import { formatDate } from "@/lib/dates";
import type { Line } from "@/lib/closebook/matching";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import { deleteEntry, reviewEntry } from "../actions";
import { NoteOnItem } from "./note-on-item";
import { amt } from "./tb-tab";
import { entryNo } from "@/lib/closebook/reports";
import { JournalForm } from "./journal-form";
import type { EntryFormData } from "@/lib/closebook/entry-form-server";

// QuickBooks Online account types, for a new account in the client's books.
export const QBO_TYPES = ["Bank", "Accounts receivable (A/R)", "Other Current Assets", "Fixed Assets", "Other Assets", "Accounts payable (A/P)", "Credit Card",
  "Other Current Liabilities", "Long Term Liabilities", "Equity", "Income", "Other Income", "Cost of Goods Sold", "Expenses", "Other Expense"];

const REASONS: Record<string, string> = { accrual: "Accrual", reclassification: "Reclassification", correction: "Correction", tax: "Tax", prior_period: "Prior period adjustment" };

// Entries tab (Phase 3 batch 5.4; mockup FileEntries). Full files only; monthly files make entries in
// QuickBooks. Free entries go to the reviewer; standard entries arrive with Settings, Closebook.
export function EntriesTab({ file, entries, accounts, editable, isReviewer, names, clientList = false, chartOnLine = {}, form, noteBy, prefill }: {
  file: CbFileRow; entries: CbEntry[]; accounts: CbAccount[]; lines?: Line[]; editable: boolean; isReviewer: boolean; names: Map<string, string>; clientList?: boolean; chartOnLine?: Record<string, { number: string; name: string }>; form: EntryFormData;
  noteBy?: { back: string };   // round 8: the reviewer adds a review note on an entry
  prefill?: string;            // round 15: the account "+" on the trial balance opened the form with
}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (file.file_type === "monthly") return <p className="text-[12.5px] text-ink-3">Monthly file: entries are made in QuickBooks.</p>;
  const locked = file.phase === "locked";
  const totalOf = (e: CbEntry) => e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0);
  // Round 15 (CaseWare Cloud's Adjustments): one row per entry, opening to its lines and its actions.
  const statusOf = (e: CbEntry) => (e.reviewed_at ? ["Approved", "bg-success-soft text-success"] : e.needs_review ? ["For the reviewer", "bg-warning-soft text-warning"] : ["Posted", "bg-sand-100 text-ink-2"]);
  const cols = "grid-cols-[22px_92px_40px_104px_minmax(0,1fr)_minmax(0,170px)_104px_128px]";
  return (
    <>
      <section className="mb-3.5 rounded-[10px] border border-sand-200 bg-white" aria-label="Entries">
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3.5 py-2.5">
          <h3 className="text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase">Entries</h3><span className="text-[12.5px] text-ink-3">{entries.length}</span>
          <span className="flex-1" />
          {clientList && entries.length > 0 && <a href={`/closebook/${file.id}/client-entries`} className="btn-secondary btn-compact">Client entry list (PDF)</a>}
          {editable && !locked && <a href="#new-entry" className="btn btn-compact">+ New entry</a>}
        </div>
        {entries.length === 0 ? <p className="px-3.5 py-2.5 text-[12.5px] text-ink-3">No entries yet.</p> : (<>
          <div className={`grid ${cols} gap-x-2 border-b border-sand-200 bg-sand-50 px-3 py-1.5 text-[11px] font-semibold text-ink-3`}><span /><span>No.</span><span>Type</span><span>Date</span><span>Description</span><span>W/P ref</span><span className="text-right">Amount</span><span>Status</span></div>
          {entries.map((e) => {
            const total = totalOf(e);
            const [word, cls] = statusOf(e);
            return (
              <details key={e.id} id={`entry-${e.id}`} className="group border-b border-sand-100 last:border-0 target:bg-[#eef4ff] target:shadow-[inset_4px_0_0_#2f6fd6]">
                <summary className={`grid cursor-pointer list-none ${cols} items-center gap-x-2 px-3 py-[7px] text-[12.5px] hover:bg-sand-50 [&::-webkit-details-marker]:hidden`}>
                  <span aria-hidden className="text-navy-600 transition group-open:rotate-90">›</span>
                  <span className="tabular-nums">{entryNo(file.year_end, e).split(" ")[0]}</span><span className="text-ink-3">{e.kind}</span>
                  <span className="whitespace-nowrap">{formatDate(e.entry_date ?? file.year_end)}</span>
                  <span className="truncate" title={e.note}>{e.note}</span><span className="truncate text-ink-3">{e.wp_ref || "–"}</span>
                  <span className="text-right tabular-nums">{amt(total)}</span><span><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{word}</span></span>
                </summary>
                <div className="px-3 pb-2.5 pl-[34px]">
                  <table className="w-full max-w-5xl text-[12.5px]">
                    <thead><tr className="text-left text-[11px] text-ink-3"><th className="py-1 font-semibold">Account</th><th className="py-1 font-semibold">Name</th><th className="py-1 text-right font-semibold">Debit</th><th className="py-1 text-right font-semibold">Credit</th></tr></thead>
                    <tbody>{e.lines.map((l, i) => {
                      const raw = byId.get(l.account_id);
                      const c = raw?.account_key.startsWith("line:") && raw.line_no ? chartOnLine[raw.line_no] : undefined;
                      const a = c ? { number: c.number, name: c.name, line_no: raw!.line_no } : raw;
                      return (
                        <tr key={i} className={`border-t border-sand-100 ${l.is_tax ? "text-ink-3" : ""}`}><td className="py-1 tabular-nums">{a?.number}</td>
                          <td className="py-1">{a?.name}{raw?.client_new ? <span className="ml-1 text-[11px] text-ink-3">(new account in the client&rsquo;s books)</span>
                            : a && !a.number && a.line_no && <span className="ml-1 text-[11px] text-ink-3">(GIFI {a.line_no.replace(/\.00$/, "")})</span>}{l.tax_code && !l.is_tax && <span className="ml-1 text-[11px] text-ink-3">+ {l.tax_code.replace(/_/g, " ")}</span>}{l.memo && <span className="ml-2 text-[11px] text-ink-3">{l.memo}</span>}</td>
                          <td className="py-1 text-right tabular-nums">{l.amount > 0 ? amt(l.amount) : ""}</td><td className="py-1 text-right tabular-nums">{l.amount < 0 ? amt(-l.amount) : ""}</td></tr>
                      );
                    })}
                      <tr className="font-bold"><td /><td className="py-1">Total</td><td className="border-t border-ink py-1 text-right tabular-nums">{amt(total)}</td><td className="border-t border-ink py-1 text-right tabular-nums">{amt(total)}</td></tr></tbody>
                  </table>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-ink-3">
                    <span>{REASONS[e.reason]}{e.reverse_next_year ? " · reverses next year" : ""}{e.origin === "expenses_personal" ? " · Expenses paid personally" : e.origin === "revenue_check" ? " · From the revenue check" : ""}</span>
                    <span>{names.get(e.created_by ?? "")}, {formatDate(e.created_at)}</span>
                    {!!e.attachments?.length && <span>Attachments: {e.attachments.map((p) => p.split("/").pop()!.replace(/^\d+-/, "")).join(", ")}</span>}
                    <span className="flex-1" />
                    {noteBy && <NoteOnItem fileId={file.id} step="entries" targetType="entry" targetId={e.id} back={noteBy.back} />}
                    {!e.reviewed_at && e.needs_review && isReviewer && !locked && <form action={reviewEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button className="btn-secondary btn-compact" type="submit">Approve</button></form>}
                    {!e.reviewed_at && e.needs_review && editable && !locked && <form action={deleteEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button className="text-[11.5px] text-danger underline" type="submit">Delete</button></form>}
                  </div>
                </div>
              </details>
            );
          })}
        </>)}
      </section>

      {editable && !locked && (
        <div id="new-entry"><JournalForm prefill={prefill} fileId={file.id} nextNo={form.nextNo} yearStart={file.year_start} yearEnd={file.year_end} clientList={clientList} opts={form.opts} gifiLines={form.gifiLines}
          codes={form.codes} ctx={form.ctx} standard={form.standard} threshold={form.threshold} qboTypes={QBO_TYPES} /></div>
      )}
    </>
  );
}
