// Step 5, the revenue check (round 9, Hashim, Nov 27, 2026). Benchmark: CaseWare's tie-out working paper:
// the trial balance figure, each source with its total and report, the difference to the cent, and how
// the difference was cleared (explained in one line, or fixed with an entry made from here). Revenue ties
// to its source, never to bank deposits. GST/HST registrants also tie to the year's returns; a realtor's
// T4A from the brokerage ties to the commission statement. A difference left over the review threshold
// waits for the reviewer on the step 6 list. The database applies the same rules to step 5's sign-off.
import { formatDate } from "@/lib/dates";
import type { AcctOpt } from "@/lib/closebook/entry-form";
import { revenueWaiting, type RevenueSource, type RevenueState } from "@/lib/closebook/expenses-server";
import { acceptRevenueDifference, addRevenueEntry, addRevenueSource, removeRevenueSource, saveRevenueCheck } from "../round9-actions";
import { FilePick } from "./file-pick";

const KIND: Record<string, string> = {
  commission_statement: "Brokerage commission statement (tax worksheet)", t4a: "T4A slip", sales_report: "Sales or invoice report",
  processor_report: "Card or online processor's annual report", slips: "T5018 or other slips", gst_returns: "GST/HST returns for the year",
};
const fmt = (n: number) => n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const neg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));
const fileName = (p: string) => p.split("/").pop()!.replace(/^\d+-/, "");

export function RevenueCheck({ fileId, st, sources, opts, revenueOpts, editable, isOwner, names, hasFix }: {
  fileId: string; st: RevenueState; sources: RevenueSource[]; opts: AcctOpt[]; revenueOpts: AcctOpt[]; editable: boolean; isOwner: boolean;
  names: Map<string, string>; hasFix: boolean;
}) {
  const primary = sources.filter((x) => ["commission_statement", "sales_report", "processor_report", "slips"].includes(x.kind) || (x.kind === "t4a" && x.payer === "other"));
  const gst = sources.filter((x) => x.kind === "gst_returns"), t4a = sources.filter((x) => x.kind === "t4a" && x.payer === "brokerage");
  const comm = sources.filter((x) => x.kind === "commission_statement");
  const over = Math.abs(st.diff) > st.threshold, waiting = revenueWaiting(st);
  // An explanation counts only for the difference it was written for (the database applies the same rule).
  const chip = (diff: number, text: string, explained: boolean, explainedFor: number | null, extra?: React.ReactNode) =>
    diff === 0 ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Ties out</span>
      : extra ?? (explained ? <span className="rounded bg-navy-100 px-2 py-0.5 text-xs font-semibold text-navy-800">Explained</span>
        : text && explainedFor !== null ? <span className="rounded bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">Explained for {neg(explainedFor)}: the difference changed. Check it and save again</span>
        : <span className="rounded bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">To explain or fix</span>);
  const mainChip = waiting ? <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Over the review threshold: for the reviewer</span>
    : over && st.accepted_by ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Accepted by {names.get(st.accepted_by) ?? "the reviewer"}, {formatDate(st.accepted_at)}</span>
    : undefined;
  const row = (label: React.ReactNode, amount: string, cls = "") => (
    <tr className={cls}><td className="px-3 py-1">{label}</td><td className="w-36 px-3 py-1 text-right tabular-nums">{amount}</td></tr>
  );
  const sourceRow = (x: RevenueSource) => row(
    <span className="flex flex-wrap items-center gap-x-2">{KIND[x.kind]}{x.kind === "t4a" ? (x.payer === "brokerage" ? " from the brokerage" : " from another payer") : ""}
      {x.label && <span className="text-ink-2">· {x.label}</span>}<span className="text-xs text-ink-3">· {fileName(x.attachment)}</span>
      {editable && <form action={removeRevenueSource} className="inline"><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="source" value={x.id} />
        <button type="submit" className="text-xs text-danger underline">Remove</button></form>}</span>, fmt(x.amount));
  const explain = (name: "explanation" | "gst_explanation" | "t4a_explanation", value: string, diff: number) => diff !== 0 && (
    <label className="grid gap-1 px-3 pb-2 text-sm"><span className="font-medium">Explain the difference in one line</span>
      <input form="rev-explain" name={name} defaultValue={value} maxLength={200} disabled={!editable} className="input input-compact" placeholder="What makes up the difference" /></label>
  );
  const kinds = st.realtor ? ["commission_statement", "t4a", "sales_report", "processor_report", "slips"] : ["sales_report", "processor_report", "slips", "t4a", "commission_statement"];
  const box = "overflow-x-auto rounded-lg border border-sand-200";
  const head = (t: string) => <thead><tr className="border-b border-sand-200 bg-sand-50 text-left text-xs text-ink-2"><th className="px-3 py-1">{t}</th><th className="px-3 py-1 text-right">Amount</th></tr></thead>;
  const fixDr = st.diff > 0 ? revenueOpts[0]?.value ?? "" : "", fixCr = st.diff < 0 ? revenueOpts[0]?.value ?? "" : "";
  const groups = [...new Set(opts.map((o) => o.group))];
  const select = (name: string, dflt: string, label: string) => (
    <label className="grid gap-1 text-sm">{label}<select name={name} defaultValue={dflt} required className="input input-compact w-64"><option value="">Choose</option>
      {groups.map((g) => <optgroup key={g} label={g}>{opts.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}</select></label>
  );

  return (
    <section id="revenue-check" aria-label="Revenue check" className="card mb-4 grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Revenue check <span className="ml-1 text-sm font-normal text-ink-3">W/P ref: Revenue check</span></h2>
        <span className="text-xs text-ink-3">Revenue ties to its source, never to bank deposits. Review threshold: {fmt(st.threshold)}</span>
      </div>
      <form id="rev-explain" action={saveRevenueCheck}><input type="hidden" name="file_id" value={fileId} /></form>

      <div className={box}><table className="w-full min-w-[560px] text-sm">
        {head("Revenue to its source")}
        <tbody>
          {row("Revenue per the trial balance (all revenue accounts, after entries)", fmt(st.tb), "font-medium")}
          {primary.length ? primary.map(sourceRow) : row(<span className="text-ink-3">{st.realtor ? "No commission statement yet." : "No source yet."}</span>, "")}
          {row("Total per the sources", fmt(st.sources), "border-t border-sand-200 font-medium")}
          {row(<span className="flex flex-wrap items-center gap-2 font-semibold">Difference {chip(st.diff, st.explanation, st.explained, st.explained_diff, mainChip)}</span>, neg(st.diff), "border-t-2 border-ink")}
        </tbody></table>
        {explain("explanation", st.explanation, st.diff)}
        {hasFix && <p className="px-3 pb-2 text-xs text-ink-2">An entry made from this check is on the list below, W/P ref &ldquo;Revenue check&rdquo;.</p>}
        {st.diff !== 0 && editable && (
          <details className="border-t border-sand-200 px-3 py-2">
            <summary className="cursor-pointer text-sm text-navy-700 underline">Fix it with an entry</summary>
            <form action={addRevenueEntry} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="file_id" value={fileId} />
              {select("debit", fixDr, "Debit")}{select("credit", fixCr, "Credit")}
              <label className="grid gap-1 text-sm">Amount<input name="amount" defaultValue={fmt(Math.abs(st.diff))} className="input input-compact w-32 text-right tabular-nums" /></label>
              <label className="grid gap-1 text-sm">Memo<input name="memo" required minLength={3} maxLength={500} className="input input-compact w-96" placeholder="What the entry fixes" /></label>
              <button type="submit" className="btn-secondary btn-compact">Make the entry</button>
              <span className="basis-full text-xs text-ink-3">An AJE at the year end, W/P ref &ldquo;Revenue check&rdquo;, for the reviewer. For an entry with sales tax, use the journal entry form below with the same W/P ref.</span>
            </form>
          </details>
        )}
        {waiting && isOwner && editable && st.explained && (
          <form action={acceptRevenueDifference} className="flex flex-wrap items-center gap-3 border-t border-sand-200 px-3 py-2">
            <input type="hidden" name="file_id" value={fileId} />
            <span className="text-sm">The difference is over the review threshold. The preparer&rsquo;s explanation: <i>{st.explanation}</i></span>
            <button type="submit" className="btn-secondary btn-compact">Accept the difference</button></form>
        )}
      </div>

      {st.registrant && (
        <div className={box}><table className="w-full min-w-[560px] text-sm">
          {head("GST/HST cross-check")}
          <tbody>
            {row("Revenue per the trial balance", fmt(st.tb))}
            {gst.length ? gst.map(sourceRow) : row(<span className="text-ink-3">The revenue on the year&rsquo;s GST/HST returns is not entered yet.</span>, "")}
            {row(<span className="flex flex-wrap items-center gap-2 font-semibold">Difference {chip(st.gst_diff, st.gst_explanation, st.gst_explained, st.gst_explained_diff)}</span>, gst.length ? neg(st.gst_diff) : "–", "border-t-2 border-ink")}
          </tbody></table>
          {gst.length > 0 && explain("gst_explanation", st.gst_explanation, st.gst_diff)}
        </div>
      )}

      {st.realtor && (
        <div className={box}><table className="w-full min-w-[560px] text-sm">
          {head("T4A check: the brokerage's T4A against its commission statement")}
          <tbody>
            {row("Commission statement", comm.length ? fmt(st.commission) : "–")}
            {t4a.length ? t4a.map(sourceRow) : row(<span className="text-ink-3">{st.t4a_none ? "No T4A from the brokerage." : "The brokerage's T4A is not entered yet."}</span>, "")}
            {row(<span className="flex flex-wrap items-center gap-2 font-semibold">Difference {t4a.length ? chip(st.t4a_diff, st.t4a_explanation, st.t4a_explained, st.t4a_explained_diff) : null}</span>, t4a.length ? neg(st.t4a_diff) : "–", "border-t-2 border-ink")}
          </tbody></table>
          {t4a.length > 0 && explain("t4a_explanation", st.t4a_explanation, st.t4a_diff)}
          {!t4a.length && <label className="flex items-center gap-2 px-3 pb-2 text-sm"><input form="rev-explain" type="checkbox" name="t4a_none" defaultChecked={st.t4a_none} disabled={!editable} className="h-4 w-4" />
            The brokerage issued no T4A for the year</label>}
        </div>
      )}
      {/* Fields that live in the sections above but are not shown there keep their saved value. */}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          {st.diff === 0 && <input form="rev-explain" type="hidden" name="explanation" value={st.explanation} />}
          {(!st.registrant || !gst.length || st.gst_diff === 0) && <input form="rev-explain" type="hidden" name="gst_explanation" value={st.gst_explanation} />}
          {(!st.realtor || !t4a.length || st.t4a_diff === 0) && <input form="rev-explain" type="hidden" name="t4a_explanation" value={st.t4a_explanation} />}
          {t4a.length > 0 && st.t4a_none && <input form="rev-explain" type="hidden" name="t4a_none" value="on" />}
          <button form="rev-explain" type="submit" className="btn-secondary btn-compact">Save the explanations</button>
        </div>
      )}

      {editable && (
        <details className="rounded-lg border border-sand-200 px-3 py-2" open={!sources.length}>
          <summary className="cursor-pointer text-sm font-medium text-navy-700">Add a source</summary>
          <form action={addRevenueSource} className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="file_id" value={fileId} />
            <label className="grid gap-1 text-sm">Source<select name="kind" className="input input-compact w-80">
              {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}{st.registrant && <option value="gst_returns">{KIND.gst_returns}</option>}</select></label>
            <label className="grid gap-1 text-sm">For a T4A: who paid it<select name="payer" defaultValue={st.realtor ? "brokerage" : "other"} className="input input-compact w-48">
              <option value="brokerage">The brokerage</option><option value="other">Another payer</option></select></label>
            <label className="grid gap-1 text-sm">Label<input name="label" maxLength={120} className="input input-compact w-56" placeholder="For example, the brokerage's name" /></label>
            <label className="grid gap-1 text-sm">Total from the report<input name="amount" required inputMode="decimal" className="input input-compact w-36 text-right tabular-nums" /></label>
            <FilePick id="rev-report" name="report" label="Report" add="Attach the report" accept=".pdf,.xlsx,.xls,.csv,.png,.jpg" hint="Required. PDF, Excel or an image." />
            <button type="submit" className="btn-secondary btn-compact">Add the source</button>
          </form>
          <p className="mt-2 text-xs text-ink-3">Realtor, team or PREC: the brokerage&rsquo;s annual commission statement, plus T4A slips. Invoices: the sales or invoice report. Card or online: the processor&rsquo;s annual report. Slips: T4A or T5018. More than one source can be added.</p>
        </details>
      )}
    </section>
  );
}
