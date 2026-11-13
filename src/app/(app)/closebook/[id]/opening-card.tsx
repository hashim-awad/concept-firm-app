// Step 2, last year's balances for a bank-statement file (Hashim, Nov 13, 2026; BRIEF.md "Opening
// balances"): where they came from, the two checks, and the routes to bring them in.
import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { importOpeningGifi, importOpeningTb, useTbAsOpening } from "../actions";
import { fileInputClass } from "@/components/ds/primitives";
import { SidePanel } from "./side-panel";
import { OpeningManual } from "./opening-manual";
import type { CodeInfo } from "@/lib/closebook/opening";

const SOURCE: Record<string, string> = { closebook: "Carried over from last year's Closebook file", gifi_file: "Imported from a prior-year GIFI file",
  manual: "Typed in by GIFI code", trial_balance: "From the prior accountant's trial balance" };

export function OpeningCard({ fileId, source, setAt, codeCount, issue, panel, error, infoList, initial, reStated, editable, imported, unmatched }: {
  fileId: string; source: string | null; setAt: string | null; codeCount: number; issue: string; panel: string | null; error: string | null;
  imported: number; unmatched: number;   // route 3: last year's trial balance rows waiting, and how many still need a GIFI line
  infoList: [string, CodeInfo][]; initial: { code: string; amount: string }[]; reStated: string; editable: boolean;
}) {
  const base = `/closebook/${fileId}?step=records`;
  return (
    <section className="card grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Last year&rsquo;s balances</h2>
          <p className="text-sm text-ink-2">{source ? `${SOURCE[source] ?? source}: ${codeCount} GIFI lines${setAt ? `, ${formatDateTime(setAt)}` : ""}.`
            : "Not in yet. Last year's Closebook file carries over by itself when there is one; otherwise import last year's GIFI file or type it in."}</p>
        </div>
        {editable && (
          <span className="flex flex-wrap gap-2">
            <Link href={`${base}&opening=import`} scroll={false} className="btn-secondary">{source ? "Replace by import" : "Import last year's GIFI file"}</Link>
            <Link href={`${base}&opening=manual`} scroll={false} className="btn-secondary">{source ? "Edit by GIFI code" : "Type in by GIFI code"}</Link>
            <Link href={`${base}&opening=tb`} scroll={false} className="btn-secondary">From last year&rsquo;s trial balance</Link>
          </span>
        )}
      </div>
      {source && (issue
        ? <ul className="list-disc rounded-lg border border-warning/40 bg-warning-soft py-2 pr-3 pl-8 text-sm">{issue.split(/\.\s+/).filter(Boolean).map((t) => <li key={t}>{t.replace(/\.$/, "")}.</li>)}<li className="list-none -ml-5 pt-1 text-ink-2">The difference sits in &ldquo;Opening balances to enter&rdquo; for the reviewer.</li></ul>
        : <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">Both checks pass: opening retained earnings ties to last year&rsquo;s 3849, and the first statements open at last year&rsquo;s closing balances.</p>)}

      {panel === "import" && editable && (
        <SidePanel title="Import last year's GIFI file" closeHref={base}>
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <p className="text-sm text-ink-2">Closebook&rsquo;s GIFI layout: &quot;code&quot;,amount lines, no total lines, with 3660 and the 3700s. Usually made from the prior T2 (CRA &ldquo;View Return&rdquo;) by the takeover skill; a prior accountant&rsquo;s .gfi works the same way.</p>
          <form action={importOpeningGifi} className="grid gap-4">
            <input type="hidden" name="file_id" value={fileId} />
            <div><label htmlFor="upload" className="label">GIFI file (.gfi or .csv)</label><input id="upload" name="upload" type="file" accept=".gfi,.csv,.txt" required className={fileInputClass} /></div>
            <div><label htmlFor="re_stated" className="label">Last year&rsquo;s retained earnings at the end of the year (GIFI 3849, from last year&rsquo;s T2)</label>
              <input id="re_stated" name="re_stated" required inputMode="decimal" defaultValue={reStated} className="input max-w-[220px] text-right" /></div>
            <div><button type="submit" className="btn">Import</button></div>
          </form>
        </SidePanel>
      )}
      {imported > 0 && (
        <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm">Last year&rsquo;s trial balance is in: {imported} accounts, {unmatched ? `${unmatched} still need a GIFI line (below)` : "all matched"}.{" "}
          <Link href={`${base}&opening=tb`} scroll={false} className="font-semibold text-navy-700 underline">{unmatched ? "What next" : "Use as opening balances"}</Link></p>
      )}
      {panel === "tb" && editable && (
        <SidePanel title="From last year's trial balance" closeHref={base}>
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>Import the prior accountant&rsquo;s trial balance (CSV or Excel). It goes into last year&rsquo;s column.</li>
            <li>Match each account to a GIFI line, below the card in step 2. Most match by themselves.</li>
            <li>Use it as the opening balances, with last year&rsquo;s 3849. The same two checks run.</li>
          </ol>
          <form action={importOpeningTb} className="grid gap-3 rounded-lg border border-sand-200 p-4">
            <input type="hidden" name="file_id" value={fileId} />
            <div><label htmlFor="tb_upload" className="label">{imported ? "Import again (replaces it)" : "Last year's trial balance"}</label><input id="tb_upload" name="upload" type="file" accept=".csv,.xlsx" required className={fileInputClass} /></div>
            <div><button type="submit" className="btn-secondary">Import</button></div>
          </form>
          {imported > 0 && (
            <form action={useTbAsOpening} className="grid gap-3 rounded-lg border border-sand-200 p-4">
              <input type="hidden" name="file_id" value={fileId} />
              <p className="text-sm">{imported} accounts imported. {unmatched ? <b className="text-warning">{unmatched} still need a GIFI line: match them below the card first.</b> : "Every account has a GIFI line."}</p>
              <div><label htmlFor="tb_re" className="label">Last year&rsquo;s retained earnings at the end of the year (GIFI 3849, from last year&rsquo;s T2)</label>
                <input id="tb_re" name="re_stated" required inputMode="decimal" defaultValue={reStated} className="input max-w-[220px] text-right" /></div>
              <div><button type="submit" className="btn" disabled={unmatched > 0}>Use as opening balances</button></div>
            </form>
          )}
        </SidePanel>
      )}
      {panel === "manual" && editable && (
        <SidePanel title="Last year's balances by GIFI code" closeHref={base} wide>
          <OpeningManual fileId={fileId} infoList={infoList} initial={initial} reStated={reStated} closeHref={base} />
        </SidePanel>
      )}
    </section>
  );
}
