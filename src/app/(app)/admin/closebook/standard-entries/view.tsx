import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { deleteStandardEntry, saveStandardEntry } from "../actions";
import { FIRM_TAX_MODE } from "@/lib/closebook/vendor";
import type { SP, View } from "../../settings-shell";


type Std = { id: string; name: string; kind: string; debit_account: string; credit_account: string; memo: string; wp_ref: string; reverse_next_year: boolean; tax_mode: string };

// Standard entries (Hashim, Nov 15, 2026, layout item 6). Owners set the accounts, type, memo and W/P ref;
// in step 5 staff pick one and enter the amount only. Round 17: no Reason field; the action works it out
// from the type and the reverse box, as the journal entry dialog does (round 15b). Owners only.
export async function StandardEntriesView(sp: SP): Promise<View> {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: list }, { data: chart }] = await Promise.all([
    supabase.from("cb_standard_entries").select("id, name, kind, debit_account, credit_account, memo, wp_ref, reverse_next_year, tax_mode").eq("style", "simple").order("sort_order"),
    supabase.from("cb_chart_accounts").select("number, name").order("sort_order"),
  ]);
  const accounts = (chart ?? []) as { number: string; name: string }[];
  const fields = (e: Partial<Std>) => (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="grid gap-1 text-sm">Name<input name="name" defaultValue={e.name} required minLength={3} maxLength={80} className="input" /></label>
        <label className="grid gap-1 text-sm">Type<select name="kind" defaultValue={e.kind ?? "AJE"} className="input"><option>AJE</option><option>TJE</option></select></label>
      </div>
      {/* Firm-wide, so never a provincial code (round 3 item 1): the client's rate, no tax, or chosen on the line. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_15rem]">
        {(["debit_account", "credit_account"] as const).map((k) => (
          <label key={k} className="grid gap-1 text-sm">{k === "debit_account" ? "Debit" : "Credit"}
            <select name={k} defaultValue={e[k] ?? ""} required className="input"><option value="">Choose</option>{accounts.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</select></label>
        ))}
        <label className="grid gap-1 text-sm">Sales tax on the debit<select name="tax_mode" defaultValue={e.tax_mode ?? "line"} className="input">
          {Object.entries(FIRM_TAX_MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Memo<input name="memo" defaultValue={e.memo} required minLength={3} maxLength={500} className="input" /></label>
        <label className="grid gap-1 text-sm">Working paper reference<input name="wp_ref" defaultValue={e.wp_ref} required minLength={3} maxLength={120} className="input" /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reverse" defaultChecked={e.reverse_next_year} className="h-4 w-4 accent-navy-700" />Accrual: reverse it next year</label>
    </>
  );
  return {
    help: <><p>Entries the firm makes the same way every year. In step 5, staff pick one and enter the total paid, including any tax; everything else comes from here. One at or under the review threshold (Closebook rules, Thresholds) does not need the reviewer.</p><h4>Expenses paid personally</h4><p>Now a schedule in the entry window: New entry, From a schedule, Expenses paid personally. Its old 31-line form and its settings are retired (piece 4b).</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-4">
        {((list ?? []) as Std[]).map((e) => (
          <form key={e.id} action={saveStandardEntry} className="card grid gap-3">
            <input type="hidden" name="id" value={e.id} />
            {fields(e)}
            <div className="flex gap-3"><button type="submit" className="btn-secondary">Save</button>
              <button type="submit" formAction={deleteStandardEntry} className="text-sm text-danger underline">Delete</button></div>
          </form>
        ))}
        {/* Piece 4b (Hashim, Nov 18, 2026): the round 9 "Expenses paid personally" lines are retired with its form; the data stays. */}
        <form action={saveStandardEntry} className="card grid gap-3">
          <h2 className="font-semibold">Add a standard entry</h2>
          {fields({})}
          <button type="submit" className="btn w-fit">Add</button>
        </form>
      </div>
    </>,
  };
}
