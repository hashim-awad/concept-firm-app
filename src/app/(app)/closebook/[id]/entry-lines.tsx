"use client";
// The lines of a new entry (Hashim, Nov 15, 2026, layout item 10; benchmark: QuickBooks Online's journal
// entry): two lines to start, "+ Add a line" below, the debit total, credit total and difference under
// the lines, and Save off until the difference is 0.00. The inputs keep the form's names (t0, dr0, cr0,
// m0 ...), so the server action reads them as before.
import { useState } from "react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";

type Row = { id: number; dr: string; cr: string };
export type OptionGroup = { label: string; items: [string, string][] };

export function EntryLines({ groups, accountHeading, children }: { groups: OptionGroup[]; accountHeading: string; children?: React.ReactNode }) {
  const [rows, setRows] = useState<Row[]>([{ id: 0, dr: "", cr: "" }, { id: 1, dr: "", cr: "" }]);
  const set = (id: number, k: "dr" | "cr", v: string) => setRows(rows.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const sum = (k: "dr" | "cr") => rows.reduce((n, r) => n + (parseAmount(r[k]) ?? 0), 0);
  const dr = sum("dr"), cr = sum("cr"), diff = dr - cr;
  const ready = dr > 0 && diff === 0;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="table min-w-[760px]">
          <thead><tr><th>{accountHeading}</th><th className="w-36">Debit</th><th className="w-36">Credit</th><th>Memo</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td><select name={`t${i}`} aria-label={`Line ${i + 1} account`} defaultValue="" className="input">
                  <option value="">Choose</option>
                  {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
                </select></td>
                <td><input name={`dr${i}`} inputMode="decimal" aria-label={`Line ${i + 1} debit`} value={r.dr} onChange={(e) => set(r.id, "dr", e.target.value)} onBlur={(e) => set(r.id, "dr", tidyAmount(e.target.value))} className="input text-right tabular-nums" /></td>
                <td><input name={`cr${i}`} inputMode="decimal" aria-label={`Line ${i + 1} credit`} value={r.cr} onChange={(e) => set(r.id, "cr", e.target.value)} onBlur={(e) => set(r.id, "cr", tidyAmount(e.target.value))} className="input text-right tabular-nums" /></td>
                <td><input name={`m${i}`} aria-label={`Line ${i + 1} memo`} maxLength={200} className="input" /></td>
              </tr>
            ))}
            <tr><td colSpan={4}><button type="button" onClick={() => setRows([...rows, { id: Math.max(...rows.map((r) => r.id)) + 1, dr: "", cr: "" }])} className="text-sm text-navy-700 underline">+ Add a line</button></td></tr>
          </tbody>
          <tfoot>
            <tr className="font-semibold"><td className="text-right">Total</td><td className="text-right tabular-nums">{formatAmount(dr)}</td><td className="text-right tabular-nums">{formatAmount(cr)}</td><td /></tr>
            <tr><td className="text-right text-sm">Difference</td><td colSpan={2} className={`text-center text-sm font-semibold tabular-nums ${diff ? "text-danger" : "text-success"}`}>{formatAmount(Math.abs(diff))}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn w-fit" disabled={!ready}>Save the entry</button>
        {!ready && <span className="text-sm text-ink-2">{dr === 0 ? "Enter the amounts." : "Save opens when the difference is 0.00."}</span>}
      </div>
    </>
  );
}
