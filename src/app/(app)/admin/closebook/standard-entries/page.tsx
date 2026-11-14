import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { deleteStandardEntry, saveStandardEntry } from "../actions";
import { FIRM_TAX_MODE } from "@/lib/closebook/vendor";
import { saveStandardEntryLine } from "../../../closebook/round9-actions";

type Ln = { key: string; name: string; sort_order: number; account: string | null; tax: string; share: string; capital: boolean; to_reviewer: boolean; pick: boolean; note_required: boolean; choices: string[] };
const LINE_TAX: [string, string][] = [["taxable", "GST/HST, client's rate"], ["meals", "Meals: 50% ITC"], ["none", "No tax normally"], ["auto", "As Auto expenses"]];
const SHARE: Record<string, string> = { km: "Business km", phone: "Business share", none: "" };

type Std = { id: string; name: string; kind: string; reason: string; debit_account: string; credit_account: string; memo: string; wp_ref: string; reverse_next_year: boolean; tax_mode: string };
const REASONS: [string, string][] = [["accrual", "Accrual"], ["correction", "Correction"], ["tax", "Tax"]];

// Settings, Closebook, Standard entries (Hashim, Nov 15, 2026, layout item 6). Owners set the accounts,
// type, reason, memo and W/P ref; in step 5 staff pick one and enter the amount only.
export default async function StandardEntriesPage({ searchParams }: PageProps<"/admin/closebook/standard-entries">) {
  await requireOwner();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: list }, { data: chart }, { data: lined }] = await Promise.all([
    supabase.from("cb_standard_entries").select("id, name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, tax_mode").eq("style", "simple").order("sort_order"),
    supabase.from("cb_chart_accounts").select("number, name").order("sort_order"),
    supabase.from("cb_standard_entries").select("id, name, kind, memo, wp_ref, lines:cb_standard_entry_lines(key, name, sort_order, account, tax, share, capital, to_reviewer, pick, note_required, choices)").eq("style", "lines"),
  ]);
  const withLines = ((lined ?? []) as { id: string; name: string; kind: string; memo: string; wp_ref: string; lines: Ln[] }[]);
  const accounts = (chart ?? []) as { number: string; name: string }[];
  const fields = (e: Partial<Std>) => (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem]">
        <label className="grid gap-1 text-sm">Name<input name="name" defaultValue={e.name} required minLength={3} maxLength={80} className="input" /></label>
        <label className="grid gap-1 text-sm">Type<select name="kind" defaultValue={e.kind ?? "AJE"} className="input"><option>AJE</option><option>TJE</option></select></label>
        <label className="grid gap-1 text-sm">Reason<select name="reason" defaultValue={e.reason ?? "accrual"} className="input">{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
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
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Standard entries"
        description="Entries the firm makes the same way every year. In step 5, staff pick one and enter the total paid, including any tax; everything else comes from here. One at or under the review threshold (Thresholds) does not need the reviewer." />
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
        {/* Round 9 (Hashim, Nov 27, 2026): one entry with its own lines, in the client sheet's names and order. */}
        {withLines.map((x) => (
          <section key={x.id} id="expenses-personal" className="card grid gap-3">
            <div>
              <h2 className="font-semibold">{x.name} <span className="ml-1 text-sm font-normal text-ink-3">{x.lines.length} lines · {x.kind} at the year end · W/P ref: {x.wp_ref}</span></h2>
              <p className="text-sm text-ink-2">Memo: {x.memo} In step 5 the preparer types the before-tax and GST/HST amounts from the Summary of the client&rsquo;s sheet; blank lines are dropped.
                Each line debits its account, the claimable GST/HST goes to 21500 and the shareholder loan (23000 or 23050) is credited. Change a line&rsquo;s default here; the lines and their order follow the client&rsquo;s sheet.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="table table-compact">
                <thead><tr><th>#</th><th>Line on the sheet</th><th>Account</th><th>Sales tax</th><th>Share</th><th>Reviewer</th><th /></tr></thead>
                <tbody>{[...x.lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => {
                  const fid = `ln-${l.key}`;
                  return (
                    <tr key={l.key}>
                      <td className="tabular-nums text-ink-3">{l.sort_order}</td>
                      <td>{l.name}{l.capital && <span className="ml-1 text-xs text-ink-3">(capital)</span>}{l.note_required && <span className="block text-xs text-ink-3">The preparer adds a note saying what it is.</span>}
                        {l.pick && l.choices.length > 0 && <span className="block text-xs text-ink-3">Only {l.choices.join(", ")}.</span>}</td>
                      <td><form id={fid} action={saveStandardEntryLine}><input type="hidden" name="standard" value={x.id} /><input type="hidden" name="key" value={l.key} /></form>
                        <select form={fid} name="account" defaultValue={l.account ?? ""} className="input input-compact pr-8" style={{ width: "17.5rem" }} aria-label={`${l.name}: account`}>
                          {l.pick && <option value="">Preparer picks</option>}
                          {accounts.filter((a) => !l.choices.length || l.choices.includes(a.number)).map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</select></td>
                      <td><select form={fid} name="tax" defaultValue={l.tax} className="input input-compact pr-8" style={{ width: "12.5rem" }} aria-label={`${l.name}: sales tax`}>{LINE_TAX.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                      <td className="text-sm">{SHARE[l.share]}</td>
                      <td><label className="inline-flex items-center gap-1.5 text-sm"><input form={fid} type="checkbox" name="to_reviewer" defaultChecked={l.to_reviewer} disabled={l.capital} className="h-4 w-4 accent-navy-700" />
                        {l.capital ? "Always (capital)" : "Send"}</label>{l.capital && <input form={fid} type="hidden" name="to_reviewer" value="on" />}</td>
                      <td><button form={fid} type="submit" className="btn-secondary btn-compact">Save</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        ))}
        <form action={saveStandardEntry} className="card grid gap-3">
          <h2 className="font-semibold">Add a standard entry</h2>
          {fields({})}
          <button type="submit" className="btn w-fit">Add</button>
        </form>
      </div>
    </>
  );
}
