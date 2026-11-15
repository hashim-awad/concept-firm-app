// Step 5, the shareholder loan schedule (round 14). Benchmark: CaseWare's shareholder loan continuity
// working paper: for each account on a due to or due from shareholder line, the opening balance (step 2),
// the year's movements grouped by kind (each drills to its postings), the closing balance and the tie to
// the trial balance. The s.15(2) test is on each shareholder's accounts together (fix 2): a net debit at
// year end is split by when it arose, repayments against the oldest balance first (fix 1). Last year's
// part has passed its s.15(2) date (this year end) and goes to the reviewer; this year's part gets next
// year end as its date and goes on My day. A balance owed at the start of the year is answered from this
// year's postings: the preparer confirms it. The database applies the same rules to step 5's sign-off.
// Round 15 (CaseWare Cloud): one table per shareholder, accounts as rows and the kinds as columns; each
// amount opens its postings; the s.15(2) lines, "Repaid by" and the flags sit under the net row.
import Link from "next/link";
import { Check } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { flagText, KIND_LABEL, KIND_ORDER, shareholderLabel, type ShGroup, type ShItem, type ShKind } from "@/lib/closebook/sh-loans";
import { groupKey, type ShData } from "@/lib/closebook/sh-server";
import { acceptShFlag, answerShFlag, confirmShRepaid, prepareShSchedule, setShOwner } from "../sh-actions";
import { Popover } from "./shell/ui";
import { InfoTip } from "@/components/ds/info-tip";

const fmt = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (c: number) => (c < 0 ? `(${fmt(c)})` : fmt(c));
const pill = (cls: string, t: React.ReactNode, title?: string) => <span title={title} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{t}</span>;
const COL: Record<ShKind, string> = { paid: "Paid", repaid: "Repaid", expenses: "Expenses", dividends: "Dividends", salary: "Salary, bonus", books: "Books", other: "Other" };

export function ShSchedule({ fileId, sh, editable, isOwner, names }: { fileId: string; sh: ShData; editable: boolean; isOwner: boolean; names: Map<string, string> }) {
  const st = sh.status;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const link = (i: ShItem) => i.kind === "bank" && i.acct ? `/closebook/${fileId}?step=code&account=${i.acct}&line=${i.ref}`
    : i.kind === "entry" ? `/closebook/${fileId}?area=entries&open=${i.ref}` : null;
  const items = (title: string, list: ShItem[]) => (
    <div><p className="mb-1.5 text-xs font-bold">{title}</p>
      <table className="w-full text-xs"><tbody>{list.map((i, n) => {
        const href = link(i);
        return <tr key={n} className="border-t border-sand-100"><td className="w-24 py-0.5 pr-2 text-ink-3">{i.date ? formatDate(i.date) : ""}</td>
          <td className="py-0.5">{href ? <Link href={href} className="text-navy-700 hover:underline">{i.label || "(no description)"}</Link> : i.label}</td>
          <td className="w-24 py-0.5 text-right tabular-nums">{amt(i.cents)}</td></tr>;
      })}</tbody></table></div>
  );
  const drill = (cents: number, title: string, list: ShItem[]) => !cents && !list.length ? <span className="text-[#9aa0ae]">–</span>
    : <Popover align="right" width="w-[30rem]" label={title} button={<span className="text-navy-700 hover:underline">{amt(cents)}</span>}>{items(title, list)}</Popover>;
  const current = !!st.prepared_at && !st.stale;
  const kinds = KIND_ORDER.filter((k) => sh.rows.some((r) => r.movements.some((m) => m.kind === k)) || ["paid", "repaid", "expenses", "dividends", "salary", "other"].includes(k)).filter((k) => k !== "books" || sh.own);
  const th = "px-2 py-1.5 text-right font-semibold whitespace-nowrap";

  const group = (g: ShGroup) => {
    const key = groupKey(g);
    const accts = sh.rows.filter((r) => g.keys.includes(r.key));
    const conf = sh.repaid.find((x) => x.account_key === key);
    const confirmed = !!g.prior && !!conf && conf.due_on === g.prior.dueOn && Math.round(conf.repaid * 100) === g.prior.repaidCents && Math.round(conf.unpaid * 100) === g.prior.unpaidCents;
    const sub = (label: React.ReactNode, right: React.ReactNode, extra?: React.ReactNode) => (
      <tr className="border-t border-sand-100 text-[12px]"><td className="px-2 py-1.5" colSpan={kinds.length + 1}>{label}</td><td className="px-2 py-1.5 text-right tabular-nums">{right}</td><td colSpan={2} className="px-2 py-1.5">{extra}</td></tr>
    );
    return (
      <table key={key} id={`sh-group-${g.shareholder ?? "none"}`} className="w-full min-w-[900px] border-collapse text-[12.5px]">
        <thead><tr className="bg-sand-50 text-[11px] text-ink-3">
          <th className="px-2 py-1.5 text-left font-semibold">{shareholderLabel(g.shareholder)}</th><th className={th}>Opening</th>
          {kinds.map((k) => <th key={k} className={th}>{COL[k]}</th>)}<th className={th}>Closing</th><th className={th}>TB</th><th />
        </tr></thead>
        <tbody>
          {accts.map((r) => {
            const o = sh.owners[r.key];
            return (
              <tr key={r.key} id={`sh-${r.number}`} className="border-t border-sand-100">
                <td className="px-2 py-1.5">{r.number} {r.name}
                  {o.source !== "chart" && (editable ? (
                    <form action={setShOwner} className="ml-2 inline-flex items-center gap-1 text-[11px]">{hidden("file_id", fileId)}{hidden("account", r.key)}
                      <select name="shareholder" defaultValue={o.shareholder ?? ""} required aria-label="Whose account" className="rounded border border-sand-300 px-1 py-0.5">
                        <option value="" disabled>Whose?</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Shareholder {n}</option>)}</select>
                      <button type="submit" className="font-semibold text-navy-700 underline">Save</button>{o.source === "rolled" && <span className="text-ink-3">from last year</span>}
                    </form>) : <span className="ml-2 text-[11px] text-ink-3">{shareholderLabel(o.shareholder)}</span>)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{drill(r.openingCents, `${r.number} ${r.name} · Opening (step 2)`, r.openingItems)}</td>
                {kinds.map((k) => { const m = r.movements.find((x) => x.kind === k); return <td key={k} className="px-2 py-1.5 text-right tabular-nums">{m ? drill(m.cents, `${r.number} ${r.name} · ${KIND_LABEL[k]}`, m.items) : <span className="text-[#9aa0ae]">–</span>}</td>; })}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{amt(r.closingCents)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.tied ? <span className="text-success" title="Ties to the trial balance"><Check className="inline h-3.5 w-3.5" /></span>
                  : <span className="text-danger" title={`Trial balance ${amt(r.tbCents)}`}>{amt(r.closingCents - r.tbCents)}</span>}</td><td />
              </tr>
            );
          })}
          {g.shareholder !== null ? (<>
            <tr className="border-t border-sand-200 bg-navy-50 font-bold">
              <td className="px-2 py-1.5">Net, {g.closingCents > 0 ? "owed by the shareholder" : g.closingCents < 0 ? "owed to the shareholder" : "nil"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{amt(g.openingCents)}</td><td colSpan={kinds.length} />
              <td className="px-2 py-1.5 text-right tabular-nums">{amt(g.closingCents)}</td>
              <td colSpan={2} className="px-2 py-1.5 font-semibold whitespace-nowrap text-ink-2">{g.closingCents > 0 && g.dueOn ? `s.15(2): ${formatDate(g.dueOn)}` : g.closingCents > 0 ? "s.15(2): passed" : "s.15(2): none"}</td>
            </tr>
            {g.closingCents > 0 && <>
              {sub(<>Reductions in the year <span className="text-ink-3">· netted across the accounts</span></>, drill(-g.reductionsCents, "Reductions in the year", g.reductions))}
              {sub(<>Last year&rsquo;s part <span className="text-ink-3">· s.15(2) date {formatDate(sh.yearEnd)}, passed</span></>, amt(g.lastPartCents))}
              {sub(<>This year&rsquo;s part</>, amt(g.thisPartCents), g.dueOn ? pill("bg-warning-soft text-warning", `Repay by ${formatDate(g.dueOn)}`) : null)}
            </>}
            {/* Round 16: a part the reviewer decided in an earlier file: shown, not flagged again, until repaid. */}
            {g.carried && g.carried.leftCents > 0 && sub(<>Flagged in the {g.carried.year} file <span className="text-ink-3">· {g.carried.why || "Decided by the reviewer"}</span></>, amt(g.carried.leftCents),
              pill("bg-sand-100 text-ink-2", "Decided"))}
            {g.carried && g.carried.repaidCents > 0 && sub(<>Repaid this year from the part flagged in the {g.carried.year} file
              <InfoTip>For the shareholder&rsquo;s T1: the repayment may give a deduction under s.20(1)(j) for the amount included in income under s.15(2).</InfoTip></>,
              amt(g.carried.repaidCents), pill("bg-navy-50 text-navy-700", "Note for the T1"))}
            {!g.datesKnown && sub(<span className="text-ink-3">Own books: no dates, so no {sh.windowDays}-day check.</span>, "")}
            {g.prior && sub(<>Repaid by {formatDate(g.prior.dueOn)}? <span className="text-ink-3">Owed at the start {fmt(g.prior.openingCents)} · repaid {fmt(g.prior.repaidCents)} · not repaid {fmt(g.prior.unpaidCents)}</span></>, "",
              confirmed ? pill("bg-success-soft text-success", "Confirmed", `${names.get(conf!.answered_by ?? "") ?? "Staff"}, ${formatDate(conf!.answered_at)}`)
                : editable && current ? <form action={confirmShRepaid} className="inline">{hidden("file_id", fileId)}{hidden("group", key)}<button type="submit" className="btn-secondary btn-compact">Confirm</button>{conf && <span className="ml-1.5 text-[11px] text-danger">Figures changed</span>}</form>
                : <span className="text-[11px] text-ink-3">{current ? "Not confirmed" : "Prepare first"}</span>)}
            {g.flags.map((f) => {
              const a = sh.flags.find((x) => x.account_key === key && x.flag === f);
              return (
                <tr key={f} className="border-t border-sand-100 bg-[#fffbf0] text-[12px]"><td colSpan={kinds.length + 5} className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">{pill("bg-warning-soft text-warning", "Reviewer")}<b className="font-semibold">{flagText(f, f === "earlier_debit" ? g.earlierDebitCents : g.lastPartCents, sh.yearEnd)}</b></div>
                  {!a || !current ? <p className="mt-1 text-[11px] text-ink-3">Prepare the schedule to answer.</p> : (
                    <div className="mt-1.5 grid gap-1.5">
                      {a.note && <p>Preparer: <i>{a.note}</i> <span className="text-[11px] text-ink-3">{names.get(a.noted_by ?? "") ?? ""} {formatDate(a.noted_at)}</span></p>}
                      {a.accepted_at ? <p>{pill("bg-success-soft text-success", "Accepted", `${names.get(a.accepted_by ?? "") ?? "The reviewer"}, ${formatDate(a.accepted_at)}`)} <i>{a.accepted_why}</i></p>
                        : a.note && isOwner && editable ? (
                          <form action={acceptShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", key)}{hidden("flag", f)}
                            <input name="why" required minLength={3} maxLength={300} aria-label="Reviewer's reason" placeholder="Reviewer: what was decided" className="min-w-72 flex-1 rounded border border-sand-300 px-1.5 py-0.5" />
                            <button type="submit" className="btn-secondary btn-compact">Accept</button></form>
                        ) : null}
                      {editable && !a.accepted_at && (
                        <form action={answerShFlag} className="flex flex-wrap items-center gap-2">{hidden("file_id", fileId)}{hidden("account", key)}{hidden("flag", f)}
                          <input name="note" required minLength={3} maxLength={500} defaultValue={a.note} aria-label="Answer for the reviewer" placeholder="Answer for the reviewer" className="min-w-72 flex-1 rounded border border-sand-300 px-1.5 py-0.5" />
                          <button type="submit" className="btn-secondary btn-compact">{a.note ? "Save again" : "Answer"}</button></form>
                      )}
                    </div>
                  )}
                </td></tr>
              );
            })}
          </>) : (
            <tr className="border-t border-sand-100"><td colSpan={kinds.length + 5} className="px-2 py-1.5 text-[12px] text-danger">Pick whose account this is.</td></tr>
          )}
        </tbody>
      </table>
    );
  };

  return (
    <section id="sh-loans" aria-label="Shareholder loans" className="mb-3.5 rounded-[10px] border border-sand-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3.5 py-2.5">
        <h3 className="text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase">Shareholder loans</h3>
        {sh.rows.length > 0 && (!st.prepared_at ? pill("bg-danger-soft text-danger", "Not prepared") : st.stale ? pill("bg-danger-soft text-danger", "Books changed")
          : pill("bg-navy-100 text-navy-800", `Prepared ${(names.get(st.prepared_by ?? "") ?? "").split(/\s+/).map((w) => w[0]).join("")} ${formatDate(st.prepared_at)}`))}
        <span className="flex-1" />
        {editable && sh.rows.length > 0 && <form action={prepareShSchedule}>{hidden("file_id", fileId)}<button type="submit" className="btn-secondary btn-compact">{st.prepared_at ? "Prepare again" : "Prepare"}</button></form>}
      </div>
      {st.problems.length > 0 && <ul className="border-b border-sand-200 px-3.5 py-1.5 text-[12px] text-danger">{st.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {sh.rows.length === 0 ? <p className="px-3.5 py-2.5 text-[12.5px] text-ink-3">No account on a shareholder line.</p>
        : <div className="overflow-x-auto">{sh.groups.map(group)}</div>}
      {st.waiting.length > 0 && <p className="border-t border-sand-200 px-3.5 py-1.5 text-[12px] text-warning">With the reviewer: {st.waiting.join(" ")}</p>}
    </section>
  );
}
