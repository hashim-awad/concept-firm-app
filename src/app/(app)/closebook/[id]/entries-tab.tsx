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
export function EntriesTab({ file, entries, accounts, editable, isReviewer, names, clientList = false, chartOnLine = {}, form, noteBy }: {
  file: CbFileRow; entries: CbEntry[]; accounts: CbAccount[]; lines?: Line[]; editable: boolean; isReviewer: boolean; names: Map<string, string>; clientList?: boolean; chartOnLine?: Record<string, { number: string; name: string }>; form: EntryFormData;
  noteBy?: { back: string };   // round 8: the reviewer adds a review note on an entry
}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (file.file_type === "monthly") return <p className="card text-sm text-ink-2">Entries are made in QuickBooks. This tab stays read-only for monthly files; import the trial balance again after the entries are booked.</p>;
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
                      <tr key={i} className={l.is_tax ? "text-[#5B6475]" : ""}><td className="px-3 py-1 tabular-nums">{e.entry_date ?? file.year_end}</td><td className="px-3 py-1 tabular-nums">{a?.number}</td>
                        <td className="px-3 py-1">{a?.name}{raw?.client_new ? <span className="ml-1 text-xs text-muted">(new account in the client&rsquo;s books)</span>
                          : a && !a.number && a.line_no && <span className="ml-1 text-xs text-muted">(GIFI {a.line_no.replace(/\.00$/, "")})</span>}{l.tax_code && !l.is_tax && <span className="ml-1 text-xs text-muted">+ {l.tax_code.replace(/_/g, " ")}</span>}{l.memo && <span className="block text-xs text-muted">{l.memo}</span>}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{l.amount > 0 ? amt(l.amount) : ""}</td><td className="px-3 py-1 text-right tabular-nums">{l.amount < 0 ? amt(-l.amount) : ""}</td></tr>
                    );
                  })}
                  <tr className="font-bold"><td /><td /><td className="px-3 py-1">Total</td><td className="border-t border-ink px-3 py-1 text-right tabular-nums">{amt(total)}</td><td className="border-t border-ink px-3 py-1 text-right tabular-nums">{amt(total)}</td></tr>
                </tbody>
              </table>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1 pb-2">
                <span><i>Memo:</i> {e.note}<span className="ml-2 text-xs text-muted">{names.get(e.created_by ?? "")?.split(" ")[0]}, {formatDate(e.created_at)}</span>
                  {!!e.attachments?.length && <span className="block text-xs text-muted">Attachments: {e.attachments.map((p) => p.split("/").pop()!.replace(/^\d+-/, "")).join(", ")}</span>}</span>
                {noteBy && <NoteOnItem fileId={file.id} step="entries" targetType="entry" targetId={e.id} back={noteBy.back} />}
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
        <JournalForm fileId={file.id} nextNo={form.nextNo} yearStart={file.year_start} yearEnd={file.year_end} clientList={clientList} opts={form.opts} gifiLines={form.gifiLines}
          codes={form.codes} ctx={form.ctx} standard={form.standard} threshold={form.threshold} qboTypes={QBO_TYPES} />
      )}
    </>
  );
}
