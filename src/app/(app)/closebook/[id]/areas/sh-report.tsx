// Piece 8 (Hashim, Nov 18, 2026, version 5; benchmark CaseWare Cloud's continuity schedule): Reporting > Shareholder
// loans, read-only (mock I). A Summary card first when there are two or more shareholder accounts, then one card per
// account in account order. Every amount opens the ledger, with Back to this report.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { atYearEnd, cardTitle, entryLabel, openingLabel, resultLine, shown, SIGN_NOTE, type ShCard, type ShReport } from "@/lib/closebook/sh-report";
import { ReportingBack } from "./reporting-area";

export function ShReportView({ fileId, r, yearStart, yearEnd }: { fileId: string; r: ShReport; yearStart: string; yearEnd: string }) {
  const here = `/closebook/${fileId}?area=reporting&report=sh`;
  const ledger = (key: string, source?: string) => `/closebook/${fileId}?area=reporting&report=gl&account=${encodeURIComponent(key)}${source ? `&source=${source}` : ""}&back=${encodeURIComponent(here)}`;
  const amt = (c: number, href: string | null, bold = false) => c === 0 ? <span className="text-ink-3">–</span>
    : href ? <Link href={href} className={`text-navy-700 hover:underline ${bold ? "font-semibold" : ""}`} data-sh-amount>{shown(c)}</Link> : <span className={bold ? "font-semibold" : ""}>{shown(c)}</span>;
  const cell = "px-1.5 py-2";
  const row = (label: React.ReactNode, cents: number, href: string | null, o: { indent?: boolean; bold?: boolean; noLink?: boolean } = {}) => (
    <tr className="border-t border-sand-100">
      <td className={`${cell} ${o.indent ? "pl-6" : ""} ${o.bold ? "font-semibold" : ""}`}>{label}</td>
      <td className={`${cell} text-right tabular-nums`}>{amt(cents, o.noLink ? null : href, o.bold)}</td>
    </tr>
  );
  const card = (c: ShCard) => {
    const [b, rest] = resultLine(c);
    return (
      <section key={c.key} className="mb-4 rounded-[12px] border border-sand-200 bg-white px-5 py-4" aria-label={cardTitle(c)} data-sh-card={c.number}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold" data-sh-title>{cardTitle(c)}</h2>
          <span className="text-[12px] text-ink-3">GIFI {c.line_no.slice(0, 4)}</span>
        </div>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr className="text-left text-[11.5px] text-ink-3"><th className={`${cell} font-normal`}>Line</th><th className={`${cell} text-right font-normal`}>Amount</th></tr></thead>
          <tbody>
            {row(openingLabel(c), c.openingCents, ledger(c.key, "opening"))}
            {row("Paid to or for the shareholder", c.paidToCents, ledger(c.key, "bank"))}
            {row("Paid in by the shareholder", c.paidInCents, ledger(c.key, "bank"))}
            {c.booksCents !== null && row("Movement in the client's books", c.booksCents, ledger(c.key, "import"))}
            {row("Credited through entries", c.creditedCents, null, { noLink: true })}
            {c.credited.map((e) => <tr key={e.ref} className="border-t border-sand-100"><td className={`${cell} pl-6`}>{entryLabel(e)}</td><td className={`${cell} text-right tabular-nums`}>{amt(e.cents, ledger(c.key, "entry"))}</td></tr>)}
            {row("Debited through entries", c.debitedCents, null, { noLink: true })}
            {c.debited.map((e) => <tr key={e.ref} className="border-t border-sand-100"><td className={`${cell} pl-6`}>{entryLabel(e)}</td><td className={`${cell} text-right tabular-nums`}>{amt(e.cents, ledger(c.key, "entry"))}</td></tr>)}
            <tr className="border-t border-ink" style={{ borderBottom: "3px double #1f2937" }}>
              <td className={`${cell} font-semibold`}>Closing balance</td>
              <td className={`${cell} text-right font-semibold tabular-nums`} data-sh-closing>{amt(c.closingCents, ledger(c.key), true)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 rounded-[8px] bg-sand-100 px-3 py-2 text-[13px]" data-sh-result><b>{b}</b> {rest}</p>
      </section>
    );
  };
  return (
    <div className="max-w-5xl" data-sh-report>
      <ReportingBack fileId={fileId} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-ink">Shareholder loans</h1><p className="text-[12.5px] text-ink-3">{formatDate(yearStart)} to {formatDate(yearEnd)}</p></div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-warning-soft px-2 py-1 text-[11.5px] text-warning">Working paper: not for the client</span>
          <a href={`/closebook/${fileId}/report-export?report=sh&format=xlsx`} className="btn-secondary btn-compact">Excel</a>
          <a href={`/closebook/${fileId}/report-export?report=sh&format=pdf`} target="_blank" rel="noreferrer" className="btn-secondary btn-compact">PDF</a>
        </div>
      </div>
      {r.cards.length === 0 ? <p className="rounded-[12px] border border-sand-200 bg-white px-5 py-4 text-[13px] text-ink-3">No shareholder account on this file.</p> : <>
        {r.cards.length > 1 && (
          <section className="mb-4 rounded-[12px] border border-sand-200 bg-white px-5 py-4" aria-label="Summary" data-sh-summary>
            <div className="mb-2 flex items-baseline justify-between"><h2 className="text-[15px] font-semibold">Summary</h2><span className="text-[12px] text-ink-3">{r.cards.length} shareholder accounts</span></div>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className="text-left text-[11.5px] text-ink-3"><th className={`${cell} font-normal`}>Account</th><th className={`${cell} text-right font-normal`}>Opening</th>
                <th className={`${cell} text-right font-normal`}>Movement</th><th className={`${cell} text-right font-normal`}>Closing</th><th className={`${cell} font-normal`}>At year-end</th></tr></thead>
              <tbody>
                {r.cards.map((c) => (
                  <tr key={c.key} className="border-t border-sand-100" data-sh-summary-row>
                    <td className={cell}>{cardTitle(c)}</td><td className={`${cell} text-right tabular-nums`}>{shown(c.openingCents)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{shown(c.movementCents)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{amt(c.closingCents, ledger(c.key))}</td><td className={cell}>{atYearEnd(c)}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink font-semibold" style={{ borderBottom: "3px double #1f2937" }} data-sh-total>
                  <td className={cell}>Total</td><td className={`${cell} text-right tabular-nums`}>{shown(r.total.openingCents)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{shown(r.total.movementCents)}</td><td className={`${cell} text-right tabular-nums`}>{shown(r.total.closingCents)}</td><td />
                </tr>
              </tbody>
            </table>
          </section>
        )}
        {r.cards.map(card)}
        <p className="text-[12px] text-ink-3">{SIGN_NOTE} Every amount opens the ledger, with Back.</p>
      </>}
    </div>
  );
}
