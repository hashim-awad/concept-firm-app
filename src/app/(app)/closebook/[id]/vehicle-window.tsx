"use client";
// Piece 3 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud: a working paper that calculates amounts and fills its
// adjusting entry). The "Vehicle schedule" window over the entry window: Prorated or Detailed, the typed inputs with
// last year's figures in grey, the car costs the company paid (read only, from the books), the per-km allowance
// against the actual costs, the working, "Claim the ITC", and "Put it in the entry". The figures are worked out by
// src/lib/closebook/vehicle-schedule.ts, the same code the server runs before saving.
import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { calcVehicle, shortDate, yearParts, PROVINCE_NAMES, type Choice, type Method, type VehicleInputs, type VehicleResult } from "@/lib/closebook/vehicle-schedule";
import type { VehicleData } from "@/lib/closebook/vehicle-server";

const km = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("en-CA"));
const readKm = (t: string) => { const v = t.replace(/[\s,]/g, ""); return /^\d{1,7}$/.test(v) ? Number(v) : null; };
const money = (c: number | null | undefined) => (c === null || c === undefined ? "" : formatAmount(c));

export function VehicleWindow({ data, initial, canPrint, printHref, onPut, onClose }: {
  data: VehicleData; initial: VehicleInputs; canPrint: boolean; printHref: string;
  onPut: (inputs: VehicleInputs, r: VehicleResult) => void; onClose: () => void;
}) {
  const y = useMemo(() => yearParts(data.ctx.yearStart, data.ctx.yearEnd), [data.ctx.yearStart, data.ctx.yearEnd]);
  const [method, setMethod] = useState<Method>(initial.method);
  const [business, setBusiness] = useState(km(initial.businessKm));
  const [parts, setParts] = useState<string[]>(y.parts.map((_, i) => km(initial.partKm[i])));
  const [already, setAlready] = useState(km(initial.alreadyKm));
  const [total, setTotal] = useState(km(initial.totalKm));
  const [paid, setPaid] = useState(money(initial.ownerPaid));
  const [gst, setGst] = useState(money(initial.ownerGst));
  const [choice, setChoice] = useState<Choice>(initial.choice);
  const [itc, setItc] = useState(initial.itc);

  const inputs: VehicleInputs = {
    method, businessKm: readKm(business), partKm: parts.map(readKm), alreadyKm: readKm(already), totalKm: readKm(total),
    ownerPaid: parseAmount(paid), ownerGst: data.ctx.regular ? parseAmount(gst) : null, choice, itc,
    paidTo: null,
  };
  const r = calcVehicle(inputs, data.ctx, data.names);
  const err = (field: string) => r.problems.filter((p) => p.field === field).map((p) => <span key={p.text} role="alert" className="text-[12px] font-normal text-danger">{p.text}</span>);
  const hint = (v: string) => (data.hints ? <span className="text-[11.5px] font-normal text-ink-3">Last year: {v || "empty"}</span> : null);
  const h = data.hints;
  const range = `${shortDate(data.ctx.yearStart)} to ${shortDate(data.ctx.yearEnd)}`;
  const fld = "grid gap-1 text-[12.5px] font-semibold text-ink-2";
  const box = "input input-compact w-44 text-right text-[13px] font-normal text-ink tabular-nums";
  const kmBox = (label: string, value: string, set: (v: string) => void, last: string, extra: React.ReactNode = null, aria = label) => (
    <label className={fld}>{label}
      <input aria-label={aria} inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} onBlur={(e) => { const v = readKm(e.target.value); if (v !== null) set(km(v)); }} className={box} />
      {hint(last)}{extra}</label>
  );
  const province = PROVINCE_NAMES[data.ctx.province] ?? data.ctx.province;
  const factor = data.ctx.factor ? `${data.ctx.factor.numerator}/${data.ctx.factor.denominator}` : "no factor";
  const higherIsUsed = r.used === r.higher;
  // Version 2: the record's blocks show with the others under the boxes; with several shareholders the pick list holds its own.
  const generalProblems = r.problems.filter((p) => p.field === "rates" || p.field === "factor" || p.field === "bn" || p.field === "paidTo");

  const card = (kind: "allowance" | "actual", title: string, amount: number | null) => {
    const used = r.used === kind;
    const avail = kind === "allowance" ? amount !== null : r.actual !== null;
    return (
      <div className={`grid gap-1 rounded-[10px] border px-4 py-3 ${used ? "border-success bg-success-soft/40" : "border-sand-200"}`} data-box={kind}>
        <span className="text-[12px] font-semibold text-ink-2">{title}</span>
        <span className="text-[20px] font-bold tabular-nums">{amount === null ? <span className="text-[15px] font-semibold text-ink-3">Not entered</span> : formatAmount(amount)}</span>
        <span className="min-h-[20px] text-[12px]">
          {used && higherIsUsed && <span className="font-semibold text-success">Higher · used</span>}
          {used && !higherIsUsed && <span className="font-semibold text-success">Used · <button type="button" onClick={() => setChoice("higher")} className="font-semibold text-navy-700 underline">Use the higher one</button></span>}
          {!used && avail && <>{r.higher === kind && <span className="mr-2 text-ink-3">Higher</span>}<button type="button" onClick={() => setChoice(kind)} className="btn-secondary btn-compact">Use this instead</button></>}
        </span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] print:hidden" data-vehicle-window>
      <button type="button" aria-label="Close the schedule" onClick={onClose} className="absolute inset-0 block bg-navy-950/35" />
      <div role="dialog" aria-modal="true" aria-label="Vehicle schedule" className="relative mx-auto mt-[48px] flex max-h-[calc(100vh-72px)] w-[900px] max-w-[96vw] flex-col rounded-[10px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3">
          <h2 className="text-[15px] font-bold">Vehicle schedule</h2>
          <span className="text-[12.5px] text-ink-3">Owner&apos;s car · {range}</span>
          <span className="flex-1" />
          <div role="radiogroup" aria-label="Method" className="flex rounded-md border border-sand-300 p-0.5 text-[12.5px] font-semibold">
            {(["prorated", "detailed"] as Method[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`rounded px-3 py-1 ${method === m ? "bg-navy-800 text-white" : "text-ink-2 hover:bg-sand-100"}`}>{m === "prorated" ? "Prorated" : "Detailed"}</button>
            ))}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-sand-100"><X className="h-[18px] w-[18px]" /></button>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            <div className="grid content-start gap-3">
              {method === "prorated"
                ? kmBox(`Business km in the year (${range})`, business, setBusiness, km(h?.businessKm), err("business"), "Business km in the year")
                : <>
                  {!y.startsJan1 && kmBox(`Business km already driven (${y.beforeLabel})`, already, setAlready, km(h?.alreadyKm), null, "Business km already driven")}
                  {y.parts.map((p, i) => kmBox(`Business km, ${p.label}`, parts[i] ?? "", (v) => setParts(parts.map((x, j) => (j === i ? v : x))), km(h?.partKm[i]), i === 0 ? err("business") : null))}
                </>}
              {kmBox("Total km in the year (optional)", total, setTotal, km(h?.totalKm), err("total"), "Total km in the year")}
            </div>
            <div className="grid content-start gap-3">
              <label className={fld}>Car costs the owner paid personally (optional)
                <input aria-label="Car costs the owner paid personally" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} onBlur={(e) => setPaid(tidyAmount(e.target.value))} className={box} />
                <span className="text-[11.5px] font-normal text-ink-3">Tax included.</span>{hint(money(h?.ownerPaid))}</label>
              {data.ctx.regular && <label className={fld}>GST/HST in those costs (optional)
                <input aria-label="GST/HST in those costs" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} onBlur={(e) => setGst(tidyAmount(e.target.value))} className={box} />
                {hint(money(h?.ownerGst))}{err("ownerGst")}</label>}
              <div className="grid gap-1 rounded-lg bg-sand-50 px-3 py-2 text-[12.5px]" data-company>
                <span className="font-semibold text-ink-2">Car costs the company paid</span>
                {data.companyIn ? <span><span className="font-bold tabular-nums">0.00</span> <span className="text-ink-3">· in the first car&apos;s schedule ({data.companyIn})</span></span>
                  : <span className="font-bold tabular-nums">{formatAmount(r.company.total)}</span>}
                {!data.companyIn && data.ctx.regular && r.company.total !== 0 && <span className="text-[11.5px] text-ink-3">{formatAmount(r.company.cost)} before tax + {formatAmount(r.company.gst)} GST/HST posted</span>}
                <span className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-ink-3">From the books: {data.ledgerNumbers.join(", ")}
                  <a href={data.ledgerAll} target="_blank" rel="noreferrer" className="font-semibold text-navy-700 underline" data-ledger-link>Open the ledger</a></span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {card("allowance", "Per-km allowance", r.allowance)}
            {card("actual", r.actual === null ? "Actual costs" : `Actual costs, ${r.sharePct}`, r.actual)}
          </div>
          {generalProblems.map((p) => <p key={p.text} role="alert" className="text-[12.5px] text-danger">{p.text}</p>)}
          <ul className="grid gap-0.5 text-[12px] text-ink-3" data-working>{r.working.map((w) => <li key={w}>{w}</li>)}</ul>

          {data.ctx.regular && (
            <label className={`flex items-center gap-2 text-[13px] ${data.canItc ? "" : "text-ink-3"}`}>
              <input type="checkbox" checked={itc} disabled={!data.canItc} onChange={(e) => setItc(e.target.checked)} className="h-4 w-4" />
              Claim the ITC ({factor}, {province})
              {!data.canItc && <span className="text-[12px] text-ink-3">Reviewer can change</span>}
            </label>
          )}

          {r.lines.length > 0 && (
            <table className="w-full border-collapse text-[12.5px]" data-sched-lines>
              <thead><tr className="border-b border-sand-200 text-left text-[11px] font-semibold text-ink-3"><th className="py-1">Account</th><th className="py-1">Description</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th></tr></thead>
              <tbody>{r.lines.map((l) => (
                <tr key={l.part} className="border-b border-sand-100"><td className="py-1">{l.number} {l.name}</td><td className="py-1 text-ink-2">{l.memo}</td>
                  <td className="py-1 text-right tabular-nums">{l.amount > 0 ? formatAmount(l.amount) : ""}</td><td className="py-1 text-right tabular-nums">{l.amount < 0 ? formatAmount(-l.amount) : ""}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-b-[10px] border-t border-sand-200 bg-sand-50 px-5 py-3">
          {canPrint ? <a href={printHref} target="_blank" rel="noreferrer" className="btn-secondary btn-compact">Print schedule (PDF)</a>
            : <span className="flex items-center gap-2"><button type="button" disabled className="btn-secondary btn-compact">Print schedule (PDF)</button><span className="text-[12px] text-ink-3">Save the entry to print</span></span>}
          <span className="flex-1" />
          {!r.ready && r.problems.some((p) => p.field === "km") && <span className="text-[12px] text-ink-3">Enter the business km.</span>}
          <button type="button" onClick={onClose} className="btn-secondary btn-compact">Cancel</button>
          <button type="button" disabled={!r.ready} onClick={() => onPut(inputs, r)} className="btn btn-compact">Put it in the entry</button>
        </div>
      </div>
    </div>
  );
}

// Delete on a schedule's entry asks first (piece 3).
export function ConfirmDelete({ message }: { message: string }) {
  return <button type="submit" onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }} className="btn-secondary btn-compact border-danger/30 text-danger">Delete</button>;
}
