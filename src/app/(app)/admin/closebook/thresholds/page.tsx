import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadCbSettings } from "@/lib/closebook/settings";
import { updateCbSettings } from "../actions";
import { SettingsHelp, fieldHelp } from "../settings-help";

// Settings, Closebook, Thresholds (Phase 3 batch, section 7). Owners only.
export default async function ThresholdsPage({ searchParams }: PageProps<"/admin/closebook/thresholds">) {
  await requireOwner();
  const sp = await searchParams;
  const c = await loadCbSettings(await createClient());
  if (!c) return <PageHeader title="Thresholds" description="Closebook settings are not loaded yet." />;
  const fields: [string, string, number, string, string?][] = [
    ["recon", "Bank reconciliation: outstanding items", c.recon_outstanding_max, "When an account's outstanding items total more than this, the next month's statement must show they cleared."],
    ["flag_amount", "Year-over-year flag: amount", c.flag_amount, "A line is flagged when it changed by more than this amount and by more than the percentage below. Both conditions."],
    ["flag_percent", "Year-over-year flag: percentage", c.flag_percent, "The percentage part of the same rule.", "%"],
    ["entry_review", "Entries the reviewer must approve", c.entry_review_amount, "Any entry over this amount goes to the reviewer. Free entries always do."],
    ["capital_invoice", "Capital additions: invoice needed", c.capital_invoice_amount, "Asset additions over this amount need the invoice attached."],
    ["t2_rounding", "Rounding allowed in the T2 tie-out", c.t2_rounding, "ProFile rounds each GIFI line to whole dollars. In step 8, a difference with ProFile on net income or total assets of this amount or less shows as rounding and does not block the sign-off. CCA and income tax must tie to the cent."],
    ["instalment_threshold", "Instalments: tax threshold in the client email", c.instalment_threshold, "Step 10's client email (Appendix C): when the year's federal or provincial tax is more than this, the email explains that the CRA asks for instalments the next year."],
    ["sh_repay_window_days", "Shareholder loans: repaid near year end", c.sh_repay_window_days, "Step 5's shareholder loan schedule: when a balance owed by the shareholder goes to nil or a credit within this many days before the year end, it goes to the reviewer to check it is not a series of loans and repayments.", "days"],
  ];
  const num = (id: string, label: string, value: number, _hint: string, unit = "$") => (
    <div key={id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center sm:gap-6">
      <label htmlFor={id} className="font-medium">{label}</label>
      <div className="flex items-center gap-2">{unit === "$" && <span className="text-ink-3">$</span>}<input id={id} name={id} defaultValue={unit === "$" ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : value} inputMode="decimal" required className="input text-right tabular-nums" />{unit === "%" && <span className="text-ink-3">%</span>}{unit === "days" && <span className="text-ink-3">days</span>}</div>
    </div>
  );
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Thresholds" actions={<SettingsHelp title="Thresholds"><p>The amounts that send work to the reviewer or need proof. They apply to every file not yet locked.</p>{fieldHelp(fields.map(([, label, , hint]) => ({ label, hint })))}</SettingsHelp>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateCbSettings} className="card grid gap-5">
        <input type="hidden" name="back" value="/admin/closebook/thresholds" />
        <input type="hidden" name="note1" value={c.note1_policy} />
        {fields.map((x) => num(...x))}
        <button type="submit" className="btn w-fit">Save thresholds</button>
      </form>
    </>
  );
}
