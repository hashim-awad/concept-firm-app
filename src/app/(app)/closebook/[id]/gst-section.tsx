// Step 8, the GST/HST return beside the T2 (round 13). Benchmark: QuickBooks Online's GST/HST return: the
// lines with their CRA line numbers, a column per period, and each figure drilling to the postings
// behind it. Then the check against GST/HST payable (21500), as the revenue check works.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { LINE_NAMES, type Line } from "@/lib/closebook/gst-return";
import type { GstData } from "@/lib/closebook/gst-server";
import { acceptGstCheck, bookQuickGain, confirmGstEntry, prepareGstReturns } from "../gst-actions";

const m = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }));
const plain = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TOTAL: Line[] = ["105", "108", "109", "112", "113"];
const chip = (ok: boolean, yes: string, no: string) => <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ok ? "bg-success-soft text-success" : "bg-danger/10 text-danger"}`}>{ok ? yes : no}</span>;

export function GstSection({ fileId, g, editable, isOwner, drill, names }: { fileId: string; g: GstData; editable: boolean; isOwner: boolean; drill: { period: number; line: Line } | null; names: Map<string, string> }) {
  if (!g.applies) return (
    <section id="gst" aria-label="GST/HST return" className="card">
      <h2 className="font-semibold">GST/HST return</h2>
      <p className="mt-1 text-sm text-ink-2">{g.reason}</p>
    </section>
  );
  const href = (p: number, l: Line) => `/closebook/${fileId}?step=t2&gst=${p}&line=${l}#gst-drill`;
  const prep = new Map(g.prepared.map((r) => [r.period_no, r]));
  const allPrepared = g.periods.every((p) => prep.has(p.n)) && g.changed.length === 0;
  const c = g.check, row = g.checkRow;
  const over = Math.abs(c.diffCents) > g.threshold * 100;
  const status = c.diffCents === 0 ? chip(true, "Ties", "") : over ? (row?.accepted_at && Math.round(row.diff * 100) === c.diffCents ? chip(true, "Accepted by the reviewer", "") : chip(false, "", "Over the review threshold: the reviewer decides"))
    : (row?.note && Math.round(row.diff * 100) === c.diffCents ? chip(true, "Explained", "") : chip(false, "", "To explain, or fix with an entry"));
  const problems = g.returns.flatMap((r) => r.problems).filter((x, i, a) => a.indexOf(x) === i);
  const d = drill ? g.returns.find((r) => r.period.n === drill.period) : null;
  const items = d && drill ? d.drill[drill.line] ?? [] : [];
  return (
    <section id="gst" aria-label="GST/HST return" className="card grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">GST/HST return{g.periods.length > 1 ? "s" : ""}</h2>
        <span className="text-xs text-ink-2">{g.quick ? "Quick method" : "Regular method"} · {g.freq === "annual" ? "Annual" : g.freq === "quarterly" ? "Quarterly" : "Monthly"} · {g.rt} · {g.province}</span>
      </div>
      {problems.length > 0 && <ul role="alert" className="ml-4 list-disc text-sm text-danger">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="overflow-x-auto">
        <table className="table table-compact">
          <thead><tr><th style={{ width: "4rem" }}>Line</th><th>Description</th>{g.returns.map((r) => <th key={r.period.n} className="text-right whitespace-nowrap">{g.periods.length > 1 ? r.period.label.split(":")[0] : "Year"}<span className="block text-[11px] font-normal text-ink-3">{formatDate(r.period.start)} to {formatDate(r.period.end)}</span></th>)}</tr></thead>
          <tbody>
            {LINE_NAMES.map(([k, name]) => (
              <tr key={k} className={TOTAL.includes(k as Line) ? "font-semibold" : ""}>
                <td className="tabular-nums">{k}</td><td>{name}</td>
                {g.returns.map((r) => {
                  const v = r.lines[k as Line], can = !!r.drill[k as Line]?.length;
                  return <td key={r.period.n} className="text-right tabular-nums">{can ? <Link className="text-navy-700 underline" href={href(r.period.n, k as Line)}>{m(v)}</Link> : m(v)}</td>;
                })}
              </tr>
            ))}
            <tr className="border-t border-sand-200 text-xs text-ink-2"><td /><td>Due</td>{g.returns.map((r) => <td key={r.period.n} className="text-right">{formatDate(r.period.due)}</td>)}</tr>
            <tr className="text-xs text-ink-2"><td /><td>Prepared</td>{g.returns.map((r) => { const p = prep.get(r.period.n);
              return <td key={r.period.n} className="text-right">{!p ? <span className="text-danger">Not yet</span> : g.changed.includes(r.period.n) ? <span className="text-danger">Changed since: prepare again</span> : `${names.get(p.prepared_by ?? "") ?? ""}, ${formatDate(p.prepared_at)}`}</td>; })}</tr>
          </tbody>
        </table>
      </div>
      {g.returns.some((r) => r.notes.length) && <ul className="ml-4 list-disc text-xs text-ink-2">{[...new Set(g.returns.flatMap((r) => r.notes))].map((x) => <li key={x}>{x}</li>)}</ul>}

      {d && drill && (
        <div id="gst-drill" className="rounded-lg border border-navy-200 bg-navy-50/40 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">Line {drill.line}, {LINE_NAMES.find(([k]) => k === drill.line)?.[1]}: {d.period.label} ({items.length} posting{items.length === 1 ? "" : "s"})</p>
            <Link href={`/closebook/${fileId}?step=t2#gst`} className="text-sm text-navy-700 underline">Close</Link>
          </div>
          <table className="table table-compact mt-2">
            <thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Account</th><th>Code</th><th className="text-right">{g.quick && (drill.line === "101" || drill.line === "103") ? "Sale with tax" : "Amount before tax"}</th><th className="text-right">GST/HST</th></tr></thead>
            <tbody>{items.map((x, i) => (
              <tr key={`${x.ref}-${i}`}><td className="whitespace-nowrap">{formatDate(x.date)}</td><td>{x.source === "bank" ? "Bank or card line" : "Entry"}</td><td>{x.label}</td>
                <td>{x.account} {x.accountName}</td><td>{x.code}</td><td className="text-right tabular-nums">{m(g.quick && x.sale ? x.netCents + x.taxCents : x.netCents)}</td><td className="text-right tabular-nums">{m(x.taxCents)}</td></tr>
            ))}
              <tr className="border-t border-ink font-semibold"><td colSpan={5}>Total</td>
                <td className="text-right tabular-nums">{m(items.reduce((n, x) => n + (g.quick && x.sale ? x.netCents + x.taxCents : x.netCents), 0))}</td><td className="text-right tabular-nums">{m(items.reduce((n, x) => n + x.taxCents, 0))}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 7. The check against the books, as the revenue check. */}
      <div aria-label="Check against 21500" className="overflow-x-auto rounded-lg border border-sand-200">
        <div className="flex items-start justify-between gap-2 border-b border-sand-200 bg-sand-50 px-3 py-1.5">
          <p className="text-sm font-medium">GST/HST payable (21500) against the balances owing on the returns</p>{status}
        </div>
        <table className="w-full text-sm"><tbody>
          <tr><td className="px-3 py-0.5">Last year&apos;s balance owing (step 2)</td><td className="w-40 px-3 py-0.5 text-right tabular-nums">{m(c.openingCents)}</td></tr>
          <tr><td className="px-3 py-0.5">Net tax on the year&apos;s returns (line 109)</td><td className="px-3 py-0.5 text-right tabular-nums">{m(c.netTaxCents)}</td></tr>
          <tr><td className="px-3 py-0.5">Less payments to the CRA in the year (instalments and balances)</td><td className="px-3 py-0.5 text-right tabular-nums">{m(-c.paymentsCents)}</td></tr>
          <tr className="border-t border-ink font-semibold"><td className="px-3 py-0.5">Balances still owing</td><td className="px-3 py-0.5 text-right tabular-nums">{m(c.owingCents)}</td></tr>
          <tr><td className="px-3 py-0.5">GST/HST payable (21500) at year end</td><td className="px-3 py-0.5 text-right tabular-nums">{m(c.bookCents)}</td></tr>
          <tr className="border-t border-ink font-semibold"><td className="px-3 py-0.5">Difference (21500 less the returns)</td><td className="px-3 py-0.5 text-right tabular-nums">{m(c.diffCents)}</td></tr>
        </tbody></table>
        {c.diffCents !== 0 && g.other21500 !== 0 && <p className="px-3 py-1.5 text-xs text-ink-2">Entries move {m(g.other21500)} into 21500 without a sales tax code and are not counted as instalments (see below).</p>}
        {row?.note && <p className="px-3 py-1.5 text-xs">Explained: {row.note}</p>}
        {row?.accepted_at && <p className="px-3 py-1.5 text-xs">Accepted by {names.get(row.accepted_by ?? "") ?? ""}: {row.accepted_why}</p>}
      </div>
      {/* Round 13 fix 3: on a quick method file the difference is the tax the company keeps, booked as income. */}
      {g.quick && c.diffCents > 0 && editable && allPrepared && (
        <div aria-label="Quick method gain" className="rounded-lg border border-navy-200 bg-navy-50/40 p-3 text-sm">
          <p className="font-medium">Quick method gain: {m(c.diffCents)}</p>
          <p className="text-xs text-ink-2">The GST/HST collected less the tax remitted and the credit stays with the company. It is income. The entry:</p>
          <table className="table table-compact mt-2 max-w-xl"><thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody><tr><td>21500 GST/HST payable</td><td className="text-right tabular-nums">{plain(c.diffCents)}</td><td /></tr>
              <tr><td>{g.gainAccount} GST/HST quick method gain (GIFI 8230)</td><td /><td className="text-right tabular-nums">{plain(c.diffCents)}</td></tr></tbody></table>
          <form action={bookQuickGain} className="mt-2 flex flex-wrap items-center gap-3">
            <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="amount" value={(c.diffCents / 100).toFixed(2)} />
            <button className="btn-secondary btn-compact">Book the entry</button><span className="text-xs text-ink-2">AJE, W/P ref &ldquo;GST/HST return&rdquo;. Then prepare the return again.</span>
          </form>
        </div>
      )}
      {isOwner && editable && over && c.diffCents !== 0 && !(row?.accepted_at && Math.round(row.diff * 100) === c.diffCents) && allPrepared && (
        <form action={acceptGstCheck} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="file_id" value={fileId} />
          <input name="why" required minLength={3} maxLength={300} placeholder="Why the difference is accepted" className="input input-compact" style={{ width: "24rem" }} aria-label="Reason" />
          <button className="btn-secondary btn-compact">Accept the difference</button>
        </form>
      )}

      {/* Round 13 fix 2: entries that move an amount into 21500 without a tax code, for the preparer to
          count as an instalment or leave out. */}
      {g.candidates.length > 0 && (
        <div aria-label="Instalment candidates" className="rounded-lg border border-sand-200 p-3 text-sm">
          <p className="font-medium">Entries that move an amount into GST/HST payable (21500) without a tax code</p>
          <p className="text-xs text-ink-2">An instalment first recorded elsewhere goes on line 110 once confirmed. Leave out anything that is not an instalment.</p>
          <table className="table table-compact mt-2"><thead><tr><th>Date</th><th>Entry</th><th className="text-right">Into 21500</th><th>Instalment?</th><th /></tr></thead>
            <tbody>{g.candidates.map((x) => (
              <tr key={x.ref}><td className="whitespace-nowrap">{formatDate(x.date)}</td><td>{x.label}</td><td className="text-right tabular-nums">{m(x.cents)}</td>
                <td>{x.confirmed ? chip(true, "Counted on line 110", "") : <span className="text-xs text-ink-3">Not counted</span>}</td>
                <td>{editable && <form action={confirmGstEntry}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="entry" value={x.ref} />
                  <input type="hidden" name="yes" value={x.confirmed ? "no" : "yes"} /><button className="btn-secondary btn-compact">{x.confirmed ? "Leave out" : "Count as an instalment"}</button></form>}</td></tr>
            ))}</tbody></table>
        </div>
      )}

      {/* Prepare: the instalments from the CRA account, then the lines kept as worked out. */}
      {editable && (
        <form action={prepareGstReturns} className="grid gap-3 border-t border-sand-200 pt-3" aria-label="Prepare the returns">
          <input type="hidden" name="file_id" value={fileId} />
          <p className="text-sm font-medium">Instalments paid (line 110), from the CRA account</p>
          <div className="flex flex-wrap gap-3">
            {g.periods.map((p) => (
              <label key={p.n}><span className="label">{g.periods.length > 1 ? p.label.split(":")[0] : "The year"}</span>
                <input name={`inst_${p.n}`} className="input text-right tabular-nums" style={{ width: "9rem" }} defaultValue={plain(g.returns.find((r) => r.period.n === p.n)!.lines["110"])} /></label>
            ))}
          </div>
          <p className="text-xs text-ink-2">Pre-filled with the payments coded to GST/HST in each period{g.prefill.lastYear ? `; the ${plain(g.prefill.lastYear.cents)} paid on ${formatDate(g.prefill.lastYear.date)} is last year's balance, not an instalment` : ""}{g.prefill.balances.length ? `; ${g.prefill.balances.map((x) => `${plain(x.cents)} on ${formatDate(x.date)}`).join(", ")} paid an earlier return's balance` : ""}. Confirm them against the CRA account.</p>
          {c.diffCents !== 0 && !over && (
            <label><span className="label">Explain the difference with 21500 in one line (or fix it with an entry in step 5)</span>
              <input name="note" className="input" maxLength={300} defaultValue={row?.note ?? ""} style={{ width: "40rem", maxWidth: "100%" }} /></label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn">Prepare the return{g.periods.length > 1 ? "s" : ""}</button>
            <a className="text-sm text-navy-700 underline" href={`/closebook/${fileId}/gst-workpaper?format=xlsx`}>Working paper (Excel)</a>
            <a className="text-sm text-navy-700 underline" href={`/closebook/${fileId}/gst-workpaper?format=pdf`}>Working paper (PDF)</a>
          </div>
        </form>
      )}
    </section>
  );
}
