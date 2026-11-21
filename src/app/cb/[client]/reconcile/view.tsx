"use client";
// CB2-1 PR B part j: Reconcile (QBO). Account, statement ending date and balance; tick the cleared lines; the difference
// shows live. Finish works with a warning when the difference is not zero, and the difference is recorded.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
import { bracketAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { formatDate, formatDateTime } from "@/lib/dates";
import { isOut } from "@/lib/books/bank";
import { Picker } from "../../picker";
import { finishReconcile, undoReconcile } from "../../bank-actions";

export type RecLine = { id: string; date: string; description: string; cents: number };
export type PastRec = { id: string; date: string; ending: number; cleared: number; difference: number; lines: number; status: "finished" | "undone"; who: string; at: string; latest: boolean };
const money = (c: number) => `$${bracketAmount(c)}`;

function PastMenu({ clientId, r, canEdit }: { clientId: string; r: PastRec; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const item = "block w-full px-3 py-2 text-left text-[13px] hover:bg-sand-100";
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-label={`More for the reconciliation to ${formatDate(r.date)}`} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded p-1 hover:bg-sand-100" data-rec-menu><MoreHorizontal className="h-4 w-4" /></button>
      {err && <p role="alert" className="absolute right-0 top-full z-40 mt-1 w-56 rounded bg-white p-2 text-[12px] font-semibold text-danger shadow">{err}</p>}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-sand-200 bg-white py-1 shadow-xl">
          <Link href={`/cb/${clientId}/reconcile/${r.id}`} className={item}>View report</Link>
          {canEdit && r.status === "finished" && <button type="button" className={item} data-rec-undo onClick={() => start(async () => {
            setOpen(false); setErr("");
            if (!r.latest) { setErr("Undo the later reconciliation first."); return; }
            if (!window.confirm(`Undo the reconciliation to ${formatDate(r.date)}? Its lines go back to not reconciled.`)) return;
            const res = await undoReconcile(clientId, r.id);
            if (!res.ok) setErr(res.error); else router.refresh();
          })}>Undo</button>}
        </div>
      )}
    </div>
  );
}

export function ReconcileView({ clientId, accounts, ident, date, ending, beginning, opening, lines, pending, past, canEdit }: { clientId: string; opening: number;
  accounts: { value: string; label: string; kind: "bank" | "card" }[]; ident: string; date: string | null; ending: string; beginning: number; lines: RecLine[]; pending: number;
  past: PastRec[]; canEdit: boolean }) {
  const router = useRouter();
  const base = `/cb/${clientId}/reconcile`;
  const [acct, setAcct] = useState(ident);
  const [d, setD] = useState(date ?? "");
  const [end, setEnd] = useState(ending ? tidyAmount(ending) : "");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState(false);
  const [busy, start] = useTransition();
  const kind = accounts.find((a) => a.value === ident)?.kind ?? "bank";
  const endC = parseAmount(ending) ?? null;
  const cleared = lines.filter((l) => ticked.has(l.id));
  const out = cleared.filter((l) => isOut(kind, l.cents)).reduce((n, l) => n + Math.abs(l.cents), 0);
  const inn = cleared.filter((l) => !isOut(kind, l.cents)).reduce((n, l) => n + Math.abs(l.cents), 0);
  const clearedBal = beginning + cleared.reduce((n, l) => n + l.cents, 0);
  const diff = endC === null ? null : endC - clearedBal;
  const started = !!date && endC !== null;
  const outWord = kind === "card" ? "Charges" : "Payments", inWord = kind === "card" ? "Payments and credits" : "Deposits";

  const finish = () => start(async () => {
    setErr(""); setWarn(false);
    const r = await finishReconcile(clientId, ident, date!, endC! / 100, cleared.map((l) => l.id), opening / 100);
    if (!r.ok) { setErr(r.error); return; }
    setTicked(new Set());
    router.push(`${base}/${r.id}`);
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <h1 className="text-[22px] font-bold">Reconcile</h1>
      {!accounts.length ? <div className="card p-5 text-[14px]">This client has no bank or card account yet.</div> : <>
        <form className="card grid gap-3 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" data-rec-start
          onSubmit={(e) => { e.preventDefault(); const c = parseAmount(end); if (!d || c === null) { setErr("Enter the statement ending date and balance."); return; }
            setErr(""); setTicked(new Set()); router.push(`${base}?${new URLSearchParams({ account: acct, date: d, ending: String(c / 100) })}`); }}>
          <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Account<Picker value={acct} options={accounts} onChange={(v) => { setAcct(v); router.push(`${base}?account=${encodeURIComponent(v)}`); }} ariaLabel="Account" compact /></label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Statement ending date<input type="date" value={d} onChange={(e) => setD(e.target.value)} className="input input-compact" data-rec-date /></label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Ending balance<input value={end} onChange={(e) => setEnd(e.target.value)} onBlur={(e) => setEnd(tidyAmount(e.target.value))} inputMode="decimal" className="input input-compact text-right" data-rec-ending /></label>
          {canEdit && <button type="submit" className="btn btn-compact" data-rec-go>Start reconciling</button>}
          <p className="text-[12px] text-ink-3 sm:col-span-4">Beginning balance: <b>{money(beginning)}</b> ({past.some((p) => p.status === "finished") ? "the last reconciliation\u2019s ending balance" : "the account\u2019s opening balance in Books, at the first reconciliation"}).</p>
        </form>

        {started && (
          <>
            <div className="sticky top-0 z-10 grid grid-cols-2 gap-3 rounded-lg border border-sand-200 bg-white p-3 text-[13px] shadow-sm sm:grid-cols-6" data-rec-summary>
              <div><div className="text-[12px] text-ink-3">Statement ending balance</div><b className="tabular-nums">{money(endC!)}</b></div>
              <div><div className="text-[12px] text-ink-3">Beginning balance</div><b className="tabular-nums">{money(beginning)}</b></div>
              <div><div className="text-[12px] text-ink-3">{outWord} ({cleared.filter((l) => isOut(kind, l.cents)).length})</div><b className="tabular-nums">{money(out)}</b></div>
              <div><div className="text-[12px] text-ink-3">{inWord} ({cleared.filter((l) => !isOut(kind, l.cents)).length})</div><b className="tabular-nums">{money(inn)}</b></div>
              <div><div className="text-[12px] text-ink-3">Cleared balance</div><b className="tabular-nums">{money(clearedBal)}</b></div>
              <div><div className="text-[12px] text-ink-3">Difference</div><b className={`text-[16px] tabular-nums ${diff === 0 ? "text-success" : "text-danger"}`} data-rec-diff>{money(diff ?? 0)}</b></div>
            </div>
            {pending > 0 && <p className="text-[13px] text-ink-3" data-rec-pending>{pending} line{pending === 1 ? " is" : "s are"} still For review in Bank transactions and not in the books yet. <Link href={`/cb/${clientId}/bank?account=${encodeURIComponent(ident)}`} className="font-semibold text-navy-700 underline">Confirm them first</Link>.</p>}
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-[13px]" data-rec-table>
                <thead className="border-b border-sand-200 bg-sand-50 text-left text-[12px] text-ink-3"><tr>
                  <th className="px-2 py-2">Date</th><th className="px-2 py-2">Description</th><th className="px-2 py-2 text-right">{outWord}</th><th className="px-2 py-2 text-right">{inWord}</th>
                  <th className="w-16 px-3 py-2 text-center">{canEdit && <input type="checkbox" aria-label="Tick every line" checked={lines.length > 0 && lines.every((l) => ticked.has(l.id))}
                    onChange={(e) => setTicked(e.target.checked ? new Set(lines.map((l) => l.id)) : new Set())} />}</th></tr></thead>
                <tbody>
                  {!lines.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-3">No lines to reconcile up to this date.</td></tr>}
                  {lines.map((l) => (
                    <tr key={l.id} className={`border-b border-sand-100 ${ticked.has(l.id) ? "bg-navy-50" : ""}`} data-rec-line={l.id}>
                      <td className="whitespace-nowrap px-2 py-2">{formatDate(l.date)}</td><td className="px-2 py-2">{l.description}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{isOut(kind, l.cents) ? money(Math.abs(l.cents)) : ""}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{isOut(kind, l.cents) ? "" : money(Math.abs(l.cents))}</td>
                      <td className="px-3 py-2 text-center">{canEdit && <input type="checkbox" aria-label={`Cleared: ${l.description}`} checked={ticked.has(l.id)}
                        onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(l.id); else n.delete(l.id); setTicked(n); }} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {err && <p role="alert" className="text-[13px] font-semibold text-danger" data-rec-err>{err}</p>}
            {canEdit && !warn && <div><button type="button" className="btn" disabled={busy} onClick={() => (diff === 0 ? finish() : setWarn(true))} data-rec-finish>Finish now</button></div>}
            {warn && (
              <div role="alertdialog" aria-label="The difference is not zero" className="card grid gap-3 border-warning p-4 text-[14px]" data-rec-warn>
                <p className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle className="h-4 w-4" />The difference is {money(diff ?? 0)}, not zero.</p>
                <p>You can finish now. The difference is recorded with this reconciliation and shows on its report.</p>
                <div className="flex gap-2"><button type="button" className="btn btn-compact" disabled={busy} onClick={finish} data-rec-finish-anyway>Finish with the difference</button>
                  <button type="button" className="btn btn-ghost btn-compact" onClick={() => setWarn(false)}>Keep reconciling</button></div>
              </div>
            )}
          </>
        )}
        {!started && err && <p role="alert" className="text-[13px] font-semibold text-danger">{err}</p>}

        <div className="grid gap-2">
          <h2 className="text-[16px] font-bold">Past reconciliations</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-[13px]" data-rec-past>
              <thead className="border-b border-sand-200 bg-sand-50 text-left text-[12px] text-ink-3"><tr>
                <th className="px-3 py-2">Statement ending date</th><th className="px-2 py-2 text-right">Ending balance</th><th className="hidden px-2 py-2 text-right sm:table-cell">Lines cleared</th>
                <th className="px-2 py-2 text-right">Difference</th><th className="hidden px-2 py-2 md:table-cell">Reconciled</th><th className="px-2 py-2">Status</th><th className="w-10 px-2 py-2" /></tr></thead>
              <tbody>
                {!past.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-3">No reconciliation yet.</td></tr>}
                {past.map((r) => (
                  <tr key={r.id} className={`border-b border-sand-100 ${r.status === "undone" ? "text-ink-3" : ""}`} data-rec-row={r.date}>
                    <td className="px-3 py-2"><Link href={`${base}/${r.id}`} className="font-semibold text-navy-700 hover:underline">{formatDate(r.date)}</Link></td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(r.ending)}</td>
                    <td className="hidden px-2 py-2 text-right sm:table-cell">{r.lines}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${r.difference ? "font-semibold text-danger" : ""}`}>{money(r.difference)}</td>
                    <td className="hidden px-2 py-2 md:table-cell">{formatDateTime(r.at)}{r.who ? ` · ${r.who}` : ""}</td>
                    <td className="px-2 py-2">{r.status === "finished" ? "Reconciled" : "Undone"}</td>
                    <td className="px-2 py-2 text-right"><PastMenu clientId={clientId} r={r} canEdit={canEdit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>}
    </div>
  );
}
