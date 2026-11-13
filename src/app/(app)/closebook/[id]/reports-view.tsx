// The Reports panel (Hashim, Nov 13, 2026): a working balance sheet and income statement, this year
// (after Closebook entries) against last year. Opened from the file header on every step.
import Link from "next/link";
import type { Reports, RepSection } from "@/lib/closebook/reports";
import { SidePanel } from "./side-panel";

const amt = (v: number) => (Math.round(v) === 0 ? "–" : v < 0 ? `(${Math.round(-v).toLocaleString("en-CA")})` : Math.round(v).toLocaleString("en-CA"));

function Section({ s, total }: { s: RepSection; total: string }) {
  return (
    <>
      <tr><th colSpan={3} className="pt-4 text-left text-xs font-semibold tracking-wide text-ink-3 uppercase">{s.title}</th></tr>
      {s.lines.map((l) => (
        <tr key={l.name} className="border-t border-sand-100"><td className="py-1.5 pr-2">{l.name}</td>
          <td className="py-1.5 text-right tabular-nums">{amt(l.now)}</td><td className="py-1.5 text-right tabular-nums text-ink-3">{amt(l.last)}</td></tr>
      ))}
      <tr className="border-t border-sand-300 font-semibold"><td className="py-1.5">{total}</td>
        <td className="py-1.5 text-right tabular-nums">{amt(s.now)}</td><td className="py-1.5 text-right tabular-nums text-ink-3">{amt(s.last)}</td></tr>
    </>
  );
}

export function ReportsView({ r, which, base, closeHref, yearEnd }: { r: Reports; which: "bs" | "pl"; base: string; closeHref: string; yearEnd: string }) {
  const tab = (k: "bs" | "pl", label: string) => (
    <Link href={`${base}&reports=${k}`} scroll={false} aria-current={which === k ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm ${which === k ? "bg-navy-700 font-semibold text-white" : "border border-sand-200 text-ink-2"}`}>{label}</Link>
  );
  const unsorted = r.bs.sections.find((s) => s.title === "Not yet sorted");
  return (
    <SidePanel title={`Reports · year-end ${yearEnd}`} closeHref={closeHref} wide>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">{tab("bs", "Balance sheet")}{tab("pl", "Income statement")}</div>
        <span className="rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">Working view: not for the client</span>
      </div>
      {unsorted && unsorted.now !== 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">Some amounts are not sorted yet: lines still to code, opening balances to enter, or accounts without a GIFI line. They show under &ldquo;Not yet sorted&rdquo;.</p>
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-ink-3"><th className="text-left font-medium"></th><th className="w-28 text-right font-medium">This year</th><th className="w-28 text-right font-medium">Last year</th></tr></thead>
        <tbody>
          {which === "bs" ? (
            <>
              <Section s={r.bs.sections[0]} total="Total assets" />
              {r.bs.sections.slice(1).map((s) => <Section key={s.title} s={s} total={`Total ${s.title.toLowerCase()}`} />)}
              <tr className="border-t-2 border-ink font-semibold"><td className="py-2">Total liabilities and equity</td>
                <td className="py-2 text-right tabular-nums">{amt(r.bs.totalOther.now)}</td><td className="py-2 text-right tabular-nums text-ink-3">{amt(r.bs.totalOther.last)}</td></tr>
            </>
          ) : (
            <>
              <Section s={r.pl.revenue} total="Total revenue" />
              <Section s={r.pl.expenses} total="Total expenses" />
              <tr className="border-t-2 border-ink font-semibold"><td className="py-2">Net income</td>
                <td className="py-2 text-right tabular-nums">{amt(r.pl.net.now)}</td><td className="py-2 text-right tabular-nums text-ink-3">{amt(r.pl.net.last)}</td></tr>
            </>
          )}
        </tbody>
      </table>
      {which === "bs" && !r.bs.balanced && <p className="text-sm text-danger">The balance sheet does not balance. Check the trial balance.</p>}
      <p className="text-xs text-ink-3">Amounts in dollars, rounded. Liabilities, equity and revenue show as positive; brackets are the opposite side.</p>
    </SidePanel>
  );
}
