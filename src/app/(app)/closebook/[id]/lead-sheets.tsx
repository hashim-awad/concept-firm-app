"use client";
// Lead sheets (Phase 3 batch 5.5): one table, one row per lead sheet, opened to show its accounts so
// the columns line up all the way down. "Flagged only" shows just the lines that need an explanation.
// A flagged line's pencil opens the side panel to pick the explanation and add a note.
import { useState, useTransition } from "react";
import { AlertCircle, ChevronRight, Pencil, X } from "lucide-react";
import { explainFlagInline } from "../actions";

export const REASONS: Record<string, string> = {
  new_asset: "New asset", new_loan: "New loan", revenue_grew: "Revenue grew", one_time: "One-time expense", reclassified: "Reclassified", error_fixed: "Error found and fixed",
};
export type LeadAcc = { id: string; number: string; name: string; line: string; last: string; before: string; entries: string; final: string; change: string; pct: string; flagged: boolean; note?: { reason: string; note: string } };
export type LeadGroup = { code: string; name: string; last: string; before: string; entries: string; final: string; change: string; flags: number; open: number; rows: LeadAcc[] };

// Which part of the statements a lead sheet belongs to: A to H assets, AA to GG liabilities and equity, 10 to 50 the income statement.
const part = (code: string) => (!code ? "" : /^\d/.test(code) ? "Income statement" : code.length === 2 ? "Liabilities and equity" : "Assets");

export function LeadSheetsView({ fileId, groups, full, editable }: { fileId: string; groups: LeadGroup[]; full: boolean; editable: boolean }) {
  const [onlyFlags, setOnlyFlags] = useState(false);
  const [openCodes, setOpenCodes] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<LeadAcc | null>(null);
  const totalFlags = groups.reduce((n, g) => n + g.flags, 0), unexplained = groups.reduce((n, g) => n + g.open, 0);
  const shown = onlyFlags ? groups.filter((g) => g.flags) : groups;
  const toggle = (c: string) => setOpenCodes((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const cols = full ? 7 : 6;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyFlags} onChange={() => setOnlyFlags(!onlyFlags)} className="h-4 w-4 accent-navy-700" />Flagged only ({totalFlags})</label>
        <p className="text-sm text-ink-2">{totalFlags === 0 ? "No line changed by more than the flag amount and percentage." : unexplained ? `${unexplained} of ${totalFlags} flagged line${totalFlags === 1 ? "" : "s"} still need${unexplained === 1 ? "s" : ""} an explanation.` : "Every flagged line is explained."}</p>
      </div>
      <section className="card overflow-x-auto p-0">
        <table className="table min-w-[980px]">
          <thead><tr><th>Group / account</th><th className="text-right">Last year</th><th className="text-right">Before entries</th>{full && <th className="text-right">Entries</th>}<th className="text-right">This year final</th><th className="text-right">Change $</th><th className="text-right">Change %</th><th className="w-10"></th></tr></thead>
          <tbody>{shown.map((g, gi) => {
            const isOpen = onlyFlags || openCodes.has(g.code);
            const rows = onlyFlags ? g.rows.filter((r) => r.flagged) : g.rows;
            // A plain heading where a new part starts (codes stay in the build, never on screen).
            const heading = part(g.code) !== part(shown[gi - 1]?.code ?? "") ? part(g.code) : "";
            return [
              ...(heading ? [<tr key={`h-${heading}`}><td colSpan={cols + 1} className="pt-5 pb-1 text-xs font-semibold tracking-wider text-ink-3 uppercase">{heading}</td></tr>] : []),
              <tr key={g.code} className="cursor-pointer bg-sand-50/70 font-semibold hover:bg-sand-100" onClick={() => toggle(g.code)}>
                <td><ChevronRight className={`mr-1 inline h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />{g.name}
                  {g.flags > 0 && <span className={`ml-2 rounded px-1.5 text-xs ${g.open ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>{g.open ? `${g.open} to explain` : `${g.flags} explained`}</span>}</td>
                <td className="text-right tabular-nums">{g.last}</td><td className="text-right tabular-nums">{g.before}</td>{full && <td className="text-right tabular-nums">{g.entries}</td>}
                <td className="text-right tabular-nums">{g.final}</td><td className="text-right tabular-nums">{g.change}</td><td></td><td></td>
              </tr>,
              ...(isOpen ? rows.map((r) => (
                <tr key={r.id} className={r.flagged && !r.note ? "bg-warning-soft/50" : ""}>
                  <td className="pl-10">{r.number && <span className="mr-2 text-ink-3 tabular-nums">{r.number}</span>}{r.name}
                    <span className="block text-xs text-muted">{r.line}</span>
                    {r.note && <span className="block text-xs text-success">{REASONS[r.note.reason]}: {r.note.note}</span>}</td>
                  <td className="text-right tabular-nums">{r.last}</td><td className="text-right tabular-nums">{r.before}</td>{full && <td className="text-right tabular-nums">{r.entries}</td>}
                  <td className="text-right tabular-nums font-medium">{r.final}</td><td className="text-right tabular-nums">{r.change}</td>
                  <td className="text-right tabular-nums">{r.pct}{r.flagged && <AlertCircle className={`ml-1.5 inline h-4 w-4 ${r.note ? "text-success" : "text-warning"}`} aria-label={r.note ? "Flagged, explained" : "Flagged"} />}</td>
                  <td>{r.flagged && editable && <button type="button" onClick={() => setPanel(r)} aria-label={`Explain: ${r.name}`} title="Explain" className="rounded p-1.5 text-ink-3 hover:bg-sand-100 hover:text-navy-700"><Pencil className="h-4 w-4" /></button>}</td>
                </tr>
              )) : []),
            ];
          })}
          {shown.length === 0 && <tr><td colSpan={cols + 1} className="text-sm text-ink-2">Nothing flagged.</td></tr>}</tbody>
        </table>
      </section>
      {panel && <ExplainPanel key={panel.id} fileId={fileId} r={panel} onClose={() => setPanel(null)} />}
    </>
  );
}

function ExplainPanel({ fileId, r, onClose }: { fileId: string; r: LeadAcc; onClose: () => void }) {
  const [reason, setReason] = useState(r.note?.reason ?? "");
  const [note, setNote] = useState(r.note?.note ?? "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => { const e = await explainFlagInline(fileId, r.id, reason, note); if (e) setErr(e); else onClose(); });
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Explain the change">
      <div className="absolute inset-0 bg-navy-950/30" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-5 overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Explain the change</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1.5 hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-semibold">Account</dt><dd>{r.number} {r.name}</dd>
          <dt className="font-semibold">Line</dt><dd>{r.line}</dd>
          <dt className="font-semibold">Last year</dt><dd className="tabular-nums">{r.last}</dd>
          <dt className="font-semibold">This year</dt><dd className="tabular-nums">{r.final}</dd>
          <dt className="font-semibold">Change</dt><dd className="tabular-nums">{r.change} ({r.pct})</dd>
        </dl>
        <hr className="border-sand-200" />
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold">Why it changed</legend>
          {Object.entries(REASONS).map(([k, v]) => (
            <label key={k} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${reason === k ? "border-navy-700 bg-navy-50" : "border-sand-200"}`}>
              <input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} className="h-4 w-4 accent-navy-700" />{v}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-1"><label htmlFor="note" className="text-sm font-semibold">Note</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="For example: bought a new laptop in March, invoice in the file" className="input" /></div>
        <p className="text-xs text-muted">The reviewer judges each explanation when signing &ldquo;Compare to last year&rdquo;.</p>
        {err && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="mt-auto flex gap-3">
          <button type="button" onClick={save} disabled={pending || !reason || note.trim().length < 3} className="btn">{pending ? "Saving..." : "Save"}</button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </aside>
    </div>
  );
}
