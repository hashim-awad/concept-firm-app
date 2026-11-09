"use client";
// T1 Pricing Calculator: Studio's calculator (t1cCalc, t1cSummary) with prices from the
// Service catalogue. One fee, charged once, before tax.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Alert, Button } from "@/components/ds/primitives";
import { Panel, TextIn, makeEngine, type ScreenEnv } from "./kit";

export function T1PricingScreen({ env }: { env: ScreenEnv }) {
  const [{ e }] = useState(() => makeEngine(env));
  const [, setTick] = useState(0);
  const redraw = () => setTick((x) => x + 1);
  const upd = (fn: (t: any) => void) => { fn(e.__get("T1C")); redraw(); };
  const T = e.__get("T1C");
  const per = T.filing === "couple" ? 2 : 1;
  const R = e.t1cCalc();
  const catBy = (code: string) => (env.cat as any[]).find((r) => e.trim(e.unesc(r["Code"] || "")).toUpperCase() === code);
  if (!(env.cat as any[]).length) return <Alert tone="warning">The Service catalogue has no prices yet, so the calculator cannot price a return. Import the catalogue first (Admin, Import from Studio).</Alert>;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="grid gap-4">
        <Panel title="1. Who is filing">
          <label htmlFor="t1c_name" className="text-sm font-medium">Client name (optional, for the summary)</label>
          <TextIn id="t1c_name" value={T.name} onValue={(v) => { upd((t) => { t.name = v.trim(); }); }} />
          <div className="flex gap-5 text-sm">
            {[["single", "Single return"], ["couple", "Couple filing together"]].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2"><input type="radio" name="t1cf" value={v} checked={T.filing === v} onChange={() => { upd((t) => { t.filing = v; }); }} className="h-4 w-4 accent-navy-700" />{l}</label>
            ))}
          </div>
        </Panel>
        <Panel title="2. What the return includes">
          <p className="text-[13px] text-ink-3">Enter how many of each. Items marked per person allow {per} for a {per > 1 ? "couple" : "single return"}.</p>
          <table className="w-full text-sm"><tbody>
            {(e.T1C_ITEMS as [string, string, string][]).map((it) => {
              const r = catBy(it[0]), p = r ? e.pbNum(r["Price"]) : null;
              return (
                <tr key={it[0]} className="border-b border-sand-100">
                  <td className="py-2"><label htmlFor={"t1c_" + it[0]}>{it[1]}</label>
                    <span className="block text-xs text-ink-3">{it[0]}{p != null ? " · " + e.money(p) + " " + e.unesc(r["Unit"] || "") : <span className="text-danger"> · no price in catalogue</span>}</span></td>
                  <td className="w-24 py-2"><input id={"t1c_" + it[0]} type="number" min={0} max={it[2] === "perret" ? per : 20} step={1} value={+T.q[it[0]] || 0}
                    onChange={(ev) => { upd((t) => { t.q[it[0]] = Math.max(0, Math.floor(Number(ev.target.value) || 0)); }); }} className="h-9 w-full rounded-lg border border-sand-300 px-2 text-right" /></td>
                </tr>
              );
            })}
          </tbody></table>
        </Panel>
        <Panel title="3. Anything that needs Hashim">
          <p className="text-[13px] font-semibold">Triage: no automatic price</p>
          {(e.T1C_TRIAGE as string[]).map((x) => <label key={x} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!T.tri[x]} onChange={(ev) => { upd((t) => { t.tri[x] = ev.target.checked; }); }} className="h-4 w-4 accent-navy-700" />{x}</label>)}
          <p className="mt-2 text-[13px] font-semibold">Out of scope</p>
          {(e.T1C_OUT as string[]).map((x) => <label key={x} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!T.out[x]} onChange={(ev) => { upd((t) => { t.out[x] = ev.target.checked; }); }} className="h-4 w-4 accent-navy-700" />{x}</label>)}
        </Panel>
        <div><Button variant="secondary" onClick={() => { e.__set("T1C", { filing: "single", name: "", q: {}, tri: {}, out: {} }); redraw(); }}>Start a new client</Button></div>
      </div>
      <div className="lg:sticky lg:top-4">
        <Panel title="Fee">
          {R.out.length ? (
            <Alert tone="warning"><b>Out of scope.</b> {R.out.join(", ")}. Route to Hashim for a separate quote or a decline. Do not send the engagement letter.</Alert>
          ) : (
            <>
              {R.miss.length > 0 && <Alert tone="warning">No price in the Service catalogue for {R.miss.join(", ")}. Add it in Price book.</Alert>}
              <table className="table text-sm">
                <thead><tr><th>Code</th><th>Service</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {R.lines.map((l: any) => <tr key={l.code}><td className="font-mono text-xs whitespace-nowrap">{l.code}</td><td>{l.name}</td><td className="text-right">{l.qty}</td><td className="text-right">{e.money(l.unit)}</td><td className="text-right">{e.money(l.amt)}</td></tr>)}
                  <tr><td /><td className="font-semibold">Total before tax</td><td /><td /><td className="text-right font-semibold">{e.money(R.total)}</td></tr>
                </tbody>
              </table>
              {R.tri.length > 0 && <Alert tone="warning"><b>Not final.</b> Hashim reviews first: {R.tri.join(", ")}.</Alert>}
              {R.warn.length > 0 && <ul className="grid gap-1.5">{R.warn.map((w: string) => <li key={w} className="rounded-lg bg-warning-soft px-2.5 py-2 text-[12.5px] text-[#5C3D00]">{w}</li>)}</ul>}
              <p className="text-[13px] text-ink-3">Sales tax is chosen on the invoice. Build the TaxDome invoice line for line from these codes.</p>
              <label htmlFor="t1cSum" className="text-sm font-medium">Summary to paste into the client file or invoice notes</label>
              <textarea id="t1cSum" rows={7} readOnly value={e.t1cSummary(R)} className="w-full rounded-lg border border-sand-300 bg-sand-50 p-2 text-xs" />
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
