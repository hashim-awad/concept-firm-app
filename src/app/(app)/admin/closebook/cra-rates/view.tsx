import { Fragment } from "react";
import Link from "next/link";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { messageFrom } from "@/lib/messages";
import { KM_COLUMNS, PROVINCES, describeCraChange, factor, rate, type ItcRow, type KmRow } from "@/lib/closebook/cra-rates";
import { saveItcFactor, saveKmRates } from "../actions";
import type { SP, View } from "../../settings-shell";

// Piece 1 of the step 5 restructure (Hashim, Nov 18, 2026; benchmark CaseWare Cloud's firm-level settings, where
// the firm keeps the rates its working papers use). Closebook rules › CRA rates, owners only (round 17: the menu
// shows the tab only to owners; no lock icons). The per-km allowance rates by calendar year and the ITC factor on
// allowances and reimbursements per province. The firm types the rates; nothing is loaded. Nothing reads them yet:
// the Vehicle allowance schedule will (piece 3). Every add or change is in Settings › Activity log, and the latest
// show in the History list here, as on Sales tax rates.
const TAB = "/admin/closebook-rules?tab=cra-rates";
const one = (v: SP[string]) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function CraRatesView(sp: SP): Promise<View> {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: km }, { data: itc }, { data: staff }, { data: log }] = await Promise.all([
    supabase.from("cb_cra_km_rates").select("*").order("year", { ascending: false }),
    supabase.from("cb_cra_itc_factors").select("*"),
    supabase.from("staff").select("id, full_name"),
    supabase.from("activity_log").select("id, occurred_at, actor_id, action, entity_type, details")
      .in("entity_type", ["cb_cra_km_rates", "cb_cra_itc_factors"]).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(30),
  ]);
  const who = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  const years = (km ?? []) as KmRow[];
  const factors = new Map(((itc ?? []) as ItcRow[]).map((r) => [r.province, r]));
  const edit = one(sp.edit), adding = one(sp.add) === "1", itcOpen = one(sp.itc);
  const by = (r: { entered_by: string | null; updated_by: string | null; updated_at: string | null; entered_at: string }) => {
    const id = r.updated_by ?? r.entered_by;
    return <span className="text-ink-2">{id ? who.get(id) ?? "Unknown" : ""}<span className="block text-[11.5px] text-ink-3">{formatDateTime(r.updated_at ?? r.entered_at)}</span></span>;
  };
  const th = "px-3 py-2 text-left text-[11.5px] font-bold tracking-[.06em] text-ink-2 uppercase";
  const rateInput = (name: string, label: string, value: unknown) => (
    <input name={name} aria-label={label} defaultValue={rate(value)} inputMode="decimal" required placeholder="0.00" className="input input-compact w-24 text-right tabular-nums" />
  );
  // One row as a form: a year being added or changed.
  const formRow = (r: Partial<KmRow> | null) => (
    <tr className="border-t border-sand-200 bg-navy-50/40" data-km-form={r?.year ?? "new"}>
      <td className="px-3 py-2" colSpan={6}>
        <form action={saveKmRates} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="new" value={r ? "false" : "true"} />
          <label className="grid gap-1 text-[12px] text-ink-2">Year
            {r ? <><input type="hidden" name="year" value={r.year} /><span className="py-1.5 text-[13.5px] font-semibold text-ink tabular-nums">{r.year}</span></>
              : <input name="year" aria-label="Year" inputMode="numeric" required maxLength={4} placeholder="2026" className="input input-compact w-20 tabular-nums" />}</label>
          {KM_COLUMNS.map(([k, l]) => <label key={k} className="grid gap-1 text-[12px] text-ink-2">{l}{rateInput(k, `${l}${r ? `, ${r.year}` : ""}`, r?.[k])}</label>)}
          <span className="flex gap-2 pb-0.5"><button type="submit" className="btn btn-compact">{r ? "Save" : "Add"}</button>
            <Link href={TAB} className="btn-secondary btn-compact">Cancel</Link></span>
        </form>
      </td>
    </tr>
  );

  return {
    help: <>
      <p>The CRA rates the schedules use. Owners type them in from the CRA. Nothing uses them yet: the Vehicle allowance schedule will.</p>
      <p><b>Per-km allowance rates</b>: dollars per km for each calendar year, for the first 5,000 km and for each km after, in the provinces and in the territories.</p>
      <p><b>ITC factor</b>: the share of an allowance or reimbursement that is GST/HST, as a fraction, for example 13/113 in Ontario.</p>
      <p>Every add and change is kept in Settings › Activity log, with who, when, and the old and new values.</p>
    </>,
    body: <div className="grid gap-5">
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card overflow-x-auto p-0" aria-label="Per-km allowance rates" data-km-rates>
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 className="font-semibold">Per-km allowance rates</h2>
          {!adding && <Link href={`${TAB}&add=1`} className="btn-secondary btn-compact" data-km-add>+ Add a year</Link>}
        </div>
        <table className="w-full min-w-[760px] text-[13.5px]">
          <thead><tr className="border-y border-sand-200"><th className={th}>Year</th>{KM_COLUMNS.map(([k, l]) => <th key={k} className={`${th} text-right`}>{l}</th>)}<th className={th}>Entered by</th></tr></thead>
          <tbody>
            {adding && formRow(null)}
            {years.map((r) => r.year === Number(edit) ? <Fragment key={r.year}>{formRow(r)}</Fragment> : (
              <tr key={r.year} className="border-t border-sand-100" data-km-year={r.year}>
                <td className="px-3 py-2 font-semibold tabular-nums">{r.year} <Link href={`${TAB}&edit=${r.year}`} className="ml-2 text-[12px] font-normal text-navy-700 hover:underline" aria-label={`Change ${r.year}`}>Change</Link></td>
                {KM_COLUMNS.map(([k]) => <td key={k} className="px-3 py-2 text-right tabular-nums">{rate(r[k])}</td>)}
                <td className="px-3 py-2">{by(r)}</td>
              </tr>
            ))}
            {!years.length && !adding && <tr><td colSpan={6} className="px-3 py-3 text-ink-3">No years yet. Add the CRA&rsquo;s rates for each year you need.</td></tr>}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[12.5px] text-ink-3" data-km-source>Source: CRA&rsquo;s prescribed per-km rates (section 7306 of the Income Tax Regulations).</p>
      </section>

      <section className="card overflow-x-auto p-0" aria-label="ITC factor on allowances and reimbursements" data-itc>
        <h2 className="px-5 pt-4 pb-2 font-semibold">ITC factor on allowances and reimbursements</h2>
        <table className="w-full min-w-[640px] text-[13.5px]">
          <thead><tr className="border-y border-sand-200"><th className={th}>Province or territory</th><th className={th}>ITC factor</th><th className={th}>Entered by</th></tr></thead>
          <tbody>{PROVINCES.map((p) => {
            const r = factors.get(p.code);
            return (
              <tr key={p.code} className="border-t border-sand-100" data-itc-province={p.code}>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-1.5">
                  <form action={saveItcFactor} className="flex items-center gap-2">
                    <input type="hidden" name="province" value={p.code} />
                    <input name="factor" aria-label={`ITC factor, ${p.name}`} defaultValue={factor(r)} autoFocus={itcOpen === p.code}
                      className="input input-compact w-28 tabular-nums" />
                    <button type="submit" className="btn-secondary btn-compact">Save</button>
                  </form>
                </td>
                <td className="px-3 py-2">{r ? by(r) : <span className="text-ink-3">Not entered</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>

      <section className="card overflow-x-auto p-0" aria-label="History" data-cra-history>
        <h2 className="px-5 pt-4 pb-2 font-semibold">History</h2>
        <table className="w-full min-w-[640px] text-[13.5px]">
          <thead><tr className="border-y border-sand-200"><th className={th}>When</th><th className={th}>Who</th><th className={th}>Change</th></tr></thead>
          <tbody>
            {((log ?? []) as { id: number; occurred_at: string; actor_id: string | null; action: string; entity_type: string; details: { old?: Record<string, unknown>; new?: Record<string, unknown> } }[]).map((e) => (
              <tr key={e.id} className="border-t border-sand-100">
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{formatDateTime(e.occurred_at)}</td>
                <td className="px-3 py-2">{e.actor_id ? who.get(e.actor_id) ?? "Unknown" : "System"}</td>
                <td className="px-3 py-2">{describeCraChange(e.entity_type, e.action, e.details?.old ?? {}, e.details?.new ?? {})}</td>
              </tr>
            ))}
            {!(log ?? []).length && <tr><td colSpan={3} className="px-3 py-3 text-ink-3">No changes yet.</td></tr>}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[12.5px] text-ink-3">The latest 30 changes. All of them are in <Link href="/admin/activity" className="text-navy-700 hover:underline">Activity log</Link>.</p>
      </section>
    </div>,
  };
}

