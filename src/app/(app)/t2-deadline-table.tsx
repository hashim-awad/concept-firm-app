"use client";
// My day, T2 deadlines: tick the ones already filed or paid and mark them done together, or one at a time.
import Link from "next/link";
import { useState } from "react";
import { markDeadlinesDone } from "./my-day-actions";

type Item = { clientId: string; client: string; yearEnd: string; kind: "filing" | "balance"; due: string; days: number; yearEndText: string; dueText: string };

const key = (x: Item) => `${x.clientId}|${x.yearEnd}|${x.kind}`;

export function T2DeadlineTable({ items, editable }: { items: Item[]; editable: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = picked.size === items.length && items.length > 0;
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const due = (days: number) => days < 0 ? <span className="font-medium text-danger">{-days} day{days === -1 ? "" : "s"} overdue</span>
    : days === 0 ? <span className="font-medium text-danger">Due today</span> : <span className="text-muted">in {days} day{days === 1 ? "" : "s"}</span>;

  return (
    <form action={markDeadlinesDone}>
      {editable && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={picked.size === 0} className="btn h-9 px-3 text-sm disabled:opacity-50">
            Mark {picked.size || ""} selected done
          </button>
          <span className="text-xs text-muted">Tick the returns already filed or balances already paid.</span>
        </div>
      )}
      <table className="table">
        <thead><tr>
          {editable && <th className="w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setPicked(all ? new Set() : new Set(items.map(key)))} className="h-4 w-4 accent-navy-700" /></th>}
          <th>Client</th><th>Deadline</th><th>Year end</th><th>Due</th><th></th>{editable && <th></th>}
        </tr></thead>
        <tbody>{items.map((x) => (
          <tr key={key(x)}>
            {editable && <td><input type="checkbox" name="items" value={key(x)} checked={picked.has(key(x))} onChange={() => toggle(key(x))} aria-label={`Select ${x.client}, ${x.kind === "filing" ? "T2 filing" : "balance due"}`} className="h-4 w-4 accent-navy-700" /></td>}
            <td><Link href={`/clients/${x.clientId}`} className="font-medium text-navy-700 hover:underline">{x.client}</Link></td>
            <td>{x.kind === "filing" ? "T2 filing" : "Balance due"}</td>
            <td>{x.yearEndText}</td><td>{x.dueText}</td><td>{due(x.days)}</td>
            {editable && (
              <td className="text-right">
                <button type="submit" name="one" value={key(x)} className="btn-secondary h-8 px-3 text-sm" title={x.kind === "filing" ? "Mark the T2 as filed" : "Mark the balance as paid or not owing"}>Done</button>
              </td>
            )}
          </tr>
        ))}</tbody>
      </table>
    </form>
  );
}
