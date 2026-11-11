"use client";
// The Accounts table (Phase 3 batch 4.5; mockup FileTrialBalance): every account in one table. Each
// row's GIFI line is a type-to-find box: type a word or a line number, pick, and it saves on the spot.
// The reviewer decides the reviewer's rows here too, and sets tax codes in the row.
import { useState, useTransition } from "react";
import { askReviewerInline, matchInline, taxCodeInline } from "../actions";

export type Row = {
  id: string; number: string; name: string; last: string; current: string; change: string;
  lineLabel: string; movedFrom: string; source: string; needsReviewer: boolean; reason: string; mismatch: string;
  tax: string; taxOverride: boolean; editable: boolean; reviewerRow: boolean;
};

export function AccountsTable({ fileId, rows, options, taxes, isReviewer, totals }: {
  fileId: string; rows: Row[]; options: { no: string; label: string }[]; taxes: { code: string; name: string }[]; isReviewer: boolean;
  totals: { last: string; current: string };
}) {
  return (
    <section className="card overflow-x-auto p-0">
      <datalist id="cb-lines">{options.map((o) => <option key={o.no} value={o.label} />)}</datalist>
      <table className="table min-w-[1000px]">
        <thead><tr><th>Account</th><th className="w-[38%]">GIFI line</th><th>Tax code</th><th className="text-right">Last year</th><th className="text-right">This year</th><th className="text-right">Change</th></tr></thead>
        <tbody>
          {rows.map((r) => <AccountRow key={r.id} fileId={fileId} r={r} options={options} taxes={taxes} isReviewer={isReviewer} />)}
          <tr className="font-semibold"><td>Total (must be 0)</td><td></td><td></td><td className="text-right tabular-nums">{totals.last}</td><td className="text-right tabular-nums">{totals.current}</td><td></td></tr>
        </tbody>
      </table>
    </section>
  );
}

function AccountRow({ fileId, r, options, taxes, isReviewer }: { fileId: string; r: Row; options: { no: string; label: string }[]; taxes: { code: string; name: string }[]; isReviewer: boolean }) {
  const [value, setValue] = useState(r.lineLabel);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canPick = r.editable && (!r.needsReviewer || isReviewer);

  // Save when the text is exactly one of the lines (picked from the list, or typed in full).
  const pick = (text: string) => {
    setValue(text);
    const hit = options.find((o) => o.label === text) ?? options.find((o) => o.no === text.trim() || o.no === `${text.trim()}.00`);
    if (!hit || hit.label === r.lineLabel) return;
    setValue(hit.label);
    start(async () => {
      const err = await matchInline(fileId, r.id, hit.no);
      setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved" });
    });
  };

  return (
    <tr className={r.needsReviewer ? "bg-danger/5" : !r.lineLabel ? "bg-warning-soft/50" : ""}>
      <td>{r.number && <span className="mr-2 text-ink-3 tabular-nums">{r.number}</span>}{r.name}</td>
      <td>
        {canPick ? (
          <input list="cb-lines" value={value} onChange={(e) => pick(e.target.value)} onFocus={(e) => e.target.select()} disabled={pending}
            placeholder={r.needsReviewer ? "Reviewer: type a word or line number" : "Type a word or line number"} aria-label={`GIFI line for ${r.name}`}
            className={`input h-9 text-sm ${r.lineLabel ? "" : "border-warning"}`} />
        ) : <span>{r.lineLabel || <span className="text-ink-3">Waiting for the reviewer</span>}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
          {pending && <span>Saving...</span>}
          {msg && <span className={msg.ok ? "text-success" : "text-danger"}>{msg.text}</span>}
          {!msg && r.source && <span>{r.source}</span>}
          {r.needsReviewer && <span className="font-semibold text-danger">For the reviewer: {r.reason}</span>}
          {r.movedFrom && <span>Opposite balance: shown on its paired line (matched to {r.movedFrom})</span>}
          {r.mismatch && <span className={r.mismatch.startsWith("Check") ? "font-semibold text-warning" : ""}>{r.mismatch}</span>}
          {r.editable && !isReviewer && !r.needsReviewer && (
            <button type="button" className="text-navy-700 underline" disabled={pending}
              onClick={() => start(async () => { const err = await askReviewerInline(fileId, r.id); setMsg(err ? { ok: false, text: err } : { ok: true, text: "Sent to the reviewer" }); })}>Not sure? Ask the reviewer</button>
          )}
        </span>
      </td>
      <td>
        {isReviewer && r.editable && r.lineLabel ? (
          <select defaultValue={r.taxOverride ? r.tax : ""} aria-label={`Tax code for ${r.name}`} className="input h-9 w-28 text-sm"
            onChange={(e) => start(async () => { const err = await taxCodeInline(fileId, r.id, e.target.value); setMsg(err ? { ok: false, text: err } : { ok: true, text: "Tax code saved" }); })}>
            <option value="">{r.taxOverride ? "Line default" : `${r.tax} (default)`}</option>
            {taxes.map((t) => <option key={t.code} value={t.code} title={t.name}>{t.code}</option>)}
          </select>
        ) : <>{r.tax}{r.taxOverride && <span className="block text-xs text-muted">Reviewer&rsquo;s choice</span>}</>}
      </td>
      <td className="text-right tabular-nums">{r.last}</td>
      <td className="text-right tabular-nums">{r.current}</td>
      <td className="text-right tabular-nums">{r.change}</td>
    </tr>
  );
}
