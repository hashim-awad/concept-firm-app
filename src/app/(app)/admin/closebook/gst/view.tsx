import type { ReactNode } from "react";
import Link from "next/link";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime, todayToronto } from "@/lib/dates";
import { fieldHelp, type SP, type View } from "../../settings-shell";
import { updateGstSettings } from "../actions";
import { addQuickProvince, addQuickRate, approveAllQuickRates, decideQuickCredit, setQuickCredit, setQuickRateStatus } from "./actions";

// GST/HST settings (round 13, Hashim, Nov 14, 2026): CRA's due-date rule for each filing frequency, and the
// quick method's remittance rates and credit. Owners only.
// Round 17: two tabs on two pages (Closebook rules, Due dates; Sales tax rates, Quick method).
// Round 20 (Hashim, Nov 15, 2026; fixed before merge): benchmark QuickBooks Online, which shows only the tax
// agencies you use. The page lists only the provinces in use (Ontario, Alberta, British Columbia to start;
// "Add a province" adds one), one row each: Services, Goods for resale, From, Source, Approved. CRA's
// figures come pre-filled as drafts; an owner approves them with one click, and nothing applies until then.
// A missing rate shows "Not set" in grey; the return itself still flags a quick method return with no
// approved rate. The credit is one line above the table, with the same draft and approval.
const PROVINCES: Record<string, string> = { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon" };
const CRA_GUIDE = "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4058/quick-method-accounting-gst-hst.html";
const pctNum = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(Number(v) * 1e6) / 1e4));
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const month = (d: string | null) => (d ? MONTH.format(new Date(`${d}T00:00:00Z`)) : "");
// "CRA guide RC4058" on screen, the full title on hover.
const srcLink = (href: string, name: string | null | undefined) => (
  <a href={href} target="_blank" rel="noopener noreferrer" title={name || undefined} className="text-navy-700 underline">{name?.startsWith("CRA guide RC4058") ? "CRA guide RC4058" : name || "CRA page"}</a>
);
const money = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

type QuickRow = { id: string; province: string; services_rate: number | null; goods_rate: number | null; effective_from: string | null; source_url: string | null; source_name: string;
  checked_on: string | null; status: string; approved_at: string | null; legacy: boolean; notes: string; approver: { full_name: string } | null };
type Draft = { rate: number; limit: number; source_url: string; source_name?: string; checked_on: string };
type Credit = { rate: number | null; limit: number | null; draft: Draft | null; sourceUrl: string | null; sourceName: string; checkedOn: string | null; approvedAt: string | null; approver: string | null };

async function loadGst() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: s }, { data: rows }, { data: provs }] = await Promise.all([
    supabase.from("cb_settings").select("gst_due_months_annual, gst_due_months_period, quick_credit_rate, quick_credit_limit, quick_credit_draft, quick_credit_source_url, quick_credit_source_name, quick_credit_checked_on, quick_credit_approved_at, approver:quick_credit_approved_by(full_name)").maybeSingle(),
    supabase.from("cb_quick_rates").select("id, province, services_rate, goods_rate, effective_from, source_url, source_name, checked_on, status, approved_at, legacy, notes, approver:approved_by(full_name)")
      .order("province").order("effective_from", { ascending: false, nullsFirst: false }),
    supabase.from("cb_quick_provinces").select("province"),
  ]);
  const st = (s ?? {}) as { gst_due_months_annual?: number; gst_due_months_period?: number; quick_credit_rate?: number | null; quick_credit_limit?: number | null; quick_credit_draft?: Draft | null;
    quick_credit_source_url?: string | null; quick_credit_source_name?: string; quick_credit_checked_on?: string | null; quick_credit_approved_at?: string | null; approver?: { full_name: string } | null };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rates = ((rows ?? []) as unknown as QuickRow[]).map((r) => ({ ...r, services_rate: num(r.services_rate), goods_rate: num(r.goods_rate) }));
  const credit: Credit = { rate: num(st.quick_credit_rate), limit: num(st.quick_credit_limit), draft: st.quick_credit_draft ?? null, sourceUrl: st.quick_credit_source_url ?? null,
    sourceName: st.quick_credit_source_name ?? "", checkedOn: st.quick_credit_checked_on ?? null, approvedAt: st.quick_credit_approved_at ?? null, approver: st.approver?.full_name ?? null };
  const provinces = ((provs ?? []) as { province: string }[]).map((p) => p.province).sort((a, b) => PROVINCES[a].localeCompare(PROVINCES[b]));
  return { dueAnnual: st.gst_due_months_annual ?? 3, duePeriod: st.gst_due_months_period ?? 1, rates, credit, provinces };
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
  { label: "Services and Goods for resale", hint: "The rate the return multiplies the client's sales (tax included) by, for the province of its permanent establishment. Step 1 says which rate applies to the client (Services by default)." },
  { label: "From", hint: "CRA's date: the rates apply to reporting periods beginning on or after it. All periods when blank." },
  { label: "Drafts", hint: "New figures wait as drafts. The approved rate applies until you approve the draft. Nothing applies until an owner approves it." },
  { label: "Not set", hint: "No approved rate. A quick method return for a client in that province says the rate is missing and does not guess." },
];
const link = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">{text}</a>;

// Closebook rules, GST/HST due dates tab. Round 20: the credit is no longer saved here.
export async function GstDueDatesView(sp: SP): Promise<View> {
  const g = await loadGst();
  return {
    help: <><p>The due dates the GST/HST return uses (step 8). Check them against CRA&rsquo;s pages.</p>{fieldHelp(DUE)}</>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateGstSettings} className="card grid gap-5">
        <input type="hidden" name="back" value="/admin/closebook-rules?tab=due-dates" />
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
  const edit = typeof sp.edit === "string" ? sp.edit : "";
  const approved = (p: string) => g.rates.find((r) => r.province === p && r.status === "approved" && (r.effective_from ?? "") <= today);
  const draft = (p: string) => g.rates.find((r) => r.province === p && r.status === "pending");
  const drafts = g.rates.filter((r) => r.status === "pending").length + (g.credit.draft ? 1 : 0);
  const earlier = g.rates.filter((r) => r.status === "retired");
  const unused = Object.keys(PROVINCES).filter((p) => !g.provinces.includes(p)).sort((a, b) => PROVINCES[a].localeCompare(PROVINCES[b]));

  const notSet = <span className="text-ink-3">Not set</span>;
  const rate = (v: number | null) => (v === null ? notSet : `${pctNum(v)}%`);
  const source = (r: QuickRow) => r.source_url
    ? <span className="whitespace-nowrap">{srcLink(r.source_url, r.source_name)}{r.checked_on && <span className="text-ink-3"> · checked {month(r.checked_on)}</span>}</span>
    : <span className="text-ink-3">Not recorded</span>;
  const who = (name: string | null | undefined, at: string | null) => `${name ?? "An owner"}, ${formatDateTime(at)}`;
  const statusForm = (id: string, status: "approved" | "retired", label: string, plain = false) => (
    <form action={setQuickRateStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} />
      <button className={plain ? "text-sm text-ink-2 underline" : "btn h-8 px-3 text-sm"} type="submit">{label}</button></form>
  );
  const waiting = <span className="inline-flex items-center whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">Draft, waiting for approval</span>;
  const editLink = (key: string) => <Link href={`/admin/sales-tax?tab=quick&edit=${key}`} scroll={false} className="text-sm text-navy-700 underline">Edit</Link>;

  // The credit, one line.
  const c = g.credit;
  const creditText = (rateV: number | null, limitV: number | null) => rateV === null || limitV === null
    ? <>Credit: {notSet}</>
    : <>Credit: {pctNum(rateV)}% on the first {money(limitV)} of eligible sales each fiscal year</>;

  const editForm = (p: string) => {
    const cur = draft(p) ?? approved(p);
    return (
      <form action={addQuickRate} className="space-y-3 rounded-lg border border-sand-200 bg-surface p-4">
        <input type="hidden" name="province" value={p} />
        <p className="font-medium">New rates for {PROVINCES[p]}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label htmlFor="q_services" className="label">Services (%)</label><input id="q_services" name="services" inputMode="decimal" defaultValue={pctNum(cur?.services_rate)} className="input" /></div>
          <div><label htmlFor="q_goods" className="label">Goods for resale (%)</label><input id="q_goods" name="goods" inputMode="decimal" defaultValue={pctNum(cur?.goods_rate)} className="input" /></div>
          <div><label htmlFor="q_from" className="label">From (optional)</label><input id="q_from" name="effective_from" type="date" className="input" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
          <div><label htmlFor="q_src" className="label">CRA source page (canada.ca)</label><input id="q_src" name="source_url" defaultValue={CRA_GUIDE} required className="input" /></div>
          <div><label htmlFor="q_checked" className="label">Date checked</label><input id="q_checked" name="checked_on" type="date" defaultValue={today} max={today} required className="input" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-4 w-4 accent-navy-700" /> I checked these rates on the CRA page. They wait for approval.</label>
        <div className="flex items-center gap-3"><button className="btn" type="submit">Save as draft</button><Link href="/admin/sales-tax?tab=quick" scroll={false} className="text-sm text-ink-2 underline">Cancel</Link></div>
      </form>
    );
  };

  return {
    help: <>
      <p>The quick method rates the GST/HST return uses (step 8). CRA sets them; check them once a year in the {link(CRA_GUIDE, "CRA guide RC4058")}.</p>
      <p>Only the provinces you use are listed. Add a province when a client needs it.</p>
      {fieldHelp(QUICK)}
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card overflow-x-auto p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="space-y-1">
            {/* The credit, one line: the approved figures, or the draft while nothing is approved. */}
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {c.rate !== null ? creditText(c.rate, c.limit) : c.draft ? creditText(Number(c.draft.rate), Number(c.draft.limit)) : creditText(null, null)}
              {c.rate === null && c.draft && waiting}
              {editLink("credit")}
            </p>
            {c.rate !== null && (
              <p className="text-sm text-ink-2">{c.sourceUrl && <>{srcLink(c.sourceUrl, c.sourceName)}{c.checkedOn && <> · checked {month(c.checkedOn)}</>} · </>}Approved by {who(c.approver, c.approvedAt)}</p>
            )}
            {c.draft && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
                {c.rate !== null && <>{waiting}<span>New: {pctNum(c.draft.rate)}% on the first {money(Number(c.draft.limit))}</span></>}
                <span>{srcLink(c.draft.source_url, c.draft.source_name)} · checked {month(c.draft.checked_on)}</span>
                <form action={decideQuickCredit}><input type="hidden" name="decision" value="approve" /><button className="btn h-8 px-3 text-sm" type="submit">Approve</button></form>
                <form action={decideQuickCredit}><input type="hidden" name="decision" value="reject" /><button className="text-sm text-ink-2 underline" type="submit">Reject</button></form>
              </div>
            )}
          </div>
          {drafts > 0 && (
            <form action={approveAllQuickRates} className="flex items-center gap-3">
              <span className="text-sm text-ink-2">{drafts} waiting for approval</span>
              <button className="btn" type="submit">Approve all</button>
            </form>
          )}
        </div>
        {edit === "credit" && (
          <form action={setQuickCredit} className="mx-5 mb-4 space-y-3 rounded-lg border border-sand-200 bg-surface p-4">
            <p className="font-medium">Credit</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="c_rate" className="label">Credit (%)</label><input id="c_rate" name="rate" inputMode="decimal" defaultValue={pctNum(c.draft?.rate ?? c.rate)} className="input" required /></div>
              <div><label htmlFor="c_limit" className="label">On the first ($ of eligible sales each fiscal year)</label><input id="c_limit" name="limit" inputMode="decimal" defaultValue={(c.draft?.limit ?? c.limit ?? "").toLocaleString("en-US")} className="input" required /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
              <div><label htmlFor="c_src" className="label">CRA source page (canada.ca)</label><input id="c_src" name="source_url" defaultValue={CRA_GUIDE} required className="input" /></div>
              <div><label htmlFor="c_checked" className="label">Date checked</label><input id="c_checked" name="checked_on" type="date" defaultValue={today} max={today} required className="input" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-4 w-4 accent-navy-700" /> I checked the credit on the CRA page. It waits for approval.</label>
            <div className="flex items-center gap-3"><button className="btn" type="submit">Save as draft</button><Link href="/admin/sales-tax?tab=quick" scroll={false} className="text-sm text-ink-2 underline">Cancel</Link></div>
          </form>
        )}

        <table className="table">
          <thead><tr><th>Province</th><th className="text-right">Services</th><th className="text-right">Goods for resale</th><th>From</th><th>Source</th><th>Approved</th><th></th></tr></thead>
          <tbody>{g.provinces.map((p) => {
            const a = approved(p), d = draft(p);
            const cells = (r: QuickRow | undefined, first: boolean) => <>
              <td className={first ? "font-medium" : "pl-8 text-sm text-ink-2"}>{first ? PROVINCES[p] : "New rates"}</td>
              <td className="text-right tabular-nums">{r ? rate(r.services_rate) : notSet}</td>
              <td className="text-right tabular-nums">{r ? rate(r.goods_rate) : notSet}</td>
              <td className="whitespace-nowrap">{r ? (r.effective_from ? formatDate(r.effective_from) : "All periods") : ""}</td>
              <td>{r ? source(r) : ""}</td>
            </>;
            return [
              a || !d ? (
                <tr key={`${p}-a`}>
                  {cells(a, true)}
                  <td>{a ? who(a.approver?.full_name, a.approved_at) : ""}</td>
                  <td className="text-right">{d ? "" : editLink(p)}</td>
                </tr>
              ) : null,
              d ? (
                <tr key={`${p}-d`} className="bg-warning-soft/40">
                  {cells(d, !a)}
                  <td>{waiting}</td>
                  <td className="text-right"><div className="flex items-center justify-end gap-3">{statusForm(d.id, "approved", "Approve")}{statusForm(d.id, "retired", "Reject", true)}{editLink(p)}</div></td>
                </tr>
              ) : null,
              edit === p ? <tr key={`${p}-e`}><td colSpan={7}>{editForm(p)}</td></tr> : null,
            ];
          })}</tbody>
        </table>

        <div className="border-t border-sand-200 px-5 py-3">
          {edit === "add" ? (
            <form action={addQuickProvince} className="flex flex-wrap items-end gap-3">
              <div><label htmlFor="add_p" className="label">Province</label>
                <select id="add_p" name="province" required className="input">{unused.map((p) => <option key={p} value={p}>{PROVINCES[p]}</option>)}</select></div>
              <button className="btn" type="submit">Add</button>
              <Link href="/admin/sales-tax?tab=quick" scroll={false} className="text-sm text-ink-2 underline">Cancel</Link>
            </form>
          ) : unused.length > 0 && <Link href="/admin/sales-tax?tab=quick&edit=add" scroll={false} className="text-sm font-medium text-navy-700">+ Add a province</Link>}
        </div>
      </section>

      {earlier.length > 0 && (
        <details className="card mt-6 p-0">
          <summary className="cursor-pointer px-5 py-3 font-semibold">Earlier rates ({earlier.length})</summary>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Province</th><th className="text-right">Services</th><th className="text-right">Goods for resale</th><th>From</th><th>Source</th><th>Note</th></tr></thead>
              <tbody>{earlier.map((r) => (
                <tr key={r.id}>
                  <td>{PROVINCES[r.province] ?? r.province}</td><td className="text-right tabular-nums">{rate(r.services_rate)}</td><td className="text-right tabular-nums">{rate(r.goods_rate)}</td>
                  <td>{r.effective_from ? formatDate(r.effective_from) : "All periods"}</td><td>{source(r)}</td><td className="text-sm text-ink-2">{r.notes}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </>,
  };
}
