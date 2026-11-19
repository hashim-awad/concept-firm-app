import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { messageFrom } from "@/lib/messages";
import { KM_COLUMNS, PROVINCES, describeCraChange, factor, rate, type ItcRow, type KmRow } from "@/lib/closebook/cra-rates";
import { ItcTable, KmTable } from "./forms";
import type { SP, View } from "../../settings-shell";

// Piece 1 of the step 5 restructure (Hashim, Nov 18, 2026; benchmark CaseWare Cloud's firm-level settings, where
// the firm keeps the rates its working papers use). Closebook rules › CRA rates, Admins only (round 17: the menu
// shows the tab only to owners; no lock icons). The per-km allowance rates by calendar year and the ITC factor on
// allowances and reimbursements per province. The firm types the rates; nothing is loaded. Nothing reads them yet:
// the Vehicle allowance schedule will (piece 3). Every add or change is in Settings › Activity log, and the latest
// show in the History list here, as on Sales tax rates. Round 1b: a year opens for change when clicked; the ITC
// table has one Save; a refused save keeps what was typed, with the message in red under its field (forms.tsx).
export async function CraRatesView(sp: SP): Promise<View> {
  await requireAdmin("closebook");
  const supabase = await createClient();
  const [{ data: km }, { data: itc }, { data: staff }, { data: log }] = await Promise.all([
    supabase.from("cb_cra_km_rates").select("*").order("year", { ascending: false }),
    supabase.from("cb_cra_itc_factors").select("*"),
    supabase.from("staff").select("id, full_name"),
    supabase.from("activity_log").select("id, occurred_at, actor_id, action, entity_type, details")
      .in("entity_type", ["cb_cra_km_rates", "cb_cra_itc_factors"]).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(30),
  ]);
  const who = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  const by = (r: { entered_by: string | null; updated_by: string | null; updated_at: string | null; entered_at: string }) => {
    const id = r.updated_by ?? r.entered_by;
    return { by: id ? who.get(id) ?? "Unknown" : "", when: formatDateTime(r.updated_at ?? r.entered_at) };
  };
  const years = ((km ?? []) as KmRow[]).map((r) => ({ year: r.year, rates: Object.fromEntries(KM_COLUMNS.map(([k]) => [k, rate(r[k])])), ...by(r) }));
  const factors = new Map(((itc ?? []) as ItcRow[]).map((r) => [r.province, r]));
  const itcRows = PROVINCES.map((p) => { const r = factors.get(p.code); return { code: p.code, name: p.name, factor: factor(r), ...(r ? by(r) : { by: "", when: "" }) }; });
  const th = "px-3 py-2 text-left text-[11.5px] font-bold tracking-[.06em] text-ink-2 uppercase";

  return {
    help: <>
      <p>The CRA rates the schedules use. Admins type them in from the CRA. Nothing uses them yet: the Vehicle allowance schedule will.</p>
      <p><b>Per-km allowance rates</b>: dollars per km for each calendar year, for the first 5,000 km and for each km after, in the provinces and in the territories. Click a year to change it.</p>
      <p><b>ITC factor</b>: the share of an allowance or reimbursement that is GST/HST, as a fraction, for example 13/113 in Ontario. Change any rows, then Save once.</p>
      <p>Every add and change is kept in Settings › Activity log, with who, when, and the old and new values.</p>
    </>,
    body: <div className="grid gap-5">
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card overflow-x-auto p-0" aria-label="Per-km allowance rates" data-km-rates>
        <KmTable rows={years} />
        <p className="px-5 py-3 text-[12.5px] text-ink-3" data-km-source>Source: CRA&rsquo;s prescribed per-km rates (section 7306 of the Income Tax Regulations).</p>
      </section>

      <section className="card overflow-x-auto p-0" aria-label="ITC factor on allowances and reimbursements" data-itc>
        <h2 className="px-5 pt-4 pb-2 font-semibold">ITC factor on allowances and reimbursements</h2>
        <ItcTable rows={itcRows} />
      </section>

      <section className="card overflow-x-auto p-0" aria-label="History" data-cra-history>
        <h2 className="px-5 pt-4 pb-2 font-semibold">History</h2>
        <table className="w-full min-w-[640px] text-[13.5px]">
          <thead><tr className="border-y border-sand-200"><th className={th}>When</th><th className={th}>Who</th><th className={th}>Change</th></tr></thead>
          <tbody>
            {((log ?? []) as { id: number; occurred_at: string; actor_id: string | null; action: string; entity_type: string; details: { old?: Record<string, unknown>; new?: Record<string, unknown> } }[]).map((e) => (
              <tr key={e.id} className="border-t border-sand-100">
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{formatDateTime(e.occurred_at)}</td>
                <td className="px-3 py-2">{e.actor_id ? who.get(e.actor_id) ?? "Unknown" : "System"}</td>
                <td className="px-3 py-2">{describeCraChange(e.entity_type, e.action, e.details?.old ?? {}, e.details?.new ?? {})}</td>
              </tr>
            ))}
            {!(log ?? []).length && <tr><td colSpan={3} className="px-3 py-3 text-ink-3">No changes yet.</td></tr>}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[12.5px] text-ink-3">The latest 30 changes. All of them are in <Link href="/admin/activity" className="text-navy-700 hover:underline">Activity log</Link>.</p>
      </section>
    </div>,
  };
}
