import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadCbSettings, NOTE1 } from "@/lib/closebook/settings";
import type { SP, View } from "../../settings-shell";
import { updateCbSettings } from "../actions";

// Closebook rules, Note 1 policy tab (Phase 3 batch 5.6 and section 7): the firm's default. A reviewer can
// override it in a client's file for the rare client who needs book amortization. Owners only.
export async function PolicyView(sp: SP): Promise<View> {
  await requireOwner();
  const c = await loadCbSettings(await createClient());
  if (!c) return { help: null, body: <p className="card text-sm text-warning">Closebook settings are not loaded yet.</p> };
  return {
    help: <><p>The firm&rsquo;s default amortization policy. It drives the amortization note in the financial statements. The reviewer can override it for one client in that client&rsquo;s file.</p><p>The approved firm policy. Other policies are set per client by the reviewer.</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={updateCbSettings} className="card grid gap-4">
        <input type="hidden" name="back" value="/admin/closebook/policy" />
        {([["recon", c.recon_outstanding_max], ["flag_amount", c.flag_amount], ["flag_percent", c.flag_percent], ["entry_review", c.entry_review_amount], ["capital_invoice", c.capital_invoice_amount]] as [string, number][]).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div><label htmlFor="note1" className="label">Amortization</label>
          <select id="note1" name="note1" defaultValue={c.note1_policy} className="input">{Object.entries(NOTE1).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <button type="submit" className="btn w-fit">Save</button>
      </form>
    </>,
  };
}
