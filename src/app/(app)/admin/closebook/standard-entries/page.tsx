import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { deleteStandardEntry, saveStandardEntry } from "../actions";

type Std = { id: string; name: string; kind: string; reason: string; debit_account: string; credit_account: string; memo: string; wp_ref: string; reverse_next_year: boolean };
const REASONS: [string, string][] = [["accrual", "Accrual"], ["correction", "Correction"], ["tax", "Tax"]];

// Settings, Closebook, Standard entries (Hashim, Nov 15, 2026, layout item 6). Owners set the accounts,
// type, reason, memo and W/P ref; in step 5 staff pick one and enter the amount only.
export default async function StandardEntriesPage({ searchParams }: PageProps<"/admin/closebook/standard-entries">) {
  await requireOwner();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: list }, { data: chart }] = await Promise.all([
    supabase.from("cb_standard_entries").select("id, name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year").order("sort_order"),
    supabase.from("cb_chart_accounts").select("number, name").order("sort_order"),
  ]);
  const accounts = (chart ?? []) as { number: string; name: string }[];
  const fields = (e: Partial<Std>) => (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem]">
        <label className="grid gap-1 text-sm">Name<input name="name" defaultValue={e.name} required minLength={3} maxLength={80} className="input" /></label>
        <label className="grid gap-1 text-sm">Type<select name="kind" defaultValue={e.kind ?? "AJE"} className="input"><option>AJE</option><option>TJE</option></select></label>
        <label className="grid gap-1 text-sm">Reason<select name="reason" defaultValue={e.reason ?? "accrual"} className="input">{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["debit_account", "credit_account"] as const).map((k) => (
          <label key={k} className="grid gap-1 text-sm">{k === "debit_account" ? "Debit" : "Credit"}
            <select name={k} defaultValue={e[k] ?? ""} required className="input"><option value="">Choose</option>{accounts.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</select></label>
        ))}
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
        description="Entries the firm makes the same way every year. In step 5, staff pick one and enter the amount only; everything else comes from here. One at or under the review threshold (Thresholds) does not need the reviewer." />
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
        <form action={saveStandardEntry} className="card grid gap-3">
          <h2 className="font-semibold">Add a standard entry</h2>
          {fields({})}
          <button type="submit" className="btn w-fit">Add</button>
        </form>
      </div>
    </>
  );
}
