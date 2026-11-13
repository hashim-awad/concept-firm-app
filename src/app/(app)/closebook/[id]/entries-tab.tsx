import { formatDate } from "@/lib/dates";
import type { Line } from "@/lib/closebook/matching";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import { addEntry, deleteEntry, reviewEntry } from "../actions";
import { amt } from "./tb-tab";

const REASONS: Record<string, string> = { accrual: "Accrual", reclassification: "Reclassification", correction: "Correction", tax: "Tax" };
const KIND: Record<string, string> = { AJE: "Adjusting (AJE): changes the result", RJE: "Reclassifying (RJE): no effect on the result", TJE: "Tax (TJE): from ProFile" };

// Entries tab (Phase 3 batch 5.4; mockup FileEntries). Full files only; monthly files make entries in
// QuickBooks. Free entries go to the reviewer; standard entries arrive with Settings, Closebook.
export function EntriesTab({ file, entries, accounts, lines, editable, isReviewer, names }: {
  file: CbFileRow; entries: CbEntry[]; accounts: CbAccount[]; lines: Line[]; editable: boolean; isReviewer: boolean; names: Map<string, string>;
}) {
  if (file.file_type === "monthly") return <p className="card text-sm text-ink-2">Entries are made in QuickBooks. This tab stays read-only for monthly files; import the trial balance again after the entries are booked.</p>;
  const accName = new Map(accounts.map((a) => [a.id, `${a.number ? `${a.number} ` : ""}${a.name}`]));
  const matched = accounts.filter((a) => a.line_no);
  const locked = file.phase === "locked";
  const totalOf = (e: CbEntry) => e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0);
  return (
    <>
      <section className="card mb-4 overflow-x-auto p-0">
        <h2 className="px-5 pt-4 pb-2 font-semibold">Entries ({entries.length})</h2>
        {entries.length === 0 ? <p className="px-5 pb-4 text-sm text-ink-2">No entries yet.</p> : (
          <table className="table min-w-[900px]">
            <thead><tr><th>Entry</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Status</th></tr></thead>
            <tbody>{entries.map((e) => (
              e.lines.map((l, i) => (
                <tr key={`${e.id}-${i}`} id={i === 0 ? `entry-${e.id}` : undefined} className={`${i === 0 ? "border-t-2 border-sand-200" : ""} target:bg-navy-50`}>
                  <td>{i === 0 && <><b>{e.kind}-{e.number}</b> {REASONS[e.reason]}<span className="block text-xs text-muted">{e.note}{e.reverse_next_year ? " · reverses next year" : ""} · {names.get(e.created_by ?? "")?.split(" ")[0]}, {formatDate(e.created_at)}</span></>}</td>
                  <td>{accName.get(l.account_id)}{l.memo && <span className="block text-xs text-muted">{l.memo}</span>}</td>
                  <td className="text-right tabular-nums">{l.amount > 0 ? amt(l.amount) : ""}</td>
                  <td className="text-right tabular-nums">{l.amount < 0 ? amt(-l.amount) : ""}</td>
                  <td>{i === 0 && (e.reviewed_at
                    ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Approved</span>
                    : <span className="flex flex-wrap items-center gap-2"><span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">For the reviewer{totalOf(e) > 0 ? ` (${amt(totalOf(e))})` : ""}</span>
                      {isReviewer && !locked && <form action={reviewEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button className="btn-secondary h-7 px-2 text-xs" type="submit">Approve</button></form>}
                      {editable && !locked && <form action={deleteEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button className="h-7 px-2 text-xs text-danger underline" type="submit">Delete</button></form>}</span>)}</td>
                </tr>
              ))
            ))}</tbody>
          </table>
        )}
      </section>

      {editable && !locked && (
        <form action={addEntry} className="card grid gap-4">
          <h2 className="font-semibold">New entry</h2>
          <input type="hidden" name="file_id" value={file.id} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label htmlFor="kind" className="label">Type</label><select id="kind" name="kind" className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label htmlFor="reason" className="label">Reason</label><select id="reason" name="reason" className="input">{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="reverse" className="h-4 w-4 accent-navy-700" />Accrual: reverse it next year</label>
          </div>
          <div><label htmlFor="note" className="label">Note *</label><input id="note" name="note" required minLength={3} maxLength={500} placeholder="What the entry does and why" className="input" /></div>
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead><tr><th>Account or GIFI line</th><th className="w-32">Debit</th><th className="w-32">Credit</th><th>Memo</th></tr></thead>
              <tbody>{Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  <td><select name={`t${i}`} aria-label={`Line ${i + 1} account`} defaultValue="" className="input">
                    <option value="">{i < 2 ? "Choose" : "Not used"}</option>
                    <optgroup label="This file's accounts">{matched.map((a) => <option key={a.id} value={a.id}>{accName.get(a.id)}</option>)}</optgroup>
                    <optgroup label="A GIFI line (adds an account)">{lines.filter((l) => l.mappable).map((l) => <option key={l.line_no} value={`line:${l.line_no}`}>{l.line_no} {l.name}</option>)}</optgroup>
                  </select></td>
                  <td><input name={`dr${i}`} inputMode="decimal" aria-label={`Line ${i + 1} debit`} className="input text-right tabular-nums" /></td>
                  <td><input name={`cr${i}`} inputMode="decimal" aria-label={`Line ${i + 1} credit`} className="input text-right tabular-nums" /></td>
                  <td><input name={`m${i}`} aria-label={`Line ${i + 1} memo`} maxLength={200} className="input" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Debits must equal credits. Entries never post to a total line. A reclassifying entry cannot change the result. Every entry made here goes to the reviewer.</p>
          <button type="submit" className="btn w-fit">Add the entry</button>
        </form>
      )}
    </>
  );
}
