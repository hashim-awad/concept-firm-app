"use client";
// My day, T2 deadlines: tick the ones already filed or paid and mark them done together, or one at a time.
// With "Show done" on, done lines are listed too (who, when, why), each with Reopen.
import Link from "next/link";
import { useId, useState } from "react";
import { markDeadlinesDone, reopenDeadline } from "./my-day-actions";

export type DeadlineRow = {
  key: string; clientId: string; client: string; kindLabel: string; yearEndText: string; dueText: string; days: number;
  done?: { by: string; when: string; reason: string };
};

export function T2DeadlineTable({ items, editable, showDone }: { items: DeadlineRow[]; editable: boolean; showDone: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const reopenForm = useId();
  const open = items.filter((x) => !x.done);
  const live = new Set([...picked].filter((k) => open.some((x) => x.key === k)));
  const all = live.size === open.length && open.length > 0;
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const due = (days: number) => days < 0 ? <span className="font-medium text-danger">{-days} day{days === -1 ? "" : "s"} overdue</span>
    : days === 0 ? <span className="font-medium text-danger">Due today</span> : <span className="text-muted">in {days} day{days === 1 ? "" : "s"}</span>;

  return (
    <>
    {/* Reopen buttons submit this form (a form cannot sit inside the table's form). */}
    <form id={reopenForm} action={reopenDeadline} hidden>{showDone && <input type="hidden" name="view" value="done" />}</form>
    <form action={markDeadlinesDone}>
      {showDone && <input type="hidden" name="view" value="done" />}
      {editable && open.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={live.size === 0} className="btn h-9 px-3 text-sm disabled:opacity-50">
            Mark {live.size || ""} selected done
          </button>
          <span className="text-xs text-muted">Tick the returns already filed or balances already paid.</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr>
            {editable && <th className="w-8"><input type="checkbox" aria-label="Select all" checked={all} disabled={open.length === 0} onChange={() => setPicked(all ? new Set() : new Set(open.map((x) => x.key)))} className="h-4 w-4 accent-navy-700" /></th>}
            <th>Client</th><th>Deadline</th><th>Year end</th><th>Due</th><th></th>{editable && <th></th>}
          </tr></thead>
          <tbody>{items.map((x) => x.done ? (
            <tr key={x.key} className="text-ink-3">
              {editable && <td></td>}
              <td><Link href={`/clients/${x.clientId}`} className="font-medium text-ink-3 hover:underline">{x.client}</Link></td>
              <td>{x.kindLabel}</td>
              <td>{x.yearEndText}</td><td>{x.dueText}</td>
              <td className="text-xs">
                <span className="mr-1.5 rounded-full bg-sand-100 px-2 py-0.5 text-[11px] font-bold text-ink-3">Done</span>
                {x.done.by}, {x.done.when}
                {x.done.reason && <span className="mt-0.5 block">{x.done.reason}</span>}
              </td>
              {editable && (
                <td className="text-right">
                  <button type="submit" form={reopenForm} name="reopen" value={x.key} className="btn-secondary h-8 px-3 text-sm" title="Show this deadline as open again">Reopen</button>
                </td>
              )}
            </tr>
          ) : (
            <tr key={x.key}>
              {editable && <td><input type="checkbox" name="items" value={x.key} checked={live.has(x.key)} onChange={() => toggle(x.key)} aria-label={`Select ${x.client}, ${x.kindLabel}`} className="h-4 w-4 accent-navy-700" /></td>}
              <td><Link href={`/clients/${x.clientId}`} className="font-medium text-navy-700 hover:underline">{x.client}</Link></td>
              <td>{x.kindLabel}</td>
              <td>{x.yearEndText}</td><td>{x.dueText}</td><td>{due(x.days)}</td>
              {editable && (
                <td className="text-right">
                  <button type="submit" name="one" value={x.key} className="btn-secondary h-8 px-3 text-sm" title="Mark the return filed, or the balance paid or not owing">Done</button>
                </td>
              )}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </form>
    </>
  );
}
