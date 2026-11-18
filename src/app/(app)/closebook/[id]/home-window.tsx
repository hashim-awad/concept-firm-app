"use client";
// Piece 4 (Hashim, Nov 18, 2026, version 2; benchmark CaseWare Cloud: a working paper that calculates amounts and fills
// its adjusting entry). The "Home office schedule" window over the entry window (mock F): the home and office areas
// (or "Type the % instead"), the nine cost rows with AMOUNT PAID, GST/HST IN IT and BUSINESS <share>%, the grey
// working line, "Claim the ITC", Paid to where the GST/HST record prints, and "Put <owed> in the entry". The figures are
// worked out by src/lib/closebook/home-office.ts, the same code the server runs before saving.
import { useState } from "react";
import { X } from "lucide-react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { COST_ROWS, calcHome, type CostKey, type HomeInputs, type HomeResult } from "@/lib/closebook/home-office";
import { PROVINCE_NAMES } from "@/lib/closebook/vehicle-schedule";
import type { HomeData } from "@/lib/closebook/home-office-server";

const sq = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("en-CA"));
const readSq = (t: string) => { const v = t.replace(/[\s,]/g, ""); return /^\d{1,7}$/.test(v) ? Number(v) : null; };
const money = (c: number | null | undefined) => (c === null || c === undefined ? "" : formatAmount(c));

export function HomeWindow({ data, initial, canPrint, printHref, onPut, onClose }: {
  data: HomeData; initial: HomeInputs; canPrint: boolean; printHref: string;
  onPut: (inputs: HomeInputs, r: HomeResult) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState(initial.mode);
  const [home, setHome] = useState(sq(initial.homeSqft));
  const [office, setOffice] = useState(sq(initial.officeSqft));
  const [pct, setPct] = useState(initial.pctBp === null ? "" : (initial.pctBp / 100).toFixed(2));
  const [paid, setPaid] = useState<Record<string, string>>(Object.fromEntries(COST_ROWS.map((r) => [r.key, money(initial.costs[r.key]?.paid)])));
  const [gst, setGst] = useState<Record<string, string | null>>(Object.fromEntries(COST_ROWS.map((r) => [r.key, initial.costs[r.key]?.gst == null ? null : money(initial.costs[r.key]!.gst)])));
  const [itc, setItc] = useState(initial.itc);

  const pctBp = (() => { const v = pct.replace(/[\s%]/g, ""); return /^\d{1,3}(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null; })();
  const inputs: HomeInputs = {
    mode, homeSqft: readSq(home), officeSqft: readSq(office), pctBp: mode === "pct" ? pctBp : null,
    costs: Object.fromEntries(COST_ROWS.map((r) => [r.key, { paid: parseAmount(paid[r.key] ?? ""), gst: gst[r.key] == null || gst[r.key] === "" ? null : parseAmount(gst[r.key]!) }])),
    itc, paidTo: null,
  };
  const r = calcHome(inputs, data.ctx, data.names);
  const err = (field: string) => r.problems.filter((p) => p.field === field).map((p) => <span key={p.text} role="alert" className="text-[12px] font-normal text-danger">{p.text}</span>);
  const h = data.hints;
  const hint = (v: string) => (h ? <span className="text-[11.5px] font-normal text-ink-3">Last year: {v || "empty"}</span> : null);
  const fld = "grid content-start gap-1 text-[12.5px] font-semibold text-ink-2";
  const box = "input input-compact w-full text-[13px] font-normal text-ink tabular-nums";
  const cell = "input input-compact w-full text-right text-[13px] tabular-nums";
  const factor = data.ctx.factor ? `${data.ctx.factor.numerator}/${data.ctx.factor.denominator}` : "no factor";
  const province = PROVINCE_NAMES[data.ctx.province] ?? data.ctx.province;
  const general = r.problems.filter((p) => ["factor", "bn"].includes(p.field) || p.field === "paidTo");
  const rowProblems = r.problems.filter((p) => COST_ROWS.some((c) => c.key === p.field));
  const share = r.sharePct ? r.sharePct : "–";

  return (
    <div className="fixed inset-0 z-[60] print:hidden" data-home-window>
      <button type="button" aria-label="Close the schedule" onClick={onClose} className="absolute inset-0 block bg-navy-950/35" />
      <div role="dialog" aria-modal="true" aria-label="Home office schedule" className="relative mx-auto mt-[40px] flex max-h-[calc(100vh-60px)] w-[900px] max-w-[96vw] flex-col rounded-[10px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3">
          <h2 className="text-[15px] font-bold">Home office schedule</h2>
          <span className="flex-1" />
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-sand-100"><X className="h-[18px] w-[18px]" /></button>
        </div>
        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 md:grid-cols-3">
            {mode === "area" ? <>
              <label className={fld}>Home area (sq ft)<input aria-label="Home area (sq ft)" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} onBlur={(e) => { const v = readSq(e.target.value); if (v !== null) setHome(sq(v)); }} className={box} />{hint(sq(h?.homeSqft))}</label>
              <label className={fld}>Office area (sq ft)<input aria-label="Office area (sq ft)" inputMode="numeric" value={office} onChange={(e) => setOffice(e.target.value)} onBlur={(e) => { const v = readSq(e.target.value); if (v !== null) setOffice(sq(v)); }} className={box} />{hint(sq(h?.officeSqft))}{err("area")}</label>
              <div className={fld}>Business share<span className="flex h-[30px] items-center text-[13px] font-semibold text-ink tabular-nums" data-share>{share}</span>
                <button type="button" onClick={() => { setMode("pct"); if (!pct && r.sharePct) setPct(r.sharePct.replace("%", "")); }} className="justify-self-start text-[12px] font-semibold text-navy-700 underline">Type the % instead</button></div>
            </> : <>
              <label className={`${fld} md:col-span-2`}>Business share (%)<input aria-label="Business share (%)" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className={`${box} max-w-[160px]`} />
                {hint(h?.pctBp != null ? `${(h.pctBp / 100).toFixed(2)}%` : "")}{err("pct")}</label>
              <div className={fld}>Business share<span className="flex h-[30px] items-center text-[13px] font-semibold text-ink tabular-nums" data-share>{share}</span>
                <button type="button" onClick={() => setMode("area")} className="justify-self-start text-[12px] font-semibold text-navy-700 underline">Use the areas instead</button></div>
            </>}
          </div>

          <table className="w-full border-collapse text-[13px]" data-home-costs>
            <thead><tr className="border-b border-sand-200 bg-sand-50 text-left text-[11px] font-semibold tracking-[.06em] text-ink-3 uppercase">
              <th className="px-2 py-2">Cost</th><th className="w-40 px-2 py-2 text-right">Amount paid</th>{data.ctx.regular && <th className="w-36 px-2 py-2 text-right">GST/HST in it</th>}
              <th className="w-40 px-2 py-2 text-right">Business {share}</th></tr></thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.key} className="border-b border-sand-100 align-top">
                  <td className="px-2 py-1.5">{row.label}{rowProblems.filter((p) => p.field === row.key).map((p) => <span key={p.text} role="alert" className="block text-[12px] text-danger">{p.text}</span>)}</td>
                  <td className="px-2 py-1"><input aria-label={`${row.label} amount paid`} inputMode="decimal" value={paid[row.key] ?? ""} onChange={(e) => setPaid({ ...paid, [row.key]: e.target.value })}
                    onBlur={(e) => setPaid({ ...paid, [row.key]: tidyAmount(e.target.value) })} className={cell} />
                    {h?.costs[row.key as CostKey]?.paid != null && <span className="block text-right text-[11px] text-ink-3">Last year: {money(h.costs[row.key as CostKey]!.paid)}</span>}</td>
                  {data.ctx.regular && <td className="px-2 py-1"><input aria-label={`${row.label} GST/HST`} inputMode="decimal" value={gst[row.key] ?? (row.gstText === "none" ? "" : row.gstText)} placeholder={row.gstText === "none" ? "none" : ""}
                    onChange={(e) => setGst({ ...gst, [row.key]: e.target.value })} onBlur={(e) => setGst({ ...gst, [row.key]: e.target.value.trim() === "" ? null : tidyAmount(e.target.value) })}
                    className={`${cell} ${row.typedGst ? "" : "text-ink-2"} placeholder:text-ink-3`} /></td>}
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.paid ? formatAmount(row.business) : "–"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink font-bold"><td className="px-2 py-2">Total</td><td className="px-2 py-2 text-right tabular-nums" data-total-paid>{formatAmount(r.totalPaid)}</td>
                {data.ctx.regular && <td className="px-2 py-2 text-right tabular-nums" data-total-gst>{formatAmount(r.totalGst)}</td>}<td className="px-2 py-2 text-right tabular-nums" data-total-business>{formatAmount(r.totalBusiness)}</td></tr>
            </tbody>
          </table>
          {r.working && <p className="text-[12.5px] text-ink-2" data-working>{r.working}</p>}
          {general.map((p) => <p key={p.text} role="alert" className="text-[12.5px] text-danger">{p.text}</p>)}

          {data.ctx.regular && (
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
          {!r.ready && r.problems.some((p) => p.field === "share" || p.field === "paid") && <span className="text-[12px] text-ink-3">{r.problems.find((p) => p.field === "share" || p.field === "paid")!.text}</span>}
          <button type="button" onClick={onClose} className="btn-secondary btn-compact">Cancel</button>
          <button type="button" disabled={!r.ready} onClick={() => onPut(inputs, r)} className="btn btn-compact">Put {formatAmount(r.owed)} in the entry</button>
        </div>
      </div>
    </div>
  );
}
