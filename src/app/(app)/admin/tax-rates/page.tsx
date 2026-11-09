import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate, formatDateTime, todayToronto } from "@/lib/dates";
import { addRate, approveAllRates, loadCraRates, setRateStatus } from "./actions";
import { CRA_TABLE } from "@/lib/tax/cra-rates";

const CRA_RATES = "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html";
const PROVINCES: [string, string][] = [["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"]];

type Rate = { id: string; province: string; tax: string; rate_percent: number; effective_from: string; source_url: string; checked_on: string; status: string; approved_at: string | null; notes: string;
  checker: { full_name: string } | null; approver: { full_name: string } | null };

export default async function TaxRatesPage({ searchParams }: PageProps<"/admin/tax-rates">) {
  const access = await requireAccess("tax_rates", "view");
  const sp = await searchParams;
  const editable = canEdit(access, "tax_rates");
  const supabase = await createClient();
  const { data } = await supabase.from("tax_rates")
    .select("id, province, tax, rate_percent, effective_from, source_url, checked_on, status, approved_at, notes, checker:checked_by(full_name), approver:approved_by(full_name)")
    .order("province").order("effective_from", { ascending: false });
  const rates = (data ?? []) as unknown as Rate[];
  const today = todayToronto();
  const current = (p: string) => rates.find((r) => r.province === p && r.status === "approved" && r.effective_from <= today);

  return (
    <>
      <PageHeader title="GST/HST rates" description="Proposals and quotes charge GST or HST by the client's province. Concept does not collect PST or QST. A rate is used only after an owner approves it. If a province has no approved rate, no quote is made." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card mb-6 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Province</th><th>Rate in use today</th><th>Source</th><th>Checked</th><th>Approved</th></tr></thead>
          <tbody>{PROVINCES.map(([code, name]) => {
            const r = current(code);
            return (
              <tr key={code}>
                <td className="font-medium">{name}</td>
                <td>{r ? `${Number(r.rate_percent)}% ${r.tax} from ${formatDate(r.effective_from)}` : <span className="text-danger">None approved. No quotes for this province.</span>}</td>
                <td>{r ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">CRA page</a> : ""}</td>
                <td>{r ? `${formatDate(r.checked_on)} by ${r.checker?.full_name ?? ""}` : ""}</td>
                <td>{r ? `${formatDateTime(r.approved_at)} by ${r.approver?.full_name ?? ""}` : ""}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>

      {rates.some((r) => r.status === "pending") && (
        <section className="card mb-6 overflow-x-auto p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h2 className="font-semibold">Waiting for approval ({rates.filter((r) => r.status === "pending").length})</h2>
            {access.is_owner && (
              <form action={approveAllRates}><button className="btn" type="submit">Approve all</button></form>
            )}
          </div>
          <table className="table">
            <thead><tr><th>Province</th><th>Rate</th><th>From</th><th>Checked</th><th>Notes</th><th></th></tr></thead>
            <tbody>{rates.filter((r) => r.status === "pending").map((r) => (
              <tr key={r.id}>
                <td>{r.province}</td><td>{Number(r.rate_percent)}% {r.tax}</td><td>{formatDate(r.effective_from)}</td>
                <td>{formatDate(r.checked_on)} by {r.checker?.full_name} · <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">source</a></td>
                <td>{r.notes}</td>
                <td className="text-right">{access.is_owner && (
                  <form action={setRateStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="approved" /><button className="btn h-8 px-3 text-sm" type="submit">Approve</button></form>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {access.is_owner && (
        <form action={loadCraRates} className="card mb-6 space-y-3">
          <h2 className="font-semibold">Load the CRA table</h2>
          <p className="text-sm text-muted">
            Loads all 13 GST/HST rates from the <a href={CRA_RATES} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">CRA rates page</a> as pending, in effect from {formatDate(CRA_TABLE.effectiveFrom)}, checked {formatDate(CRA_TABLE.checkedOn)}. Rates already loaded are skipped. Nothing is used until you approve.
          </p>
          <p className="text-sm">{CRA_TABLE.rates.map((r) => `${r.name} ${r.rate}% ${r.tax}`).join(" · ")}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-4 w-4 accent-navy-700" /> I checked this table against the CRA page. My name is recorded as the checker.</label>
          <button className="btn" type="submit">Load as pending</button>
        </form>
      )}

      {editable && (
        <form action={addRate} className="card mb-6 space-y-4">
          <h2 className="font-semibold">Add a rate</h2>
          <p className="text-sm text-muted">Open the <a href={CRA_RATES} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">CRA GST/HST rates page</a>, check the rate for the province, then enter it here. It starts as pending until an owner approves it.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label htmlFor="province" className="label">Province</label><select id="province" name="province" required className="input">{PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
            <div><label htmlFor="tax" className="label">Tax</label><select id="tax" name="tax" className="input"><option>GST</option><option>HST</option></select></div>
            <div><label htmlFor="rate" className="label">Rate (%)</label><input id="rate" name="rate_percent" inputMode="decimal" required className="input" /></div>
            <div><label htmlFor="from" className="label">In effect from</label><input id="from" name="effective_from" type="date" required className="input" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
            <div><label htmlFor="src" className="label">CRA source page (canada.ca)</label><input id="src" name="source_url" defaultValue={CRA_RATES} required className="input" /></div>
            <div><label htmlFor="checked" className="label">Date checked</label><input id="checked" name="checked_on" type="date" defaultValue={today} max={today} required className="input" /></div>
          </div>
          <div><label htmlFor="notes" className="label">Notes (optional)</label><input id="notes" name="notes" className="input" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-4 w-4 accent-navy-700" /> I checked this rate on the CRA page today. My name is recorded as the checker.</label>
          <button className="btn" type="submit">Add as pending</button>
        </form>
      )}

      {rates.some((r) => r.status !== "pending") && (
        <section className="card overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">History</h2>
          <table className="table">
            <thead><tr><th>Province</th><th>Rate</th><th>From</th><th>Status</th><th></th></tr></thead>
            <tbody>{rates.filter((r) => r.status !== "pending").map((r) => (
              <tr key={r.id}>
                <td>{r.province}</td><td>{Number(r.rate_percent)}% {r.tax}</td><td>{formatDate(r.effective_from)}</td><td className="capitalize">{r.status}</td>
                <td className="text-right">{access.is_owner && r.status === "approved" && (
                  <form action={setRateStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="retired" /><button className="text-sm text-navy-700 underline" type="submit">Retire</button></form>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
