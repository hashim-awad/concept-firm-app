// Piece 7 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud's GST/HST working paper): the revenue in the books against
// the revenue on the year's GST/HST returns, moved here from step 5's revenue check. Same style as the 21500 box above
// it. The figures are where they were saved: a file whose return is built in Closebook takes the return's revenue
// (round 13); otherwise the preparer types the returns' total and attaches them. A difference is explained in one
// line (CB2-0 step 5: no review threshold; nothing waits for the reviewer). Step 8's sign-off needs it done on a registrant's full file.
import { formatDate } from "@/lib/dates";
import type { RevenueSource, RevenueState } from "@/lib/closebook/expenses-server";
import { acceptRevenueDifference, addRevenueSource, removeRevenueSource, saveGstRevenueNote } from "../round9-actions";
import { negativeTone, bracketAmount } from "@/lib/closebook/amount";
import { AmountField } from "@/components/amount";
import { FilePick } from "./file-pick";

const m = (n: number) => <span className={negativeTone(n)}>{bracketAmount(Math.round(n * 100))}</span>;
const chip = (ok: boolean, text: string) => <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ok ? "bg-success-soft text-success" : "bg-danger/10 text-danger"}`}>{text}</span>;
const fileName = (p: string) => p.split("/").pop()!.replace(/^\d+-/, "");

export function GstRevenueBox({ fileId, st, sources, editable, canReview, names, back }: {
  fileId: string; st: RevenueState; sources: RevenueSource[]; editable: boolean; canReview: boolean; names: Map<string, string>; back: string;
}) {
  const fromReturn = !!st.gst_from_return;
  const gst = sources.filter((x) => x.kind === "gst_returns");
  const has = st.n_gst > 0;
  const books = fromReturn ? st.tb_gst ?? st.tb : st.tb;
  const accepted = !st.gst_waiting && !!st.gst_accepted_by && st.gst_accepted_diff === st.gst_diff && st.gst_diff !== 0;
  const status = !has ? chip(false, fromReturn ? "Prepare the return" : "Not entered")
    : st.gst_diff === 0 ? chip(true, "Ties")
    : accepted ? chip(true, "Accepted by the reviewer")
    : st.gst_explained ? chip(true, "Explained")
    : chip(false, "To explain");
  const hidden = <><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={back} /></>;
  const cell = "px-3 py-0.5";
  return (
    <div id="gst-revenue" aria-label="GST/HST revenue" className="overflow-x-auto rounded-lg border border-sand-200">
      <div className="flex items-start justify-between gap-2 border-b border-sand-200 bg-sand-50 px-3 py-1.5">
        <p className="text-sm font-medium">Revenue in the books against the revenue on the year&apos;s GST/HST returns</p>{status}
      </div>
      <table className="w-full text-sm"><tbody>
        <tr><td className={cell}>Revenue in the books</td><td className={`w-40 ${cell} text-right tabular-nums`}>{m(books)}</td></tr>
        <tr><td className={cell}>Revenue on the year&apos;s GST/HST returns{fromReturn && <span className="text-xs text-ink-3"> (from the return above)</span>}</td>
          <td className={`${cell} text-right tabular-nums`}>{has ? m(st.gst) : "–"}</td></tr>
        {!fromReturn && gst.map((x) => (
          <tr key={x.id} className="text-xs text-ink-2"><td className={`${cell} pl-6`}>{x.label || "GST/HST returns for the year"} · {fileName(x.attachment)}
            {editable && <form action={removeRevenueSource} className="ml-2 inline">{hidden}<input type="hidden" name="source" value={x.id} />
              <button type="submit" className="text-[11px] text-danger underline">Remove</button></form>}</td>
            <td className={`${cell} text-right tabular-nums`}>{m(x.amount)}</td></tr>
        ))}
        <tr className="border-t border-ink font-semibold"><td className={cell}>Difference</td><td className={`${cell} text-right tabular-nums`}>{has ? m(st.gst_diff) : "–"}</td></tr>
      </tbody></table>
      {st.gst_explanation && <p className="px-3 py-1.5 text-xs">Note: {st.gst_explanation}{st.gst_explained_diff !== null && st.gst_explained_diff !== st.gst_diff && <span className="text-danger"> (written for {bracketAmount(Math.round(st.gst_explained_diff * 100))}: explain again)</span>}</p>}
      {accepted && <p className="px-3 py-1.5 text-xs">Accepted by {names.get(st.gst_accepted_by ?? "") ?? "the reviewer"}, {formatDate(st.gst_accepted_at)}.</p>}
      {editable && (!fromReturn || (has && st.gst_diff !== 0) || (canReview && st.gst_waiting && st.gst_explained)) && (
        <div className="grid gap-2 border-t border-sand-200 px-3 py-2">
          {!fromReturn && (
            <form action={addRevenueSource} className="flex flex-wrap items-end gap-2" aria-label="Enter the returns">
              {hidden}<input type="hidden" name="kind" value="gst_returns" /><input type="hidden" name="payer" value="other" />
              <label className="grid gap-1 text-xs font-semibold">Revenue on the returns<AmountField name="amount" required className="input input-compact" /></label>
              <label className="grid gap-1 text-xs font-semibold">Label<input name="label" maxLength={120} placeholder="For example: four quarterly returns" className="input input-compact" /></label>
              <FilePick id="gst-rev-report" name="report" label="Returns" add="Attach the returns" accept=".pdf,.xlsx,.xls,.csv,.png,.jpg" hint="Required." />
              <button type="submit" className="btn-secondary btn-compact">Add</button>
            </form>
          )}
          {has && st.gst_diff !== 0 && (
            <form action={saveGstRevenueNote} className="flex flex-wrap items-center gap-2">
              {hidden}
              <input name="note" defaultValue={st.gst_explanation} maxLength={200} placeholder="Explain the difference in one line" aria-label="Note" className="input input-compact" style={{ width: "28rem" }} />
              <button type="submit" className="btn-secondary btn-compact">Save the note</button>
            </form>
          )}
          {canReview && st.gst_waiting && st.gst_explained && (
            <form action={acceptRevenueDifference}>{hidden}<input type="hidden" name="check" value="gst" />
              <button type="submit" className="btn-secondary btn-compact">Accept the difference</button></form>
          )}
        </div>
      )}
    </div>
  );
}
