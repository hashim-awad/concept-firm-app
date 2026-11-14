// Step 5, the shareholder loan schedule (round 14). Benchmark: CaseWare's shareholder loan continuity
// working paper: for each account on a due to or due from shareholder line, the opening balance (step 2),
// the year's movements grouped by kind (each drills to its postings), the closing balance and the tie to
// the trial balance. The s.15(2) test is on each shareholder's accounts together (fix 2): a net debit at
// year end is split by when it arose, repayments against the oldest balance first (fix 1). Last year's
// part has passed its s.15(2) date (this year end) and goes to the reviewer; this year's part gets next
// year end as its date and goes on My day. A balance owed at the start of the year is answered from this
// year's postings: the preparer confirms it. The database applies the same rules to step 5's sign-off.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { flagText, shareholderLabel, type ShGroup, type ShItem, type ShSchedule } from "@/lib/closebook/sh-loans";
import { groupKey, type ShData } from "@/lib/closebook/sh-server";
import { acceptShFlag, answerShFlag, confirmShRepaid, prepareShSchedule, setShOwner } from "../sh-actions";

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
  const current = !!st.prepared_at && !st.stale;

  // One account's continuity, with the shareholder it belongs to.
  const account = (r: ShSchedule) => {
    const o = sh.owners[r.key];
    return (
      <div key={r.key} className="mb-3 rounded-lg border border-sand-200" id={`sh-${r.number}`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 bg-sand-50 px-3 py-2">
          <span className="flex-1 font-medium">{r.number} {r.name} <span className="text-xs font-normal text-ink-3">GIFI {r.line_no.slice(0, 4)}</span></span>
          {o.source === "chart" ? <span className="text-xs text-ink-3">{shareholderLabel(o.shareholder)} (standard chart)</span> : editable ? (
            <form action={setShOwner} className="flex items-center gap-1 text-xs">{hidden("file_id", fileId)}{hidden("account", r.key)}
              <select name="shareholder" defaultValue={o.shareholder ?? ""} required className="input input-compact">
                <option value="" disabled>Whose account?</option>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Shareholder {n}</option>)}
              </select>
              <button type="submit" className="btn-secondary btn-compact">Save</button>
              {o.source === "rolled" && <span className="text-ink-3">from last year&rsquo;s file</span>}
            </form>
          ) : <span className="text-xs text-ink-3">{shareholderLabel(o.shareholder)}</span>}
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
      </div>
    );
  };

  const line = (label: React.ReactNode, c: number | null, cls = "") => (
    <div className={`flex justify-between px-3 py-1 ${cls}`}><span>{label}</span><span className="tabular-nums">{c === null ? "" : amt(c)}</span></div>
  );
  // The s.15(2) test on the shareholder's accounts together.
  const test = (g: ShGroup) => {
    const key = groupKey(g);
    const accts = sh.rows.filter((r) => g.keys.includes(r.key));
    const conf = sh.repaid.find((x) => x.account_key === key);
    const confirmed = !!g.prior && !!conf && conf.due_on === g.prior.dueOn && Math.round(conf.repaid * 100) === g.prior.repaidCents && Math.round(conf.unpaid * 100) === g.prior.unpaidCents;
    return (
      <div className="rounded-lg border border-navy-200 text-sm" id={`sh-test-${g.shareholder ?? "none"}`}>
        <div className="border-b border-navy-200 bg-navy-50 px-3 py-2 font-medium">s.15(2) test: {shareholderLabel(g.shareholder)}&rsquo;s accounts together</div>
        {accts.map((r) => line(<span className="text-ink-2">{r.number} {r.name}, closing</span>, r.closingCents))}
        {line("Net balance at the start of the year", g.openingCents, "border-t border-sand-200")}
        <details>
          <summary className="flex cursor-pointer justify-between px-3 py-1"><span>Reductions in the year <span className="text-xs text-ink-3">· repayments and credits, netted across these accounts</span></span><span className="tabular-nums">{g.reductionsCents ? `(${fmt(g.reductionsCents)})` : "0.00"}</span></summary>
          {g.reductions.length ? items(g.reductions) : <p className="ml-6 pb-1 text-xs text-ink-3">None.</p>}
        </details>
        {line(<b>Net balance at year end, {side(g.closingCents)}</b>, g.closingCents, "border-t border-sand-300 font-semibold")}
        {g.closingCents > 0 ? (<>
          {line(<>Last year&rsquo;s part <span className="text-xs text-ink-3">· the opening debit less the year&rsquo;s reductions; s.15(2) date {formatDate(sh.yearEnd)}, passed</span></>, g.lastPartCents)}
          {line(<>This year&rsquo;s part <span className="text-xs text-ink-3">· the rest</span></>, g.thisPartCents)}
          {g.dueOn && <div className="border-t border-sand-200 bg-warning-soft px-3 py-2"><b>s.15(2) repayment date: {formatDate(g.dueOn)}</b> for this year&rsquo;s part of {fmt(g.thisPartCents)}. Unless it is repaid by then (and not as part of a series of loans and repayments), it is income to the shareholder. The date shows on My day until next year&rsquo;s file confirms the repayment.</div>}
        </>) : <p className="border-t border-sand-200 px-3 py-2 text-ink-2">{g.closingCents < 0 ? `The company owes the shareholder ${fmt(g.closingCents)} net at year end` : "The net balance is nil at year end"}: no s.15(2) date.</p>}
        {!g.datesKnown && <p className="border-t border-sand-200 px-3 py-2 text-xs text-ink-3">The client keeps their own books, so the dates of their postings are not here: the check for a repayment in the last {sh.windowDays} days of the year needs their ledger.</p>}
        {g.prior && (
          <div className="grid gap-1 border-t border-sand-200 px-3 py-2">
            <p><b>Repaid by {formatDate(g.prior.dueOn)}?</b> Owed at the start of the year: {fmt(g.prior.openingCents)}. From this year&rsquo;s postings, repayments going against it first:</p>
            <p className="pl-3">Repaid: <b className="tabular-nums">{fmt(g.prior.repaidCents)}</b> · Not repaid: <b className="tabular-nums">{fmt(g.prior.unpaidCents)}</b>{g.prior.unpaidCents > 0 && <span className="text-ink-3"> (to the reviewer, below)</span>}</p>
            {confirmed ? <p>{chip("bg-success-soft text-success", `Confirmed by ${names.get(conf!.answered_by ?? "") ?? "staff"}, ${formatDate(conf!.answered_at)}`)}</p>
              : editable && current ? <form action={confirmShRepaid}>{hidden("file_id", fileId)}{hidden("group", key)}<button type="submit" className="btn-secondary btn-compact">Confirm</button>{conf && <span className="ml-2 text-xs text-danger">The figures changed since they were confirmed.</span>}</form>
              : <p className="text-xs text-ink-3">{current ? "Not confirmed yet." : "Prepare the schedule to confirm."}</p>}
          </div>
        )}
        {g.flags.map((f) => {
          const a = sh.flags.find((x) => x.account_key === key && x.flag === f);
          return (
            <div key={f} className="grid gap-2 border-t border-sand-200 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">{chip("bg-warning-soft text-warning", "For the reviewer")}<b>{flagText(f, g.lastPartCents, sh.yearEnd)}</b>
                {f === "late_repayment" && <span className="text-xs text-ink-3">The net balance was a debit in the last {sh.windowDays} days of the year and ends at {amt(g.closingCents)}.</span>}</div>
              {!a || !current ? <p className="text-xs text-ink-3">Prepare the schedule to answer this flag.</p> : (<>
                {a.note && <p>Preparer: <i>{a.note}</i> <span className="text-xs text-ink-3">{names.get(a.noted_by ?? "") ?? ""} {formatDate(a.noted_at)}</span></p>}
                {a.accepted_at ? <p>{chip("bg-success-soft text-success", `Accepted by ${names.get(a.accepted_by ?? "") ?? "the reviewer"}, ${formatDate(a.accepted_at)}`)} <i>{a.accepted_why}</i></p>
                  : a.note && isOwner && editable ? (
                    <form action={acceptShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", key)}{hidden("flag", f)}
                      <input name="why" required minLength={3} maxLength={300} className="input input-compact min-w-72 flex-1" placeholder="Reviewer: what was decided" />
                      <button type="submit" className="btn-secondary btn-compact">Accept</button></form>
                  ) : a.note ? <p className="text-xs text-ink-3">Waiting for the reviewer.</p> : null}
                {editable && !a.accepted_at && (
                  <form action={answerShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", key)}{hidden("flag", f)}
                    <input name="note" required minLength={3} maxLength={500} defaultValue={a.note} className="input input-compact min-w-72 flex-1" placeholder="What the reviewer needs to know" />
                    <button type="submit" className="btn-secondary btn-compact">{a.note ? "Save again" : "Answer"}</button></form>
                )}
              </>)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section id="sh-loans" className="card mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-semibold">Shareholder loan schedule</h2>
        {sh.rows.length > 0 && state}
        {editable && sh.rows.length > 0 && <form action={prepareShSchedule}>{hidden("file_id", fileId)}<button type="submit" className="btn-secondary btn-compact">{st.prepared_at ? "Prepare again" : "Prepare the schedule"}</button></form>}
      </div>
      <p className="mb-3 text-sm text-ink-2">Each account on a due to or due from shareholder line, as CaseWare&rsquo;s continuity working paper, then the s.15(2) test on each shareholder&rsquo;s accounts together. A balance in brackets is owed to the shareholder; a balance without brackets is owed by the shareholder to the company.</p>
      {sh.rows.length === 0 && <p className="text-sm text-ink-3">No account on a shareholder line this year.</p>}
      {st.problems.length > 0 && <ul className="mb-3 list-disc pl-5 text-sm text-danger">{st.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {sh.groups.map((g) => (
        <div key={groupKey(g)} className="mb-5" id={`sh-group-${g.shareholder ?? "none"}`}>
          <h3 className="mb-2 flex flex-wrap items-center gap-2 font-semibold">{shareholderLabel(g.shareholder)}
            {g.shareholder !== null && <span className="text-sm font-normal text-ink-2">net {fmt(g.closingCents)} {side(g.closingCents)} at year end</span>}</h3>
          {sh.rows.filter((r) => g.keys.includes(r.key)).map(account)}
          {g.shareholder !== null ? test(g) : <p className="text-sm text-danger">Pick whose account this is: the s.15(2) test runs on each shareholder&rsquo;s accounts together.</p>}
        </div>
      ))}
      {st.waiting.length > 0 && <p className="text-sm text-warning">For the reviewer: {st.waiting.join(" ")}</p>}
    </section>
  );
}
