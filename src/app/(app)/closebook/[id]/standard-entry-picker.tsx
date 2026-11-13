"use client";
// "Add standard entry" (Hashim, Nov 15, 2026, layout item 6; benchmark: CaseWare's standard entries):
// pick one of the owner-set entries and enter the amount only. Accounts, type, memo and W/P ref come
// from Settings, Closebook, Standard entries, and show here before adding.
import { useState } from "react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { addStandardEntry } from "../actions";

export type StdOption = { id: string; name: string; kind: string; debit: string; credit: string; memo: string; wp_ref: string };

export function StandardEntryPicker({ fileId, options, threshold }: { fileId: string; options: StdOption[]; threshold: number }) {
  const [id, setId] = useState("");
  const [amount, setAmount] = useState("");
  const e = options.find((o) => o.id === id);
  const cents = parseAmount(amount);
  return (
    <form action={addStandardEntry} className="card mb-4 grid gap-3">
      <h2 className="font-semibold">Add standard entry</h2>
      <input type="hidden" name="file_id" value={fileId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <label className="grid gap-1 text-sm">Standard entry
          <select name="standard" value={id} onChange={(x) => setId(x.target.value)} required className="input">
            <option value="">Choose</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
        <label className="grid gap-1 text-sm">Amount
          <input name="amount" inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} onBlur={(x) => setAmount(tidyAmount(x.target.value))} required className="input text-right tabular-nums" /></label>
        <button type="submit" className="btn" disabled={!e || !cents || cents <= 0}>Add the entry</button>
      </div>
      {e && (
        <table className="w-full text-sm">
          <tbody>
            <tr><td className="w-36 text-ink-3">Type</td><td>{e.kind}</td></tr>
            <tr><td className="text-ink-3">Debit</td><td>{e.debit}</td><td className="text-right tabular-nums">{cents && cents > 0 ? formatAmount(cents) : ""}</td></tr>
            <tr><td className="text-ink-3">Credit</td><td>{e.credit}</td><td className="text-right tabular-nums">{cents && cents > 0 ? formatAmount(cents) : ""}</td></tr>
            <tr><td className="text-ink-3">Memo</td><td colSpan={2}>{e.memo}</td></tr>
            <tr><td className="text-ink-3">W/P ref</td><td colSpan={2}>{e.wp_ref}</td></tr>
          </tbody>
        </table>
      )}
      {e && cents !== null && cents > 0 && <p className="text-xs text-ink-2">{cents > threshold * 100 ? `Over ${formatAmount(threshold * 100)}: it goes to the reviewer.` : `At or under ${formatAmount(threshold * 100)}: no review needed.`}</p>}
    </form>
  );
}
