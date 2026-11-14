import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { updateGstSettings } from "../actions";

// Settings, Closebook, GST/HST (round 13, Hashim, Nov 14, 2026): CRA's due-date rule for each filing
// frequency, and the quick method's remittance rates and credit. Hashim fills the rates from CRA's page;
// until then a quick method return says they are missing and does not guess. Owners only.
const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(Number(v) * 1e6) / 1e4));

export default async function GstSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: s }, { data: rates }] = await Promise.all([
    supabase.from("cb_settings").select("gst_due_months_annual, gst_due_months_period, quick_credit_rate, quick_credit_limit").maybeSingle(),
    supabase.from("cb_gst_quick_rates").select("province, rate"),
  ]);
  const st = (s ?? {}) as { gst_due_months_annual?: number; gst_due_months_period?: number; quick_credit_rate?: number | null; quick_credit_limit?: number | null };
  const rate = new Map(((rates ?? []) as { province: string; rate: number }[]).map((r) => [r.province, Number(r.rate)]));
  const row = (label: string, hint: string, input: React.ReactNode) => (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center sm:gap-6">
      <div><p className="font-medium">{label}</p><p className="text-sm text-ink-2">{hint}</p></div>{input}
    </div>
  );
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="GST/HST" description="The due dates and the quick method rates the GST/HST return uses (step 8). Check them against CRA's pages." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateGstSettings} className="card grid gap-5">
        <h2 className="font-semibold">Due dates</h2>
        {row("Annual filers: months after the fiscal year end", "CRA: an annual filer that is a corporation files and pays within three months of its year end.",
          <input name="due_annual" className="input text-right" defaultValue={st.gst_due_months_annual ?? 3} inputMode="numeric" required />)}
        {row("Quarterly and monthly filers: months after the period end", "CRA: monthly and quarterly filers file and pay within one month of the end of the period.",
          <input name="due_period" className="input text-right" defaultValue={st.gst_due_months_period ?? 1} inputMode="numeric" required />)}
        <h2 className="font-semibold">Quick method</h2>
        {row("Credit rate", "The credit on the first part of a fiscal year's eligible sales (line 107), as a percentage. Blank until you fill it from CRA's page.",
          <div className="flex items-center gap-2"><input name="credit_rate" className="input text-right" defaultValue={pct(st.quick_credit_rate)} inputMode="decimal" /><span className="text-ink-3">%</span></div>)}
        {row("Credit limit", "The eligible sales a fiscal year the credit applies to, in dollars.",
          <div className="flex items-center gap-2"><span className="text-ink-3">$</span><input name="credit_limit" className="input text-right" defaultValue={st.quick_credit_limit != null ? Number(st.quick_credit_limit).toLocaleString("en-US") : ""} inputMode="decimal" /></div>)}
        <div>
          <p className="font-medium">Remittance rates by province</p>
          <p className="text-sm text-ink-2">The rate line 101 is multiplied by, for a business providing services, by the province of the supply. Blank: not set.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {PROVINCES.map((p) => (
              <label key={p} className="flex items-center gap-2"><span className="w-8 text-sm font-medium">{p}</span>
                <input name={`rate_${p}`} className="input input-compact text-right" style={{ width: "6rem" }} defaultValue={pct(rate.get(p))} inputMode="decimal" /><span className="text-ink-3 text-sm">%</span></label>
            ))}
          </div>
        </div>
        <div><button className="btn">Save</button></div>
      </form>
    </>
  );
}
