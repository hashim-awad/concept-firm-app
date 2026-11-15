import type { ReactNode } from "react";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { fieldHelp, type SP, type View } from "../../settings-shell";
import { updateGstSettings } from "../actions";

// GST/HST settings (round 13, Hashim, Nov 14, 2026): CRA's due-date rule for each filing frequency, and the
// quick method's remittance rates and credit. Hashim fills the rates from CRA's page; until then a quick
// method return says they are missing and does not guess. Owners only.
// Round 17: two tabs on two pages (Closebook rules, Due dates; Sales tax rates, Quick method). Both post
// to the same action, so each form carries the other tab's current values as hidden fields: saving one
// tab never changes the other.
const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(Number(v) * 1e6) / 1e4));

async function loadGst() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: s }, { data: rates }] = await Promise.all([
    supabase.from("cb_settings").select("gst_due_months_annual, gst_due_months_period, quick_credit_rate, quick_credit_limit").maybeSingle(),
    supabase.from("cb_gst_quick_rates").select("province, rate"),
  ]);
  const st = (s ?? {}) as { gst_due_months_annual?: number; gst_due_months_period?: number; quick_credit_rate?: number | null; quick_credit_limit?: number | null };
  const rate = new Map(((rates ?? []) as { province: string; rate: number }[]).map((r) => [r.province, Number(r.rate)]));
  return {
    dueAnnual: st.gst_due_months_annual ?? 3,
    duePeriod: st.gst_due_months_period ?? 1,
    creditRate: pct(st.quick_credit_rate),
    creditLimit: st.quick_credit_limit != null ? Number(st.quick_credit_limit) : null,
    rate: (p: string) => pct(rate.get(p)),
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
  { label: "Remittance rates by province", hint: "The rate line 101 is multiplied by, for a business providing services, by the province of the supply. Blank: not set." },
];

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
        {PROVINCES.map((p) => <input key={p} type="hidden" name={`rate_${p}`} value={g.rate(p)} />)}
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
  return {
    help: <><p>The quick method rates the GST/HST return uses (step 8). Check them against CRA&rsquo;s pages. Until they are filled, a quick method return says they are missing.</p>{fieldHelp(QUICK)}</>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateGstSettings} className="card grid gap-5">
        <input type="hidden" name="back" value="/admin/sales-tax?tab=quick" />
        <input type="hidden" name="due_annual" value={g.dueAnnual} />
        <input type="hidden" name="due_period" value={g.duePeriod} />
        {row(QUICK[0].label, <div className="flex items-center gap-2"><input name="credit_rate" className="input text-right" defaultValue={g.creditRate} inputMode="decimal" /><span className="text-ink-3">%</span></div>)}
        {row(QUICK[1].label, <div className="flex items-center gap-2"><span className="text-ink-3">$</span><input name="credit_limit" className="input text-right" defaultValue={g.creditLimit != null ? g.creditLimit.toLocaleString("en-US") : ""} inputMode="decimal" /></div>)}
        <div>
          <p className="font-medium">{QUICK[2].label}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {PROVINCES.map((p) => (
              <label key={p} className="flex items-center gap-2"><span className="w-8 text-sm font-medium">{p}</span>
                <input name={`rate_${p}`} className="input input-compact text-right" style={{ width: "6rem" }} defaultValue={g.rate(p)} inputMode="decimal" /><span className="text-ink-3 text-sm">%</span></label>
            ))}
          </div>
        </div>
        <div><button className="btn">Save</button></div>
      </form>
    </>,
  };
}
