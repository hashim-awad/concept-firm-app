"use client";
// Opening balances typed in by GIFI code (Hashim, Nov 13, 2026): code, amount, next line, as on the CRA
// T2 extract. The outage fallback: it needs no Claude tool. Enter in an amount adds the next line.
// The closing retained earnings (3660 + net income − dividends + adjustments) shows as you type, against
// last year's 3849.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openingFrom, type CodeInfo } from "@/lib/closebook/opening";
import { typedCents } from "@/lib/closebook/bank-upload";
import { saveOpeningManualInline } from "../actions";

const money = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

export function OpeningManual({ fileId, infoList, initial, reStated, closeHref }: {
  fileId: string; infoList: [string, CodeInfo][]; initial: { code: string; amount: string }[]; reStated: string; closeHref: string;
}) {
  const router = useRouter();
  const info = new Map(infoList);
  const [rows, setRows] = useState(initial.length ? initial : [{ code: "", amount: "" }]);
  const [re, setRe] = useState(reStated);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const amounts = useRef<(HTMLInputElement | null)[]>([]);
  const codes = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, k: "code" | "amount", v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const next = (i: number) => {
    if (i === rows.length - 1) setRows([...rows, { code: "", amount: "" }]);
    setTimeout(() => codes.current[i + 1]?.focus(), 0);
  };
  const filled = rows.filter((r) => r.code.trim() || r.amount.trim());
  const parsed: [string, number][] = filled.map((r) => [r.code.trim(), typedCents(r.amount) ?? NaN]);
  const bad = parsed.filter(([c, a]) => !/^\d{4}$/.test(c) || Number.isNaN(a));
  const { opening, errors } = openingFrom(parsed.filter(([c, a]) => /^\d{4}$/.test(c) && !Number.isNaN(a)), info);
  const reCents = typedCents(re);
  const save = () => start(async () => {
    setErr(null);
    if (bad.length) { setErr("Every line needs a 4-digit GIFI code and an amount. Nothing was saved."); return; }
    const e = await saveOpeningManualInline(fileId, parsed, reCents);
    if (e) setErr(e); else { router.push(closeHref, { scroll: false }); router.refresh(); }
  });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">Type each GIFI code and its amount from last year&rsquo;s T2, as it shows there: no total lines. Include 3660 (retained earnings at the start) and the 3700s. Press Enter after an amount for the next line.</p>
      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-3"><th className="w-24 font-medium">GIFI code</th><th className="font-medium">Line</th><th className="w-40 text-right font-medium">Amount</th><th className="w-8"></th></tr></thead>
        <tbody>{rows.map((r, i) => {
          const name = info.get(r.code.trim())?.name ?? (r.code.trim().length === 4 ? (r.code.trim() === "3849" ? "Total: leave out" : "Not a usable code") : "");
          return (
            <tr key={i} className="border-t border-sand-100">
              <td className="py-1.5 pr-2"><input ref={(el) => { codes.current[i] = el; }} aria-label={`GIFI code, line ${i + 1}`} inputMode="numeric" maxLength={4} value={r.code}
                onChange={(e) => set(i, "code", e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); amounts.current[i]?.focus(); } }} className="input tabular-nums" /></td>
              <td className={`py-1.5 pr-2 text-xs ${info.has(r.code.trim()) ? "text-ink-2" : "text-danger"}`}>{name}</td>
              <td className="py-1.5"><input ref={(el) => { amounts.current[i] = el; }} aria-label={`Amount, line ${i + 1}`} inputMode="decimal" value={r.amount}
                onChange={(e) => set(i, "amount", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(i); } }} className="input text-right tabular-nums" /></td>
              <td className="py-1.5 text-right"><button type="button" aria-label={`Remove line ${i + 1}`} className="text-ink-3 hover:text-danger" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ code: "", amount: "" }])}>×</button></td>
            </tr>
          );
        })}</tbody>
      </table>
      <div><button type="button" className="btn-secondary" onClick={() => next(rows.length - 1)}>Add a line</button></div>
      <div className="grid gap-2 rounded-lg border border-sand-200 p-4 text-sm">
        <label htmlFor="re_stated" className="font-medium">Last year&rsquo;s retained earnings at the end of the year (GIFI 3849, from last year&rsquo;s T2)</label>
        <input id="re_stated" inputMode="decimal" value={re} onChange={(e) => setRe(e.target.value)} className="input max-w-[220px] text-right tabular-nums" />
        <p className="text-ink-2">From these lines: 3660 {money(opening.reStartCents)} + net income {money(opening.netIncomeCents)} − dividends + adjustments = <b>{money(opening.reClosingCents)}</b>.</p>
        {reCents !== null && (reCents === opening.reClosingCents
          ? <p className="text-success">Ties to last year&rsquo;s 3849.</p>
          : <p className="text-warning">Off by {money(opening.reClosingCents - reCents)}. You can still save; the reviewer sees the difference.</p>)}
        {errors.length > 0 && <ul className="list-disc pl-5 text-danger">{errors.slice(0, 4).map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>
      <div><button type="button" className="btn" disabled={pending} onClick={save}>Save opening balances</button></div>
    </div>
  );
}
