import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadCbSettings, NOTE1 } from "@/lib/closebook/settings";
import { updateCbSettings } from "../actions";

// Settings, Closebook, Accounting policy (Note 1) (Phase 3 batch 5.6 and section 7): the firm's
// default. A reviewer can override it in a client's file for the rare client who needs book amortization.
export default async function PolicyPage({ searchParams }: PageProps<"/admin/closebook/policy">) {
  await requireOwner();
  const sp = await searchParams;
  const c = await loadCbSettings(await createClient());
  if (!c) return <PageHeader title="Accounting policy (Note 1)" description="Closebook settings are not loaded yet." />;
  return (
    <>
      <PageHeader eyebrow="Settings › Closebook · owners only" title="Accounting policy (Note 1)"
        description="The firm's default amortization policy. It drives the amortization note in the financial statements. The reviewer can override it for one client in that client's file." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateCbSettings} className="card grid gap-4">
        <input type="hidden" name="back" value="/admin/closebook/policy" />
        {([["recon", c.recon_outstanding_max], ["flag_amount", c.flag_amount], ["flag_percent", c.flag_percent], ["entry_review", c.entry_review_amount], ["capital_invoice", c.capital_invoice_amount]] as [string, number][]).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div><label htmlFor="note1" className="label">Amortization</label>
          <select id="note1" name="note1" defaultValue={c.note1_policy} className="input">{Object.entries(NOTE1).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <span className="text-xs text-muted">The approved firm policy (Phase 3 batch, 5.6). Other policies are set per client by the reviewer.</span></div>
        <button type="submit" className="btn w-fit">Save</button>
      </form>
    </>
  );
}
