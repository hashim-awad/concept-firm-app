"use client";
// Piece 1, round 1b (Hashim, Nov 18, 2026): the two tables of Closebook rules › CRA rates.
// - Per-km rates: clicking a year (or Enter on it) opens it for change in the same inline form as "+ Add a year",
//   as rows open elsewhere in Studio. No "Change" link.
// - ITC factors: one Save under the table saves every changed row; rows not changed are not sent.
// A refused save keeps what was typed and shows each message in red under its field, not as a banner.
import { Fragment, useActionState, useState } from "react";
import { saveItcFactors, saveKmRates, type CraFormState } from "../actions";
import { KM_COLUMNS, PROVINCES } from "@/lib/closebook/cra-rates";

export type KmView = { year: number; rates: Record<string, string>; by: string; when: string };
export type ItcView = { code: string; name: string; factor: string; by: string; when: string };

const th = "px-3 py-2 text-left text-[11.5px] font-bold tracking-[.06em] text-ink-2 uppercase";
const Err = ({ text, id }: { text?: string; id?: string }) => (text ? <p id={id} className="mt-1 text-[12px] leading-snug text-danger" role="alert">{text}</p> : null);
const By = ({ by, when }: { by: string; when: string }) => <span className="text-ink-2">{by}<span className="block text-[11.5px] text-ink-3">{when}</span></span>;

function KmForm({ row, onCancel }: { row: KmView | null; onCancel: () => void }) {
  const [state, action, pending] = useActionState<CraFormState, FormData>(saveKmRates, null);
  const v = (k: string) => state?.values[k] ?? (k === "year" ? (row ? String(row.year) : "") : row?.rates[k] ?? "");
  const e = state?.errors ?? {};
  const key = row ? `km-${row.year}` : "km-new";
  return (
    <tr className="border-t border-sand-200 bg-navy-50/40" data-km-form={row?.year ?? "new"}>
      <td className="px-3 py-2" colSpan={6}>
        <form action={action} className="flex flex-wrap items-start gap-3" noValidate>
          <input type="hidden" name="new" value={row ? "false" : "true"} />
          <div className="grid max-w-[7rem] gap-1 text-[12px] text-ink-2">
            <label htmlFor={`${key}-year`}>Year</label>
            {row ? <><input type="hidden" name="year" value={row.year} /><span className="py-1.5 text-[13.5px] font-semibold text-ink tabular-nums">{row.year}</span></>
              : <input id={`${key}-year`} name="year" defaultValue={v("year")} inputMode="numeric" maxLength={4} placeholder="2026" autoFocus
                  aria-invalid={!!e.year} aria-describedby={e.year ? `${key}-year-err` : undefined}
                  className={`input input-compact w-24 tabular-nums ${e.year ? "border-danger" : ""}`} />}
            <Err text={e.year} id={`${key}-year-err`} />
          </div>
          {KM_COLUMNS.map(([k, l]) => (
            <div key={k} className="grid max-w-[11rem] gap-1 text-[12px] text-ink-2">
              <label htmlFor={`${key}-${k}`}>{l}</label>
              <input id={`${key}-${k}`} name={k} defaultValue={v(k)} inputMode="decimal" placeholder="0.00" autoFocus={!!row && k === "first_prov"}
                aria-label={`${l}${row ? `, ${row.year}` : ""}`} aria-invalid={!!e[k]} aria-describedby={e[k] ? `${key}-${k}-err` : undefined}
                className={`input input-compact w-28 text-right tabular-nums ${e[k] ? "border-danger" : ""}`} />
              <Err text={e[k]} id={`${key}-${k}-err`} />
            </div>
          ))}
          <div className="grid gap-1 pt-[19px]">
            <span className="flex gap-2"><button type="submit" className="btn btn-compact" disabled={pending}>{pending ? "Saving…" : row ? "Save" : "Add"}</button>
              <button type="button" className="btn-secondary btn-compact" onClick={onCancel}>Cancel</button></span>
            <Err text={e.form} />
          </div>
        </form>
      </td>
    </tr>
  );
}

export function KmTable({ rows }: { rows: KmView[] }) {
  const [open, setOpen] = useState<number | "new" | null>(null);
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="font-semibold">Per-km allowance rates</h2>
        {open !== "new" && <button type="button" className="btn-secondary btn-compact" onClick={() => setOpen("new")} data-km-add>+ Add a year</button>}
      </div>
      <table className="w-full min-w-[760px] text-[13.5px]">
        <thead><tr className="border-y border-sand-200"><th className={th}>Year</th>{KM_COLUMNS.map(([k, l]) => <th key={k} className={`${th} text-right`}>{l}</th>)}<th className={th}>Entered by</th></tr></thead>
        <tbody>
          {open === "new" && <KmForm row={null} onCancel={() => setOpen(null)} />}
          {rows.map((r) => (
            <Fragment key={r.year}>
              {open === r.year ? <KmForm row={r} onCancel={() => setOpen(null)} /> : (
                <tr className="cursor-pointer border-t border-sand-100 hover:bg-sand-50 focus-visible:bg-navy-50 focus-visible:outline-none" tabIndex={0}
                  title="Click to change" data-km-year={r.year}
                  onClick={() => setOpen(r.year)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpen(r.year); } }}>
                  <td className="px-3 py-2.5 font-semibold tabular-nums">{r.year}</td>
                  {KM_COLUMNS.map(([k]) => <td key={k} className="px-3 py-2.5 text-right tabular-nums">{r.rates[k]}</td>)}
                  <td className="px-3 py-2"><By by={r.by} when={r.when} /></td>
                </tr>
              )}
            </Fragment>
          ))}
          {!rows.length && open !== "new" && <tr><td colSpan={6} className="px-3 py-3 text-ink-3">No years yet. Add the CRA&rsquo;s rates for each year you need.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

export function ItcTable({ rows }: { rows: ItcView[] }) {
  const [state, action, pending] = useActionState<CraFormState, FormData>(saveItcFactors, null);
  const e = state?.errors ?? {};
  return (
    <form action={action} noValidate>
      <table className="w-full min-w-[640px] text-[13.5px]">
        <thead><tr className="border-y border-sand-200"><th className={th}>Province or territory</th><th className={th}>ITC factor</th><th className={th}>Entered by</th></tr></thead>
        <tbody>{PROVINCES.map((p) => {
          const r = rows.find((x) => x.code === p.code)!;
          return (
            <tr key={p.code} className="border-t border-sand-100 align-top" data-itc-province={p.code}>
              <td className="px-3 py-2.5"><label htmlFor={`itc-${p.code}`}>{p.name}</label></td>
              <td className="px-3 py-1.5">
                <input type="hidden" name={`was_${p.code}`} value={r.factor} />
                <input id={`itc-${p.code}`} name={`itc_${p.code}`} defaultValue={state?.values[p.code] ?? r.factor} aria-label={`ITC factor, ${p.name}`}
                  aria-invalid={!!e[p.code]} aria-describedby={e[p.code] ? `itc-${p.code}-err` : undefined}
                  className={`input input-compact w-32 tabular-nums ${e[p.code] ? "border-danger" : ""}`} />
                <Err text={e[p.code]} id={`itc-${p.code}-err`} />
              </td>
              <td className="px-3 py-2">{r.by ? <By by={r.by} when={r.when} /> : <span className="text-ink-3">Not entered</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button type="submit" className="btn btn-compact" disabled={pending} data-itc-save>{pending ? "Saving…" : "Save"}</button>
        <span className="text-[12.5px] text-ink-3">Saves every row you changed.</span>
        <Err text={e.form} />
      </div>
    </form>
  );
}
