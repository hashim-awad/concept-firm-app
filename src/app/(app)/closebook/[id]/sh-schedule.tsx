// Step 5, the shareholder loan schedule (round 14). Benchmark: CaseWare's shareholder loan continuity
// working paper: for each account on a due to or due from shareholder line, the opening balance (step 2),
// the year's movements grouped by kind (each drills to its postings), the closing balance and the tie to
// the trial balance. A debit balance at year end (the shareholder owes the company) gets its s.15(2)
// repayment date, one year after the year end; the two debit-balance checks go to the reviewer. The next
// year's file asks whether last year's balance was repaid by its date. The database applies the same
// rules to step 5's sign-off.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { FLAG_TEXT, type ShItem } from "@/lib/closebook/sh-loans";
import type { ShData } from "@/lib/closebook/sh-server";
import { acceptShFlag, acceptShRepaid, answerShFlag, answerShRepaid, prepareShSchedule } from "../sh-actions";

const fmt = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (c: number) => (c < 0 ? `(${fmt(c)})` : fmt(c));
const side = (c: number) => (c > 0 ? "owed by the shareholder" : c < 0 ? "owed to the shareholder" : "nil");
const chip = (cls: string, t: React.ReactNode) => <span className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{t}</span>;

export function ShSchedule({ fileId, sh, editable, isOwner, names }: { fileId: string; sh: ShData; editable: boolean; isOwner: boolean; names: Map<string, string> }) {
  const st = sh.status;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const link = (i: ShItem) => i.kind === "bank" && i.acct ? `/closebook/${fileId}?step=code&account=${i.acct}&line=${i.ref}`
    : i.kind === "entry" ? `/closebook/${fileId}?step=entries#entry-${i.ref}` : null;
  const items = (list: ShItem[]) => (
    <table className="mb-2 ml-6 w-[calc(100%-1.5rem)] text-xs">
      <tbody>{list.map((i, n) => {
        const href = link(i);
        return <tr key={n} className="border-t border-sand-100"><td className="w-24 px-2 py-0.5 text-ink-3">{i.date ? formatDate(i.date) : ""}</td>
          <td className="px-2 py-0.5">{href ? <Link href={href} className="text-navy-700 hover:underline">{i.label || "(no description)"}</Link> : i.label}</td>
          <td className="w-32 px-2 py-0.5 text-right tabular-nums">{amt(i.cents)}</td></tr>;
      })}</tbody>
    </table>
  );
  const state = !st.prepared_at ? chip("bg-danger-soft text-danger", "Not prepared")
    : st.stale ? chip("bg-danger-soft text-danger", "The books changed: prepare it again")
    : chip("bg-success-soft text-success", `Prepared by ${names.get(st.prepared_by ?? "") ?? "staff"}, ${formatDate(st.prepared_at)}`);
  return (
    <section id="sh-loans" className="card mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-semibold">Shareholder loan schedule</h2>
        {sh.rows.length > 0 && state}
        {editable && sh.rows.length > 0 && <form action={prepareShSchedule}>{hidden("file_id", fileId)}<button type="submit" className="btn-secondary btn-compact">{st.prepared_at ? "Prepare again" : "Prepare the schedule"}</button></form>}
      </div>
      <p className="mb-3 text-sm text-ink-2">Each account on a due to or due from shareholder line, as CaseWare&rsquo;s continuity working paper. A balance in brackets is owed to the shareholder; a balance without brackets is owed by the shareholder to the company.</p>
      {sh.rows.length === 0 && <p className="text-sm text-ink-3">No account on a shareholder line this year.</p>}
      {st.problems.length > 0 && <ul className="mb-3 list-disc pl-5 text-sm text-danger">{st.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {sh.rows.map((r) => {
        const saved = sh.savedKeys.includes(r.key);
        const repaid = sh.repaid.find((x) => x.account_key === r.key);
        return (
          <div key={r.key} className="mb-4 rounded-lg border border-sand-200" id={`sh-${r.number}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 bg-sand-50 px-3 py-2">
              <span className="flex-1 font-medium">{r.number} {r.name} <span className="text-xs font-normal text-ink-3">GIFI {r.line_no.slice(0, 4)}</span></span>
              {r.tied ? chip("bg-success-soft text-success", "Ties to the trial balance") : chip("bg-danger-soft text-danger", `Does not tie: difference ${amt(r.closingCents - r.tbCents)}`)}
            </div>
            <div className="text-sm">
              <details>
                <summary className="flex cursor-pointer justify-between px-3 py-1"><span>Opening balance (step 2)</span><span className="tabular-nums">{amt(r.openingCents)}</span></summary>
                {r.openingItems.length ? items(r.openingItems) : <p className="ml-6 pb-1 text-xs text-ink-3">No opening balance.</p>}
              </details>
              {r.movements.map((m) => (
                <details key={m.kind}>
                  <summary className="flex cursor-pointer justify-between px-3 py-1"><span>{m.label} <span className="text-xs text-ink-3">· {m.items.length} posting{m.items.length === 1 ? "" : "s"}</span></span><span className="tabular-nums">{amt(m.cents)}</span></summary>
                  {items(m.items)}
                </details>
              ))}
              <div className="flex justify-between border-t border-sand-300 px-3 py-1 font-semibold"><span>Closing balance, {side(r.closingCents)}</span><span className="tabular-nums">{amt(r.closingCents)}</span></div>
              <div className="flex justify-between px-3 py-1 text-ink-2"><span>Trial balance</span><span className="tabular-nums">{amt(r.tbCents)}</span></div>
            </div>
            {r.debitAtEnd && r.dueOn && (
              <div className="border-t border-sand-200 bg-warning-soft px-3 py-2 text-sm">
                <b>s.15(2) repayment date: {formatDate(r.dueOn)}.</b> The shareholder owes the company {fmt(r.closingCents)} at year end. Unless it is repaid by this date (and not as part of a series of loans and repayments), it is income to the shareholder. The date shows on My day until next year&rsquo;s file confirms the repayment.
              </div>
            )}
            {!r.datesKnown && !r.debitAtEnd && r.openingCents > 0 && (
              <p className="border-t border-sand-200 px-3 py-2 text-xs text-ink-3">The client keeps their own books, so the dates of their postings are not here: the check for a repayment in the last {sh.windowDays} days of the year needs their ledger.</p>
            )}
            {r.flags.map((f) => {
              const a = sh.flags.find((x) => x.account_key === r.key && x.flag === f);
              return (
                <div key={f} className="grid gap-2 border-t border-sand-200 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">{chip("bg-warning-soft text-warning", "For the reviewer")}<b>{FLAG_TEXT[f]}</b>
                    {f === "late_repayment" && <span className="text-xs text-ink-3">The balance was a debit in the last {sh.windowDays} days of the year and ends at {amt(r.closingCents)}.</span>}</div>
                  {!saved || !a ? <p className="text-xs text-ink-3">Prepare the schedule to answer this flag.</p> : (<>
                    {a.note && <p>Preparer: <i>{a.note}</i> <span className="text-xs text-ink-3">{names.get(a.noted_by ?? "") ?? ""} {formatDate(a.noted_at)}</span></p>}
                    {a.accepted_at ? <p>{chip("bg-success-soft text-success", `Accepted by ${names.get(a.accepted_by ?? "") ?? "the reviewer"}, ${formatDate(a.accepted_at)}`)} <i>{a.accepted_why}</i></p>
                      : a.note && isOwner && editable ? (
                        <form action={acceptShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", r.key)}{hidden("flag", f)}
                          <input name="why" required minLength={3} maxLength={300} className="input input-compact min-w-72 flex-1" placeholder="Reviewer: why it is accepted" />
                          <button type="submit" className="btn-secondary btn-compact">Accept</button></form>
                      ) : a.note ? <p className="text-xs text-ink-3">Waiting for the reviewer.</p> : null}
                    {editable && !a.accepted_at && (
                      <form action={answerShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", r.key)}{hidden("flag", f)}
                        <input name="note" required minLength={3} maxLength={500} defaultValue={a.note} className="input input-compact min-w-72 flex-1" placeholder="What the reviewer needs to know" />
                        <button type="submit" className="btn-secondary btn-compact">{a.note ? "Save again" : "Answer"}</button></form>
                    )}
                  </>)}
                </div>
              );
            })}
            {r.priorDueOn && (
              <div className="grid gap-2 border-t border-sand-200 px-3 py-2 text-sm">
                <p><b>Last year&rsquo;s s.15(2) date: {formatDate(r.priorDueOn)}.</b> The shareholder owed the company {fmt(r.openingCents)} at the start of the year. Repaid by {formatDate(r.priorDueOn)}?</p>
                {repaid && (
                  <p>{repaid.answer === "yes" ? chip("bg-success-soft text-success", "Yes") : chip("bg-warning-soft text-warning", "No: for the reviewer")}{" "}
                    {repaid.answer === "yes" ? <>Evidence: {repaid.evidence_label}</> : <i>{repaid.note}</i>}
                    <span className="text-xs text-ink-3"> · {names.get(repaid.answered_by ?? "") ?? ""} {formatDate(repaid.answered_at)}</span></p>
                )}
                {repaid?.answer === "no" && (repaid.accepted_at ? <p>{chip("bg-success-soft text-success", `Accepted by ${names.get(repaid.accepted_by ?? "") ?? "the reviewer"}, ${formatDate(repaid.accepted_at)}`)} <i>{repaid.accepted_why}</i></p>
                  : isOwner && editable ? (
                    <form action={acceptShRepaid} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", r.key)}
                      <input name="why" required minLength={3} maxLength={300} className="input input-compact min-w-72 flex-1" placeholder="Reviewer: what was decided (for example, the amount included in income)" />
                      <button type="submit" className="btn-secondary btn-compact">Accept</button></form>
                  ) : null)}
                {editable && saved && !(repaid?.accepted_at) && (
                  <form action={answerShRepaid} className="grid gap-2 rounded border border-sand-200 p-2">{hidden("file_id", fileId)}{hidden("account", r.key)}
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-1"><input type="radio" name="answer" value="yes" required defaultChecked={repaid?.answer === "yes"} /> Yes</label>
                      <select name="evidence" className="input input-compact max-w-md" defaultValue={repaid?.evidence_ref ? `${repaid.evidence_kind}:${repaid.evidence_ref}` : ""}>
                        <option value="">Evidence: the bank line or entry</option>
                        {r.repayments.filter((i) => i.date <= r.priorDueOn!).map((i) => <option key={`${i.kind}:${i.ref}`} value={`${i.kind}:${i.ref}`}>{formatDate(i.date)} {i.label} {amt(i.cents)}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-1"><input type="radio" name="answer" value="no" defaultChecked={repaid?.answer === "no"} /> No</label>
                      <input name="note" maxLength={500} defaultValue={repaid?.note} className="input input-compact min-w-72 flex-1" placeholder="No: what happened, for the reviewer" />
                    </div>
                    <button type="submit" className="btn-secondary btn-compact w-fit">Save the answer</button>
                  </form>
                )}
                {editable && !saved && <p className="text-xs text-ink-3">Prepare the schedule to answer.</p>}
              </div>
            )}
          </div>
        );
      })}
      {st.waiting.length > 0 && <p className="text-sm text-warning">For the reviewer: {st.waiting.join(" ")}</p>}
    </section>
  );
}
