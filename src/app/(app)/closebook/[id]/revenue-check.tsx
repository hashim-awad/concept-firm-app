// Step 5, the revenue check (round 9, Hashim, Nov 27, 2026). Benchmark: CaseWare's tie-out working paper:
// the trial balance figure, each source with its total and report, the difference to the cent, and how
// the difference was cleared (explained in one line, or fixed with an entry made from here). Revenue ties
// to its source, never to bank deposits. GST/HST registrants also tie to the year's returns; a realtor's
// T4A from the brokerage ties to the commission statement. A difference left over the review threshold
// waits for the reviewer on the step 6 list. The database applies the same rules to step 5's sign-off.
import { formatDate } from "@/lib/dates";
import type { AcctOpt } from "@/lib/closebook/entry-form";
import { type RevenueSource, type RevenueState } from "@/lib/closebook/expenses-server";
import Link from "next/link";
import { acceptRevenueDifference, addRevenueSource, removeRevenueSource, saveRevenueCheck } from "../round9-actions";
import { FilePick } from "./file-pick";
import { Popover } from "./shell/ui";

const KIND: Record<string, string> = {
  commission_statement: "Brokerage commission statement (tax worksheet)", t4a: "T4A slip", sales_report: "Sales or invoice report",
  processor_report: "Card or online processor's annual report", slips: "T5018 or other slips", gst_returns: "GST/HST returns for the year",
};
const fmt = (n: number) => n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const neg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));
const fileName = (p: string) => p.split("/").pop()!.replace(/^\d+-/, "");

export function RevenueCheck({ fileId, st, sources, editable, isOwner, names, hasFix, fixHref }: {
  fileId: string; st: RevenueState; sources: RevenueSource[]; opts?: AcctOpt[]; revenueOpts?: AcctOpt[]; editable: boolean; isOwner: boolean;
  names: Map<string, string>; hasFix: boolean; fixHref: string;
}) {
  const primary = sources.filter((x) => ["commission_statement", "sales_report", "processor_report", "slips"].includes(x.kind) || (x.kind === "t4a" && x.payer === "other"));
  const gst = sources.filter((x) => x.kind === "gst_returns"), t4a = sources.filter((x) => x.kind === "t4a" && x.payer === "brokerage");
  const comm = sources.filter((x) => x.kind === "commission_statement");
  // Round 13: a file whose GST/HST return is built in Closebook takes the return's figure (step 8).
  const fromReturn = !!st.gst_from_return;
  const hasSrc = primary.length > 0, hasGst = fromReturn ? st.n_gst > 0 : gst.length > 0, hasT4a = t4a.length > 0 && comm.length > 0;
  // An explanation counts only for the signed difference it was written for: 500.00 and (500.00) are
  // different differences (the database applies the same rule). Round 15: one short status per check.
  const pill = (cls: string, t: React.ReactNode, title?: string) => <span title={title} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{t}</span>;
  const status = (has: boolean, none: string, diff: number, text: string, explained: boolean, explainedFor: number | null, waiting: boolean, by: string | null, at: string | null, accepted: number | null) =>
    !has ? pill("bg-sand-100 text-ink-2", none)
      : diff === 0 ? pill("bg-success-soft text-success", "Ties out")
      : waiting && explained ? pill("bg-warning-soft text-warning", "For the reviewer", "Over the review threshold")
      : !waiting && by && accepted === diff && Math.abs(diff) > st.threshold ? pill("bg-success-soft text-success", "Accepted", `Accepted by ${names.get(by) ?? "the reviewer"}, ${formatDate(at)}`)
      : explained ? pill("bg-navy-100 text-navy-800", "Explained")
      : text && explainedFor !== null ? pill("bg-danger-soft text-danger", "Explain again", `Explained for ${neg(explainedFor)}; the difference is now ${neg(diff)}`)
      : pill("bg-danger-soft text-danger", "To explain");
  const accept = (check: "revenue" | "gst" | "t4a", waiting: boolean, explained: boolean) => waiting && explained && isOwner && editable && (
    <form action={acceptRevenueDifference} className="inline"><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="check" value={check} />
      <button type="submit" className="ml-1.5 text-[11px] font-semibold text-navy-700 underline">Accept</button></form>
  );
  const explainCell = (name: "explanation" | "gst_explanation" | "t4a_explanation", value: string, diff: number, has: boolean) => (
    has && diff !== 0 ? <textarea form="rev-explain" name={name} defaultValue={value} maxLength={200} disabled={!editable} aria-label="Explanation" placeholder="Explain in one line" rows={1}
      className="block w-full min-w-[14rem] resize-none rounded border border-sand-300 px-1.5 py-0.5 text-[12.5px] leading-snug [field-sizing:content] disabled:border-transparent disabled:bg-transparent" /> : <span className="text-ink-3">{value}</span>
  );
  const sourceRow = (x: RevenueSource) => (
    <tr key={x.id} className="text-[12px] text-ink-2"><td className="py-0.5 pr-2 pl-6">{KIND[x.kind]}{x.kind === "t4a" ? (x.payer === "brokerage" ? ", brokerage" : ", other payer") : ""}{x.label && ` · ${x.label}`}
      <span className="ml-1.5 text-ink-3">· {fileName(x.attachment)}</span>
      {editable && <form action={removeRevenueSource} className="ml-2 inline"><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="source" value={x.id} />
        <button type="submit" className="text-[11px] text-danger underline">Remove</button></form>}</td>
      <td /><td className="px-2.5 py-0.5 text-right tabular-nums">{fmt(x.amount)}</td><td colSpan={3} /></tr>
  );
  const kinds = st.realtor ? ["commission_statement", "t4a", "sales_report", "processor_report", "slips"] : ["sales_report", "processor_report", "slips", "t4a", "commission_statement"];
  const th = "px-2.5 py-1.5 font-semibold";
  const gstSrc = fromReturn ? (st.n_gst ? st.gst : null) : gst.length ? st.gst : null;

  return (
    <section id="revenue-check" aria-label="Revenue check" className="mb-3.5 rounded-[10px] border border-sand-200 bg-white">
      <form id="rev-explain" action={saveRevenueCheck}><input type="hidden" name="file_id" value={fileId} /></form>
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3.5 py-2.5">
        <span className="flex-1" />
        {editable && (
          <Popover align="right" width="w-[34rem]" label="Add a source" button={<span className="btn-secondary btn-compact">+ Source</span>}>
            <form action={addRevenueSource} className="grid grid-cols-2 gap-2.5">
              <input type="hidden" name="file_id" value={fileId} />
              <label className="col-span-2 grid gap-1 text-xs font-semibold">Source<select name="kind" className="input input-compact">
                {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}{st.registrant && !fromReturn && <option value="gst_returns">{KIND.gst_returns}</option>}</select></label>
              <label className="grid gap-1 text-xs font-semibold">T4A paid by<select name="payer" defaultValue={st.realtor ? "brokerage" : "other"} className="input input-compact">
                <option value="brokerage">The brokerage</option><option value="other">Another payer</option></select></label>
              <label className="grid gap-1 text-xs font-semibold">Label<input name="label" maxLength={120} className="input input-compact" /></label>
              <label className="grid gap-1 text-xs font-semibold">Total<input name="amount" required inputMode="decimal" className="input input-compact text-right tabular-nums" /></label>
              <div className="col-span-2"><FilePick id="rev-report" name="report" label="Report" add="Attach the report" accept=".pdf,.xlsx,.xls,.csv,.png,.jpg" hint="Required." /></div>
              <button type="submit" className="btn-secondary btn-compact justify-self-start">Add the source</button>
            </form>
          </Popover>
        )}
        {/* Round 15b: the fix opens the journal entry dialog with the difference filled in. */}
        {hasSrc && st.diff !== 0 && editable && <Link href={fixHref} scroll={false} className="btn-secondary btn-compact">Fix with an entry</Link>}
        {editable && <button form="rev-explain" type="submit" className="btn btn-compact">Save</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
          <thead><tr className="bg-sand-50 text-left text-[11px] text-ink-3"><th className={th}>Check</th><th className={`${th} text-right`}>Trial balance</th><th className={`${th} text-right`}>Source</th>
            <th className={`${th} text-right`}>Difference</th><th className={th}>Status</th><th className={th}>Explanation</th></tr></thead>
          <tbody>
            <tr className="border-t border-sand-100"><td className="px-2.5 py-1.5">Revenue to its source</td><td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(st.tb)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{hasSrc ? fmt(st.sources) : "–"}</td><td className="px-2.5 py-1.5 text-right tabular-nums">{hasSrc ? neg(st.diff) : "–"}</td>
              <td className="px-2.5 py-1.5">{status(hasSrc, st.realtor ? "No statement" : "No source", st.diff, st.explanation, st.explained, st.explained_diff, st.waiting, st.accepted_by, st.accepted_at, st.accepted_diff)}{accept("revenue", st.waiting, st.explained)}</td>
              <td className="px-2.5 py-1.5">{explainCell("explanation", st.explanation, st.diff, hasSrc)}{hasFix && <span className="block text-[11px] text-ink-3">Entry made: W/P Revenue check</span>}</td></tr>
            {primary.map(sourceRow)}
            {st.registrant && <>
              <tr className="border-t border-sand-100"><td className="px-2.5 py-1.5">GST/HST {fromReturn ? "return" : "returns"}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(fromReturn ? st.tb_gst ?? st.tb : st.tb)}</td><td className="px-2.5 py-1.5 text-right tabular-nums">{gstSrc === null ? "–" : fmt(gstSrc)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{hasGst ? neg(st.gst_diff) : "–"}</td>
                <td className="px-2.5 py-1.5">{status(hasGst, fromReturn ? "Prepare in step 8" : "Not entered", st.gst_diff, st.gst_explanation, st.gst_explained, st.gst_explained_diff, st.gst_waiting, st.gst_accepted_by, st.gst_accepted_at, st.gst_accepted_diff)}{accept("gst", st.gst_waiting, st.gst_explained)}</td>
                <td className="px-2.5 py-1.5">{explainCell("gst_explanation", st.gst_explanation, st.gst_diff, hasGst)}</td></tr>
              {!fromReturn && gst.map(sourceRow)}
            </>}
            {st.realtor && <>
              <tr className="border-t border-sand-100"><td className="px-2.5 py-1.5">T4A to commission statement</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{comm.length ? fmt(st.commission) : "–"}</td><td className="px-2.5 py-1.5 text-right tabular-nums">{t4a.length ? fmt(st.t4a) : "–"}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{hasT4a ? neg(st.t4a_diff) : "–"}</td>
                <td className="px-2.5 py-1.5">{st.t4a_none && !t4a.length ? pill("bg-success-soft text-success", "No T4A") : status(hasT4a, t4a.length ? "No statement" : "No T4A yet", st.t4a_diff, st.t4a_explanation, st.t4a_explained, st.t4a_explained_diff, st.t4a_waiting, st.t4a_accepted_by, st.t4a_accepted_at, st.t4a_accepted_diff)}{accept("t4a", st.t4a_waiting, st.t4a_explained)}</td>
                <td className="px-2.5 py-1.5">{t4a.length ? explainCell("t4a_explanation", st.t4a_explanation, st.t4a_diff, hasT4a)
                  : <label className="inline-flex items-center gap-1.5 text-[12px]"><input form="rev-explain" type="checkbox" name="t4a_none" defaultChecked={st.t4a_none} disabled={!editable} className="h-3.5 w-3.5" />No T4A this year</label>}</td></tr>
              {t4a.map(sourceRow)}
            </>}
          </tbody>
        </table>
      </div>
      {/* Fields not shown in the table keep their saved value. */}
      {editable && <>
        {(!hasSrc || st.diff === 0) && <input form="rev-explain" type="hidden" name="explanation" value={st.explanation} />}
        {(!st.registrant || !hasGst || st.gst_diff === 0) && <input form="rev-explain" type="hidden" name="gst_explanation" value={st.gst_explanation} />}
        {(!st.realtor || !hasT4a || st.t4a_diff === 0) && <input form="rev-explain" type="hidden" name="t4a_explanation" value={st.t4a_explanation} />}
        {t4a.length > 0 && st.t4a_none && <input form="rev-explain" type="hidden" name="t4a_none" value="on" />}
      </>}
    </section>
  );
}
