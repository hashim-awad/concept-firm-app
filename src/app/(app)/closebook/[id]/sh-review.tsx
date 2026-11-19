// Piece 8 (Hashim, Nov 18, 2026, version 5; benchmark CaseWare Cloud: the reviewer owns the s.15(2) judgement):
// step 7's shareholder loans. The figures are read from the ledger (Reporting > Shareholder loans); the reviewer
// saves them ("Update"), picks the shareholder of an account outside the standard chart, decides each flag, confirms
// "Repaid by" for a balance owed at the start of the year, and notes the repay-by date of each account owed by the
// shareholder at year-end. Step 7's sign-off needs them all; a change clears step 7 only.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { decisionText, flagText, shareholderLabel, type ShGroup } from "@/lib/closebook/sh-loans";
import { groupKey, type ShData } from "@/lib/closebook/sh-server";
import { cardTitle, money, shortDay, type ShReport } from "@/lib/closebook/sh-report";
import { acceptShFlag, confirmShRepaid, noteShDue, prepareShSchedule, setShOwner } from "../sh-actions";

export type ShNotedRow = { account_key: string; closing: number; due_on: string; noted_by: string | null; noted_at: string };
const pill = (cls: string, t: React.ReactNode, title?: string) => <span title={title} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{t}</span>;

// The step 7 line for an account owed by the shareholder at year-end.
export const owedLine = (closingCents: number, dueOn: string) => `Owed by the shareholder at year-end: ${money(closingCents)}. Repay by ${shortDay(dueOn)}`;

export function ShReview({ fileId, sh, report, noted, editable, isOwner, names }: {
  fileId: string; sh: ShData; report: ShReport; noted: ShNotedRow[]; editable: boolean; isOwner: boolean; names: Map<string, string>;
}) {
  const st = sh.status;
  const current = !!st.prepared_at && !st.stale;
  const can = editable && isOwner;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const reportHref = `/closebook/${fileId}?area=reporting&report=sh&back=${encodeURIComponent(`/closebook/${fileId}?step=review`)}`;
  const YEAR = Number(sh.yearEnd.slice(0, 4));
  const titleOf = (key: string) => { const c = report.cards.find((x) => x.key === key); const r = sh.rows.find((x) => x.key === key); return c ? cardTitle(c) : r ? `${r.number} ${r.name}` : key; };
  const groupTitle = (g: ShGroup) => (g.shareholder === null ? titleOf(g.keys[0]) : `${shareholderLabel(g.shareholder)} (${g.keys.map(titleOf).join(", ")})`);
  const owed = report.cards.filter((c) => c.owedBy);
  return (
    <section id="sh-review" aria-label="Shareholder loans" className="card grid gap-3" data-sh-review>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Shareholder loans</h2>
        {!st.prepared_at ? pill("bg-danger-soft text-danger", "Not worked out") : st.stale ? pill("bg-danger-soft text-danger", "Books changed")
          : pill("bg-navy-100 text-navy-800", `Updated ${formatDate(st.prepared_at)}`)}
        <span className="flex-1" />
        <Link href={reportHref} className="text-[12.5px] font-semibold text-navy-700 underline">Open the report</Link>
        {editable && <form action={prepareShSchedule}>{hidden("file_id", fileId)}<button type="submit" className="btn-secondary btn-compact" data-sh-update>Update</button></form>}
      </div>
      {st.problems.length > 0 && <ul className="text-[12.5px] text-danger">{st.problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      {/* Each account owed by the shareholder at year-end: "Noted: repay by <date>" (Hashim's answer, Nov 18, 2026). */}
      {owed.length > 0 && (
        <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200">
          {owed.map((c) => {
            const n = noted.find((x) => x.account_key === c.key);
            const ok = !!n && Math.round(n.closing * 100) === -c.closingCents && n.due_on === c.dueOn;
            return (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-sh-owed={c.number}>
                <span><b className="font-semibold">{cardTitle(c)}</b> · {owedLine(-c.closingCents, c.dueOn!)}</span>
                {ok ? pill("bg-success-soft text-success", "Noted", `${names.get(n!.noted_by ?? "") ?? "The reviewer"}, ${formatDate(n!.noted_at)}`)
                  : can && current ? <form action={noteShDue}>{hidden("file_id", fileId)}{hidden("account", c.key)}<button type="submit" className="btn-secondary btn-compact" data-sh-note>Noted: repay by {shortDay(c.dueOn!)}</button></form>
                  : <span className="text-[11.5px] text-ink-3">{current ? "For the reviewer" : "Click Update first"}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {/* An account outside the standard chart: whose is it. */}
      {sh.rows.filter((r) => sh.owners[r.key].source !== "chart").map((r) => {
        const o = sh.owners[r.key];
        return (
          <div key={r.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{titleOf(r.key)}:</span>
            {editable ? (
              <form action={setShOwner} className="inline-flex items-center gap-1 text-[12px]">{hidden("file_id", fileId)}{hidden("account", r.key)}
                <select name="shareholder" defaultValue={o.shareholder ?? ""} required aria-label="Whose account" className="rounded border border-sand-300 px-1 py-0.5">
                  <option value="" disabled>Whose?</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Shareholder {n}</option>)}</select>
                <button type="submit" className="font-semibold text-navy-700 underline">Save</button>{o.source === "rolled" && <span className="text-ink-3">from last year</span>}
              </form>) : <span className="text-ink-3">{shareholderLabel(o.shareholder)}</span>}
          </div>
        );
      })}

      {sh.groups.map((g) => {
        const key = groupKey(g);
        const conf = sh.repaid.find((x) => x.account_key === key);
        const confirmed = !!g.prior && !!conf && conf.due_on === g.prior.dueOn && Math.round(conf.repaid * 100) === g.prior.repaidCents && Math.round(conf.unpaid * 100) === g.prior.unpaidCents;
        if (!g.prior && !g.flags.length) return null;
        return (
          <div key={key} className="grid gap-2 rounded-lg border border-sand-200 px-3 py-2 text-sm" data-sh-group={g.shareholder ?? "none"}>
            <p className="font-semibold">{groupTitle(g)}</p>
            {g.prior && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Repaid by {formatDate(g.prior.dueOn)}? <span className="text-ink-3">Owed at the start {money(g.prior.openingCents)} · repaid {money(g.prior.repaidCents)} · not repaid {money(g.prior.unpaidCents)}</span></span>
                {confirmed ? pill("bg-success-soft text-success", "Confirmed", `${names.get(conf!.answered_by ?? "") ?? "The reviewer"}, ${formatDate(conf!.answered_at)}`)
                  : can && current ? <form action={confirmShRepaid}>{hidden("file_id", fileId)}{hidden("group", key)}<button type="submit" className="btn-secondary btn-compact">Confirm</button>{conf && <span className="ml-1.5 text-[11px] text-danger">Figures changed</span>}</form>
                  : <span className="text-[11.5px] text-ink-3">{current ? "For the reviewer" : "Click Update first"}</span>}
              </div>
            )}
            {g.flags.map((f) => {
              const a = sh.flags.find((x) => x.account_key === key && x.flag === f);
              return (
                <div key={f} className="grid gap-1.5 rounded bg-[#fffbf0] px-2 py-1.5" data-sh-flag={f}>
                  <p className="font-medium">{flagText(f, f === "earlier_debit" ? g.earlierDebitCents : g.lastPartCents, sh.yearEnd)}</p>
                  {a?.note && <p className="text-[12px]">Preparer (before piece 8): <i>{a.note}</i></p>}
                  {!a || !current ? <p className="text-[11.5px] text-ink-3">Click Update first.</p>
                    : a.accepted_at ? <p>{pill("bg-success-soft text-success", "Decided", `${names.get(a.accepted_by ?? "") ?? "The reviewer"}, ${formatDate(a.accepted_at)}`)}{" "}
                        <i>{a.accepted_kind === "included" && a.accepted_year ? decisionText({ kind: "included", incomeYear: a.accepted_year }) : a.accepted_kind === "not_included" ? decisionText({ kind: "not_included", why: a.accepted_why }) : a.accepted_why}</i></p>
                    : !can ? <p className="text-[11.5px] text-ink-3">For the reviewer.</p>
                    : f === "earlier_debit" ? (
                      <form action={acceptShFlag} className="grid gap-1.5">{hidden("file_id", fileId)}{hidden("account", key)}{hidden("flag", f)}
                        <label className="inline-flex flex-wrap items-center gap-1.5"><input type="radio" name="kind" value="included" required className="h-3.5 w-3.5" />Included in the shareholder&rsquo;s income for
                          <select name="year" defaultValue={YEAR - 1} aria-label="Year included" className="rounded border border-sand-300 px-1 py-0.5">{[YEAR - 3, YEAR - 2, YEAR - 1, YEAR].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
                        <label className="inline-flex flex-wrap items-center gap-1.5"><input type="radio" name="kind" value="not_included" className="h-3.5 w-3.5" />Not included, because
                          <input name="why" maxLength={300} aria-label="Why not included" placeholder="Reason (needed for Not included)" className="min-w-72 flex-1 rounded border border-sand-300 px-1.5 py-0.5" /></label>
                        <span><button type="submit" className="btn-secondary btn-compact">Decide</button></span></form>
                    ) : (
                      <form action={acceptShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", key)}{hidden("flag", f)}
                        <input name="why" required minLength={3} maxLength={300} aria-label="Reviewer's decision" placeholder="What was decided" className="min-w-72 flex-1 rounded border border-sand-300 px-1.5 py-0.5" />
                        <button type="submit" className="btn-secondary btn-compact">Decide</button></form>
                    )}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
