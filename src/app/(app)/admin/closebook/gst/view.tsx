import type { ReactNode } from "react";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime, todayToronto } from "@/lib/dates";
import { CRA_QUICK_PAGE, CRA_QUICK_TABLE } from "@/lib/tax/cra-quick-rates";
import { fieldHelp, type SP, type View } from "../../settings-shell";
import { updateGstSettings } from "../actions";
import { addQuickRate, approveAllQuickRates, loadCraQuickRates, setQuickRateStatus } from "./actions";

// GST/HST settings (round 13, Hashim, Nov 14, 2026): CRA's due-date rule for each filing frequency, and the
// quick method's remittance rates and credit. Owners only.
// Round 17: two tabs on two pages (Closebook rules, Due dates; Sales tax rates, Quick method). The due dates
// and the credit post to the same action, so each form carries the other tab's current values as hidden
// fields: saving one tab never changes the other.
// Round 20 (Hashim, Nov 15, 2026): two remittance rates per province, Services and Goods for resale, loaded
// from CRA as pending and approved by an owner (cb_quick_rates), as "Rates we charge" works. A return uses
// the client's rate; until it is approved the return says it is missing and does not guess.
const PROVINCES: [string, string][] = [["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"]];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(Number(v) * 1e6) / 1e4));
const rateText = (v: number | null) => (v === null ? "Not set" : `${pct(v)}%`);

type QuickRow = { id: string; province: string; services_rate: number | null; goods_rate: number | null; effective_from: string | null; source_url: string | null; checked_on: string | null;
  status: string; approved_at: string | null; legacy: boolean; notes: string; created_at: string; checker: { full_name: string } | null; approver: { full_name: string } | null };

async function loadGst() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: s }, { data: rows }] = await Promise.all([
    supabase.from("cb_settings").select("gst_due_months_annual, gst_due_months_period, quick_credit_rate, quick_credit_limit").maybeSingle(),
    supabase.from("cb_quick_rates").select("id, province, services_rate, goods_rate, effective_from, source_url, checked_on, status, approved_at, legacy, notes, created_at, checker:checked_by(full_name), approver:approved_by(full_name)")
      .order("province").order("effective_from", { ascending: false, nullsFirst: false }),
  ]);
  const st = (s ?? {}) as { gst_due_months_annual?: number; gst_due_months_period?: number; quick_credit_rate?: number | null; quick_credit_limit?: number | null };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rates = ((rows ?? []) as unknown as QuickRow[]).map((r) => ({ ...r, services_rate: num(r.services_rate), goods_rate: num(r.goods_rate) }));
  return {
    dueAnnual: st.gst_due_months_annual ?? 3,
    duePeriod: st.gst_due_months_period ?? 1,
    creditRate: pct(st.quick_credit_rate),
    creditLimit: st.quick_credit_limit != null ? Number(st.quick_credit_limit) : null,
    rates,
  };
}

const row = (label: string, input: ReactNode) => (
  <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center sm:gap-6">
    <p className="font-medium">{label}</p>{input}
  </div>
);

const DUE = [
  { label: "Annual filers: months after the fiscal year end", hint: "CRA: an annual filer that is a corporation files and pays within three months of its year end." },
  { label: "Quarterly and monthly filers: months after the period end", hint: "CRA: monthly and quarterly filers file and pay within one month of the end of the period." },
];
const QUICK = [
  { label: "Credit rate", hint: "The credit on the first part of a fiscal year's eligible sales (line 107), as a percentage. Blank until you fill it from CRA's page." },
  { label: "Credit limit", hint: "The eligible sales a fiscal year the credit applies to, in dollars." },
  { label: "Services and Goods for resale", hint: "The rate line 101 is multiplied by, by the province of the client's permanent establishment where its supplies are made. Step 1 says which rate applies to the client (Services by default). A return uses the latest approved rate in effect on the first day of its period." },
  { label: "From", hint: "CRA's date: the rates apply to reporting periods beginning on or after it." },
];
const link = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">{text}</a>;

// Closebook rules, GST/HST due dates tab.
export async function GstDueDatesView(sp: SP): Promise<View> {
  const g = await loadGst();
  return {
    help: <><p>The due dates the GST/HST return uses (step 8). Check them against CRA&rsquo;s pages.</p>{fieldHelp(DUE)}</>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateGstSettings} className="card grid gap-5">
        <input type="hidden" name="back" value="/admin/closebook-rules?tab=due-dates" />
        <input type="hidden" name="credit_rate" value={g.creditRate} />
        <input type="hidden" name="credit_limit" value={g.creditLimit ?? ""} />
        {row(DUE[0].label, <input name="due_annual" className="input text-right" defaultValue={g.dueAnnual} inputMode="numeric" required />)}
        {row(DUE[1].label, <input name="due_period" className="input text-right" defaultValue={g.duePeriod} inputMode="numeric" required />)}
        <div><button className="btn">Save</button></div>
      </form>
    </>,
  };
}

// Sales tax rates, Quick method rates tab.
export async function QuickMethodView(sp: SP): Promise<View> {
  const g = await loadGst();
  const today = todayToronto();
  const current = (p: string) => g.rates.find((r) => r.province === p && r.status === "approved" && (r.effective_from ?? "") <= today);
  const pending = g.rates.filter((r) => r.status === "pending");
  const history = g.rates.filter((r) => r.status !== "pending");
  const source = (r: QuickRow) => (r.source_url ? link(r.source_url, "CRA page") : <span className="text-ink-3">Not recorded</span>);
  const read = (r: QuickRow) => (r.checked_on ? `${formatDate(r.checked_on)}${r.checker ? ` by ${r.checker.full_name}` : ""}` : "");
  const statusBtn = (id: string, status: "approved" | "retired", label: string, plain = false) => (
    <form action={setQuickRateStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} />
      <button className={plain ? "text-sm text-navy-700 underline" : "btn h-8 px-3 text-sm"} type="submit">{label}</button></form>
  );
  const craLoaded = CRA_QUICK_TABLE.rates.length > 0;
  return {
    help: <>
      <p>The quick method rates the GST/HST return uses (step 8). Each province has two rates: Services and Goods for resale. Step 1 says which one applies to the client. A rate is used only after an owner approves it. Until then, a quick method return says the rate is missing.</p>
      <div><h4>Load the CRA table</h4><p>Loads the rates from the {link(CRA_QUICK_PAGE, "CRA quick method guide (RC4058)")} as pending. Rows already loaded are skipped. Nothing is used until you approve.</p></div>
      <div><h4>Add rates</h4><p>Open the CRA guide, check the rates for the province, then enter them. They start as pending until an owner approves them.</p></div>
      {fieldHelp(QUICK)}
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card mb-6 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Province</th><th className="text-right">Services</th><th className="text-right">Goods for resale</th><th>From</th><th>Source</th><th>Read from CRA</th><th>Approved</th></tr></thead>
          <tbody>{PROVINCES.map(([code, name]) => {
            const r = current(code);
            return (
              <tr key={code}>
                <td className="font-medium">{name}</td>
                {r ? <>
                  <td className="text-right tabular-nums">{rateText(r.services_rate)}</td>
                  <td className="text-right tabular-nums">{rateText(r.goods_rate)}</td>
                  <td>{r.effective_from ? formatDate(r.effective_from) : "Every period"}</td>
                  <td>{source(r)}</td>
                  <td>{r.legacy ? <span className="text-ink-3">Typed before round 20</span> : read(r)}</td>
                  <td>{`${formatDateTime(r.approved_at)}${r.approver ? ` by ${r.approver.full_name}` : ""}`}</td>
                </> : <td colSpan={6} className="text-danger">None approved. A quick method return in this province says the rate is missing.</td>}
              </tr>
            );
          })}</tbody>
        </table>
      </section>

      {pending.length > 0 && (
        <section className="card mb-6 overflow-x-auto p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h2 className="font-semibold">Waiting for approval ({pending.length})</h2>
            <form action={approveAllQuickRates}><button className="btn" type="submit">Approve all</button></form>
          </div>
          <table className="table">
            <thead><tr><th>Province</th><th className="text-right">Services</th><th className="text-right">Goods for resale</th><th>From</th><th>Read from CRA</th><th>Loaded</th><th>Notes</th><th></th></tr></thead>
            <tbody>{pending.map((r) => (
              <tr key={r.id}>
                <td>{r.province}</td><td className="text-right tabular-nums">{rateText(r.services_rate)}</td><td className="text-right tabular-nums">{rateText(r.goods_rate)}</td>
                <td>{r.effective_from ? formatDate(r.effective_from) : ""}</td>
                <td>{read(r)} · {source(r)}</td><td>{formatDate(r.created_at)}</td><td>{r.notes}</td>
                <td className="text-right"><div className="flex items-center justify-end gap-3">{statusBtn(r.id, "approved", "Approve")}{statusBtn(r.id, "retired", "Reject", true)}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <form action={loadCraQuickRates} className="card mb-6 space-y-3">
        <h2 className="font-semibold">Load the CRA table</h2>
        {craLoaded ? <>
          <p className="text-sm">From {formatDate(CRA_QUICK_TABLE.effectiveFrom)}, read {formatDate(CRA_QUICK_TABLE.checkedOn)} from the {link(CRA_QUICK_PAGE, "CRA guide")}: {CRA_QUICK_TABLE.rates.map((r) => `${r.name} ${r.services}% services, ${r.goods}% goods`).join(" · ")}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-4 w-4 accent-navy-700" /> I checked this table against the CRA page. The rates wait for approval.</label>
          <button className="btn" type="submit">Load as pending</button>
        </> : <p className="text-sm">The CRA table is not in the app yet. Add the rates below from the {link(CRA_QUICK_PAGE, "CRA guide")}.</p>}
      </form>

      <form action={addQuickRate} className="card mb-6 space-y-4">
        <h2 className="font-semibold">Add rates</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label htmlFor="q_province" className="label">Province</label><select id="q_province" name="province" required className="input">{PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
          <div><label htmlFor="q_services" className="label">Services (%)</label><input id="q_services" name="services" inputMode="decimal" className="input" /></div>
          <div><label htmlFor="q_goods" className="label">Goods for resale (%)</label><input id="q_goods" name="goods" inputMode="decimal" className="input" /></div>
          <div><label htmlFor="q_from" className="label">From</label><input id="q_from" name="effective_from" type="date" required className="input" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
          <div><label htmlFor="q_src" className="label">CRA source page (canada.ca)</label><input id="q_src" name="source_url" defaultValue={CRA_QUICK_PAGE} required className="input" /></div>
          <div><label htmlFor="q_checked" className="label">Date read</label><input id="q_checked" name="checked_on" type="date" defaultValue={today} max={today} required className="input" /></div>
        </div>
        <div><label htmlFor="q_notes" className="label">Notes (optional)</label><input id="q_notes" name="notes" className="input" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-4 w-4 accent-navy-700" /> I checked these rates on the CRA page. My name is recorded as the checker.</label>
        <button className="btn" type="submit">Add as pending</button>
      </form>

      <form action={updateGstSettings} className="card mb-6 grid gap-5">
        <h2 className="font-semibold">Quick method credit</h2>
        <input type="hidden" name="back" value="/admin/sales-tax?tab=quick" />
        <input type="hidden" name="due_annual" value={g.dueAnnual} />
        <input type="hidden" name="due_period" value={g.duePeriod} />
        {row(QUICK[0].label, <div className="flex items-center gap-2"><input name="credit_rate" className="input text-right" defaultValue={g.creditRate} inputMode="decimal" /><span className="text-ink-3">%</span></div>)}
        {row(QUICK[1].label, <div className="flex items-center gap-2"><span className="text-ink-3">$</span><input name="credit_limit" className="input text-right" defaultValue={g.creditLimit != null ? g.creditLimit.toLocaleString("en-US") : ""} inputMode="decimal" /></div>)}
        <div><button className="btn">Save</button></div>
      </form>

      {history.length > 0 && (
        <section className="card overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">History</h2>
          <table className="table">
            <thead><tr><th>Province</th><th className="text-right">Services</th><th className="text-right">Goods for resale</th><th>From</th><th>Source</th><th>Status</th><th></th></tr></thead>
            <tbody>{history.map((r) => (
              <tr key={r.id}>
                <td>{r.province}</td><td className="text-right tabular-nums">{rateText(r.services_rate)}</td><td className="text-right tabular-nums">{rateText(r.goods_rate)}</td>
                <td>{r.effective_from ? formatDate(r.effective_from) : "Every period"}</td><td>{source(r)}</td><td className="capitalize">{r.status}</td>
                <td className="text-right">{r.status === "approved" && statusBtn(r.id, "retired", "Retire", true)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>,
  };
}
