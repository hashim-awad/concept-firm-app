import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadCbSettings } from "@/lib/closebook/settings";
import { updateCbSettings } from "../actions";

// Settings, Closebook, Thresholds (Phase 3 batch, section 7). Owners only.
export default async function ThresholdsPage({ searchParams }: PageProps<"/admin/closebook/thresholds">) {
  await requireOwner();
  const sp = await searchParams;
  const c = await loadCbSettings(await createClient());
  if (!c) return <PageHeader title="Thresholds" description="Closebook settings are not loaded yet." />;
  const num = (id: string, label: string, value: number, hint: string, unit = "$") => (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center sm:gap-6">
      <div><label htmlFor={id} className="font-medium">{label}</label><p className="text-sm text-ink-2">{hint}</p></div>
      <div className="flex items-center gap-2">{unit === "$" && <span className="text-ink-3">$</span>}<input id={id} name={id} defaultValue={unit === "$" ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : value} inputMode="decimal" required className="input text-right tabular-nums" />{unit === "%" && <span className="text-ink-3">%</span>}{unit === "days" && <span className="text-ink-3">days</span>}</div>
    </div>
  );
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Thresholds" description="The amounts that send work to the reviewer or need proof. They apply to every file not yet locked." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateCbSettings} className="card grid gap-5">
        <input type="hidden" name="back" value="/admin/closebook/thresholds" />
        <input type="hidden" name="note1" value={c.note1_policy} />
        {num("recon", "Bank reconciliation: outstanding items", c.recon_outstanding_max, "When an account's outstanding items total more than this, the next month's statement must show they cleared.")}
        {num("flag_amount", "Year-over-year flag: amount", c.flag_amount, "A line is flagged when it changed by more than this amount and by more than the percentage below. Both conditions.")}
        {num("flag_percent", "Year-over-year flag: percentage", c.flag_percent, "The percentage part of the same rule.", "%")}
        {num("entry_review", "Entries the reviewer must approve", c.entry_review_amount, "Any entry over this amount goes to the reviewer. Free entries always do.")}
        {num("capital_invoice", "Capital additions: invoice needed", c.capital_invoice_amount, "Asset additions over this amount need the invoice attached.")}
        {num("t2_rounding", "Rounding allowed in the T2 tie-out", c.t2_rounding, "ProFile rounds each GIFI line to whole dollars. In step 8, a difference with ProFile on net income or total assets of this amount or less shows as rounding and does not block the sign-off. CCA and income tax must tie to the cent.")}
        {num("instalment_threshold", "Instalments: tax threshold in the client email", c.instalment_threshold, "Step 10's client email (Appendix C): when the year's federal or provincial tax is more than this, the email explains that the CRA asks for instalments the next year.")}
        {num("sh_repay_window_days", "Shareholder loans: repaid near year end", c.sh_repay_window_days, "Step 5's shareholder loan schedule: when a balance owed by the shareholder goes to nil or a credit within this many days before the year end, it goes to the reviewer to check it is not a series of loans and repayments.", "days")}
        <button type="submit" className="btn w-fit">Save thresholds</button>
      </form>
    </>
  );
}
