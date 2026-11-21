import { requireAdmin } from "@/lib/access";
import { SaveForm, SaveFormButton, SaveFormDiscard } from "@/components/save-state";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadCbSettings } from "@/lib/closebook/settings";
import { fieldHelp, type SP, type View } from "../../settings-shell";
import { updateCbSettings } from "../actions";

// Closebook rules, Thresholds tab (Phase 3 batch, section 7). Admins only.
export async function ThresholdsView(sp: SP): Promise<View> {
  await requireAdmin("closebook");
  const c = await loadCbSettings(await createClient());
  if (!c) return { help: null, body: <p className="card text-sm text-warning">Closebook settings are not loaded yet.</p> };
  const fields: [string, string, number, string, string?][] = [
    // CB2-0 step 5 (rule 7, no thresholds): the outstanding items, year-over-year flag, entry review and capital invoice
    // amounts are gone from Settings. Their stored values are sent back unchanged (hidden below); nothing reads them.
    ["t2_rounding", "Rounding allowed in the T2 tie-out", c.t2_rounding, "ProFile rounds each GIFI line to whole dollars. In step 8, a difference with ProFile on net income or total assets of this amount or less shows as rounding and does not block the sign-off. CCA and income tax must tie to the cent."],
    ["instalment_threshold", "Instalments: tax owing above which the client email mentions instalments", c.instalment_threshold, "Step 10's client email (Appendix C): when the year's federal or provincial tax is more than this, the email explains that the CRA asks for instalments the next year."],
    ["sh_repay_window_days", "Shareholder loans: repaid near year end", c.sh_repay_window_days, "Step 5's shareholder loan schedule: when a balance owed by the shareholder goes to nil or a credit within this many days before the year end, it goes to the reviewer to check it is not a series of loans and repayments.", "days"],
  ];
  const num = (id: string, label: string, value: number, _hint: string, unit = "$") => (
    <div key={id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center sm:gap-6">
      <label htmlFor={id} className="font-medium">{label}</label>
      <div className="flex items-center gap-2">{unit === "$" && <span className="text-ink-3">$</span>}<input id={id} name={id} defaultValue={unit === "$" ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : value} inputMode="decimal" required className="input text-right tabular-nums" />{unit === "%" && <span className="text-ink-3">%</span>}{unit === "days" && <span className="text-ink-3">days</span>}</div>
    </div>
  );
  return {
    help: <><p>The T2 rounding, the instalment amount in the client email and the shareholder loan window. They apply to every file not yet locked.</p>{fieldHelp(fields.map(([, label, , hint]) => ({ label, hint })))}</>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <SaveForm action={updateCbSettings} aria-label="Closebook thresholds" className="card grid gap-5">
        <input type="hidden" name="back" value="/admin/closebook/thresholds" />
        <input type="hidden" name="note1" value={c.note1_policy} />
        {([["recon", c.recon_outstanding_max], ["flag_amount", c.flag_amount], ["flag_percent", c.flag_percent], ["entry_review", c.entry_review_amount], ["capital_invoice", c.capital_invoice_amount]] as [string, number][]).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {fields.map((x) => num(...x))}
        <span className="inline-flex w-fit items-center gap-2"><SaveFormButton className="btn" /><SaveFormDiscard /></span>
      </SaveForm>
    </>,
  };
}
