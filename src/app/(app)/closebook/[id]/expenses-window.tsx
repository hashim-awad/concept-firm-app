"use client";
// Piece 4b (Hashim, Nov 18, 2026, version 2; benchmark CaseWare Cloud: a working paper that calculates amounts and fills
// its adjusting entry). The "Expenses paid personally" window over the entry window (mock G): a table that starts with
// three empty lines, "+ Add a line" and a × on each line; ACCOUNT (the entry form's picker, expense accounts only), WHAT
// IT WAS, AMOUNT PAID, GST/HST IN IT, BUSINESS %; "Owed to the owner", the grey working line, "Claim the ITC", and "Put
// <owed> in the entry". The figures are worked out by src/lib/closebook/expenses-schedule.ts, the same code the server
// runs before saving.
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { blankExpLine, calcExpenses, pctText, type ExpInputs, type ExpLine, type ExpResult } from "@/lib/closebook/expenses-schedule";
import { PROVINCE_NAMES } from "@/lib/closebook/vehicle-schedule";
import type { ExpData } from "@/lib/closebook/expenses-schedule-server";

type Row = { acct: string | null; what: string; paid: string; gst: string | null; pct: string };
const money = (c: number | null | undefined) => (c === null || c === undefined ? "" : formatAmount(c));
const toRow = (l: ExpLine): Row => ({ acct: l.acct, what: l.what, paid: money(l.paid), gst: l.gst == null ? null : money(l.gst), pct: l.pctBp == null ? "100" : pctText(l.pctBp) });
const readPct = (t: string): number | null => { const v = t.replace(/[\s%]/g, ""); if (v === "") return null; return /^\d{1,3}(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0; };

export function ExpensesWindow({ data, initial, canPrint, printHref, onPut, onClose, notice }: {
  notice?: string;
  data: ExpData; initial: ExpInputs; canPrint: boolean; printHref: string;
  onPut: (inputs: ExpInputs, r: ExpResult) => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(initial.lines.map(toRow));
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [itc, setItc] = useState(initial.itc);
  const byLabel = useMemo(() => new Map(data.options.map((o) => [o.label, o.value])), [data.options]);
  const labelOf = (v: string | null) => (v ? data.ctx.accts[v]?.label ?? "" : "");
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const inputs: ExpInputs = {
    lines: rows.map((r) => ({ acct: r.acct, what: r.what.trim(), paid: parseAmount(r.paid), gst: r.gst == null || r.gst === "" ? null : parseAmount(r.gst), pctBp: r.pct.trim() === "100" ? null : readPct(r.pct) })),
    itc, paidTo: null,
  };
  const r = calcExpenses(inputs, data.ctx);
  const regular = data.ctx.regular;
  const factor = data.ctx.factor ? `${data.ctx.factor.numerator}/${data.ctx.factor.denominator}` : "no factor";
  const province = PROVINCE_NAMES[data.ctx.province] ?? data.ctx.province;
  const general = r.problems.filter((p) => ["factor", "bn", "paidTo"].includes(p.field));
  const lineErr = (i: number) => r.problems.filter((p) => p.field.endsWith(`:${i}`));
  const box = "input input-compact w-full text-[13px] tabular-nums";
  const cell = `${box} text-right`;

  return (
    <div className="fixed inset-0 z-[60] print:hidden" data-expenses-window>
      <button type="button" aria-label="Close the schedule" onClick={onClose} className="absolute inset-0 block bg-navy-950/35" />
      <div role="dialog" aria-modal="true" aria-label="Expenses paid personally" className="relative mx-auto mt-[40px] flex max-h-[calc(100vh-60px)] w-[1000px] max-w-[96vw] flex-col rounded-[var(--radius-ds)] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3">
          <h2 className="text-[15px] font-bold">Expenses paid personally</h2>
          <span className="flex-1" />
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-sand-100"><X className="h-[18px] w-[18px]" /></button>
        </div>
        {notice && <p className="mx-5 mt-3 rounded-[var(--radius-ds)] bg-warning-soft px-3 py-2 text-[12.5px] text-warning" role="note" data-approved-note>{notice}</p>}
        <div className="grid gap-3 overflow-y-auto px-5 py-4">
          <datalist id="exp-acct-list">{data.options.map((o) => <option key={o.value} value={o.label} />)}</datalist>
          <table className="w-full table-fixed border-collapse text-[13px]" data-exp-lines>
            <colgroup><col className="w-[30%]" /><col /><col className="w-32" />{regular && <col className="w-32" />}<col className="w-24" /><col className="w-8" /></colgroup>
            <thead><tr className="border-b border-sand-200 bg-sand-50 text-left text-[11px] font-semibold tracking-[.06em] text-ink-3 uppercase">
              <th className="px-2 py-2">Account</th><th className="px-2 py-2">What it was</th><th className="px-2 py-2 text-right">Amount paid</th>
              {regular && <th className="px-2 py-2 text-right">GST/HST in it</th>}<th className="px-2 py-2 text-right">Business %</th><th /></tr></thead>
            <tbody>
              {rows.map((row, i) => {
                const x = r.rows[i];
                return (
                  <tr key={i} className="border-b border-sand-100 align-top" data-exp-line={i + 1}>
                    <td className="px-2 py-1">
                      <input aria-label={`Line ${i + 1} account`} list="exp-acct-list" value={typed[i] ?? labelOf(row.acct)} placeholder="Search accounts"
                        onChange={(e) => { const v = e.target.value; setTyped({ ...typed, [i]: v }); set(i, { acct: byLabel.get(v) ?? null }); }}
                        onBlur={() => { const t = { ...typed }; delete t[i]; setTyped(t); }} className={box} />
                      {x?.meals && regular && <span className="mt-0.5 block text-[11.5px] text-ink-3" data-meals-note>Meals: half the GST/HST</span>}
                      {lineErr(i).map((p) => <span key={p.text} role="alert" className="mt-0.5 block text-[12px] text-danger">{p.text}</span>)}
                    </td>
                    <td className="px-2 py-1"><input aria-label={`Line ${i + 1} what it was`} value={row.what} maxLength={200} onChange={(e) => set(i, { what: e.target.value })} className={box} /></td>
                    <td className="px-2 py-1"><input aria-label={`Line ${i + 1} amount paid`} inputMode="decimal" value={row.paid} onChange={(e) => set(i, { paid: e.target.value })}
                      onBlur={(e) => set(i, { paid: tidyAmount(e.target.value) })} className={cell} /></td>
                    {regular && <td className="px-2 py-1"><input aria-label={`Line ${i + 1} GST/HST`} inputMode="decimal" value={row.gst ?? (x?.gstText === "none" ? "" : x?.gstText ?? "")}
                      placeholder={x?.gstText === "none" ? "none" : ""} onChange={(e) => set(i, { gst: e.target.value })}
                      onBlur={(e) => set(i, { gst: e.target.value.trim() === "" ? null : tidyAmount(e.target.value) })}
                      className={`${cell} ${x?.typedGst ? "" : "text-ink-2"} placeholder:text-ink-3`} /></td>}
                    <td className="px-2 py-1"><input aria-label={`Line ${i + 1} business %`} inputMode="decimal" value={row.pct} onChange={(e) => set(i, { pct: e.target.value })} className={cell} /></td>
                    <td className="py-2 text-center"><button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setTyped({}); }}
                      className="text-ink-3 hover:text-danger"><X className="h-3.5 w-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setRows([...rows, toRow(blankExpLine())])} className="text-[13px] font-semibold text-navy-700 hover:underline">+ Add a line</button>
            <span className="flex-1" />
            <span className="text-[14px]">Owed to the owner <b className="tabular-nums" data-owed>{formatAmount(r.owed)}</b></span>
          </div>
          {r.working && <p className="text-[12.5px] text-ink-3" data-working>{r.working}</p>}
          {general.map((p) => <p key={p.text} role="alert" className="text-[12.5px] text-danger">{p.text}</p>)}
          {regular && (
            <label className={`flex items-center gap-2 text-[13px] ${data.canItc ? "" : "text-ink-3"}`}>
              <input type="checkbox" checked={itc} disabled={!data.canItc} onChange={(e) => setItc(e.target.checked)} className="h-4 w-4" />
              Claim the ITC ({factor}, {province}){!data.canItc && <span className="text-[12px] text-ink-3">Reviewer can change</span>}
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-b-[10px] border-t border-sand-200 bg-sand-50 px-5 py-3">
          {canPrint ? <a href={printHref} target="_blank" rel="noreferrer" className="btn-secondary btn-compact">Print schedule (PDF)</a>
            : <span className="flex items-center gap-2"><button type="button" disabled className="btn-secondary btn-compact">Print schedule (PDF)</button><span className="text-[12px] text-ink-3">Save the entry to print</span></span>}
          <span className="flex-1" />
          {!r.ready && r.problems.some((p) => p.field === "paid") && <span className="text-[12px] text-ink-3">Enter the amounts paid.</span>}
          <button type="button" onClick={onClose} className="btn-secondary btn-compact">Cancel</button>
          <button type="button" disabled={!r.ready} onClick={() => onPut(inputs, r)} className="btn btn-compact">Put {formatAmount(r.owed)} in the entry</button>
        </div>
      </div>
    </div>
  );
}
