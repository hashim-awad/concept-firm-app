"use client";
// Step 5, Expenses paid personally (round 9, Hashim, Nov 27, 2026). Benchmark: the QuickBooks Online
// journal entry. The client fills the firm's sheet and sends it; Closebook does not read it. The preparer
// types the before-tax and GST/HST amounts from the sheet's Summary for the lines that apply (blank lines
// are dropped), the Summary total, the km and the phone share, attaches the sheet, and Closebook books one
// AJE at the year end. Beside the entry: Summary total less the personal share = the shareholder loan
// credit. A rule shows only when it is broken, beside Save.
import { useMemo, useState } from "react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { OVER_RECEIPTS, planExpenses, type ExpenseDef, type ExpenseInput } from "@/lib/closebook/expenses";
import { defaultTaxCode } from "@/lib/closebook/sales-tax";
import { addPersonalExpenses } from "../round9-actions";
import { FilePick } from "./file-pick";

type Typed = { before: string; tax: string; account: string; note: string; taxChecked: boolean; receipts: number };
const blank = (): Typed => ({ before: "", tax: "", account: "", note: "", taxChecked: false, receipts: 0 });
const TAX: Record<string, string> = { taxable: "GST/HST", meals: "Meals: 50% ITC", none: "No tax normally", auto: "As Auto expenses" };

export function ExpensesForm({ fileId, yearEnd, defs, chart, ctx, province, autoEntry, clientList }: {
  fileId: string; yearEnd: string; defs: ExpenseDef[]; chart: { number: string; name: string; type: string }[];
  ctx: { registered: boolean; quick: boolean; autoTax: string }; province: string; autoEntry: boolean; clientList: boolean;
}) {
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [head, setHead] = useState({ summary: "", kmTotal: "", kmBusiness: "", phone: "", shareholder: "23000", autoChecked: false });
  const [sheet, setSheet] = useState("");
  const name = useMemo(() => new Map(chart.map((c) => [c.number, `${c.number} ${c.name}`])), [chart]);
  const t = (k: string) => typed[k] ?? blank();
  const set = (k: string, patch: Partial<Typed>) => setTyped({ ...typed, [k]: { ...t(k), ...patch } });
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,\s]/g, "")));
  const inputs: ExpenseInput[] = defs.map((d) => ({ key: d.key, before: parseAmount(t(d.key).before) ?? 0, tax: parseAmount(t(d.key).tax) ?? 0,
    account: t(d.key).account || undefined, note: t(d.key).note, receipts: t(d.key).receipts, taxChecked: t(d.key).taxChecked }));
  const formHead = { summaryTotal: head.summary.trim() ? parseAmount(head.summary) : null, kmTotal: num(head.kmTotal), kmBusiness: num(head.kmBusiness), phonePct: num(head.phone),
    shareholder: head.shareholder, autoChecked: head.autoChecked };
  const plan = planExpenses(defs, inputs, { ...formHead, sheet: !!sheet, autoEntry },
    { ...ctx, taxCode: (a) => defaultTaxCode("GST/HST", province, a) });
  const rowOf = new Map(plan.rows.map((r) => [r.key, r]));
  const vehicle = defs.some((d) => d.share === "km" && rowOf.has(d.key)), phone = defs.some((d) => d.share === "phone" && rowOf.has(d.key));
  const pickChoices = (d: ExpenseDef) => (d.choices.length ? d.choices : chart.filter((c) => c.type === "Expense" || c.type === "Asset").map((c) => c.number));
  const cell = "px-2 py-1";
  const money = (c: number) => (c ? formatAmount(c) : "");
  const amountBox = (k: string, field: "before" | "tax", label: string) => (
    <input aria-label={label} inputMode="decimal" value={t(k)[field]} onChange={(e) => set(k, { [field]: e.target.value })} onBlur={(e) => set(k, { [field]: tidyAmount(e.target.value) })}
      className={`input input-compact w-28 text-right tabular-nums ${t(k)[field] && parseAmount(t(k)[field]) === null ? "border-danger" : ""}`} />
  );

  return (
    <form action={addPersonalExpenses} className="grid gap-4">
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="form" value={JSON.stringify({ inputs: inputs.map(({ receipts, ...i }) => { void receipts; return i; }), head: { ...formHead, sheet: false, autoEntry: false } })} />
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <span className="grid gap-1"><span className="text-xs text-ink-3">Type</span><span className="font-medium">AJE · Correction</span></span>
        <span className="grid gap-1"><span className="text-xs text-ink-3">Date</span><span className="font-medium tabular-nums">{yearEnd}</span></span>
        <span className="grid gap-1"><span className="text-xs text-ink-3">W/P ref</span><span className="font-medium">Expenses paid personally summary</span></span>
        <label className="grid gap-1"><span className="text-xs text-ink-3">Credit the shareholder loan of</span>
          <select value={head.shareholder} onChange={(e) => setHead({ ...head, shareholder: e.target.value })} className="input input-compact">
            <option value="23000">{name.get("23000") ?? "23000"}</option><option value="23050">{name.get("23050") ?? "23050"}</option></select></label>
      </div>
      <p className="text-sm text-ink-2">Type the amounts from the Summary of the client&rsquo;s sheet for the lines that apply; leave the rest blank. GST/HST is never worked out from a total: type it as the client wrote it.
        {ctx.registered && !ctx.quick ? " This client is a regular GST/HST registrant: the GST/HST is claimed as an ITC (meals and client gifts of food or drink: half)." : ctx.registered ? " This client uses the quick method: GST/HST is added to the cost." : " This client is not registered: GST/HST is added to the cost."}
        {clientList && " The client keeps their own books: each line posts to their account on the same GIFI line, or a new account if they have none, and the entry goes on the client entry list."}</p>

      <div className="overflow-x-auto rounded-lg border border-sand-200">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="border-b border-sand-200 bg-sand-50 text-left text-xs text-ink-2">
            <th className={cell}>#</th><th className={cell}>Line on the sheet</th><th className={cell}>Account</th><th className={`${cell} text-right`}>Before tax</th><th className={`${cell} text-right`}>GST/HST</th>
            <th className={`${cell} text-right`}>Business share</th><th className={`${cell} text-right`}>To the account</th><th className={`${cell} text-right`}>ITC 21500</th><th className={`${cell} text-right`}>Left out</th></tr></thead>
          <tbody>{defs.map((d, i) => {
            const r = rowOf.get(d.key);
            const big = !!r && r.total > OVER_RECEIPTS;
            return (
              <tr key={d.key} className={`border-b border-sand-100 align-top ${r ? "bg-navy-50/40" : ""}`}>
                <td className={`${cell} tabular-nums text-ink-3`}>{i + 1}</td>
                <td className={`${cell} w-56`}>{d.name}<span className="block text-xs text-ink-3">{TAX[d.tax]}{d.capital ? " · capital" : ""}{d.to_reviewer ? " · to the reviewer" : ""}</span>
                  <div className="grid gap-1 text-xs">
                  {r?.flag && <label className="flex items-start gap-1.5 text-warning"><input type="checkbox" checked={t(d.key).taxChecked} onChange={(e) => set(d.key, { taxChecked: e.target.checked })} className="mt-0.5 h-4 w-4" />
                    <span>{r.flag} Checked</span></label>}
                  {r?.toReviewer && <span className="block rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">To the reviewer: {r.toReviewer.toLowerCase()}</span>}
                  {big && <div className={`mt-1 ${t(d.key).receipts ? "" : "text-danger"}`}><FilePick id={`rc-${d.key}`} name={`receipts_${d.key}`} label="Over $5,000: receipts" add="Attach the receipts"
                    accept=".pdf,.png,.jpg,.jpeg" hint="One PDF or image with the receipts." narrow onPick={(n) => set(d.key, { receipts: n ? 1 : 0 })} /></div>}
                  </div></td>
                <td className={cell}>{d.pick
                  ? <select aria-label={`${d.name}: account`} value={t(d.key).account} onChange={(e) => set(d.key, { account: e.target.value })} className="input input-compact w-48">
                      <option value="">Choose</option>{pickChoices(d).map((n) => <option key={n} value={n}>{name.get(n) ?? n}</option>)}</select>
                  : <span className="tabular-nums">{name.get(d.account ?? "") ?? d.account}</span>}
                  {d.note_required && <input aria-label={`${d.name}: what it is`} value={t(d.key).note} onChange={(e) => set(d.key, { note: e.target.value })} maxLength={120}
                    placeholder="What it is" className="input input-compact mt-1 block w-48" />}</td>
                <td className={`${cell} text-right`}>{amountBox(d.key, "before", `${d.name}: before tax`)}</td>
                <td className={`${cell} text-right`}>{amountBox(d.key, "tax", `${d.name}: GST/HST`)}</td>
                <td className={`${cell} text-right tabular-nums`}>{r && r.share !== null ? `${(Math.round(r.share * 1000) / 10).toLocaleString("en-CA")}%` : d.share === "km" ? "km" : d.share === "phone" ? "share" : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{r ? money(r.cost) : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{r ? money(r.itc) : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{r ? money(r.leftOut) : ""}</td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr className="font-semibold">
            <td /><td className={cell}>Total typed</td><td />
            <td className={`${cell} text-right tabular-nums`} colSpan={2}>{formatAmount(plan.typed)}</td><td />
            <td className={`${cell} text-right tabular-nums`}>{formatAmount(plan.credit - plan.itcTotal)}</td><td className={`${cell} text-right tabular-nums`}>{formatAmount(plan.itcTotal)}</td>
            <td className={`${cell} text-right tabular-nums`}>{formatAmount(plan.leftOut)}</td></tr></tfoot>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-3">
          {(vehicle || phone) && (
            <fieldset className="flex flex-wrap gap-4 rounded-lg border border-sand-200 p-3 text-sm">
              <legend className="px-1 text-xs font-semibold text-ink-2">Business share</legend>
              {vehicle && <>
                <label className="grid gap-1">Total km in the year<input inputMode="numeric" value={head.kmTotal} onChange={(e) => setHead({ ...head, kmTotal: e.target.value })} className="input input-compact w-32 text-right" /></label>
                <label className="grid gap-1">Business km<input inputMode="numeric" value={head.kmBusiness} onChange={(e) => setHead({ ...head, kmBusiness: e.target.value })} className="input input-compact w-32 text-right" /></label>
              </>}
              {phone && <label className="grid gap-1">Phone and internet: business %<input inputMode="decimal" value={head.phone} onChange={(e) => setHead({ ...head, phone: e.target.value })} className="input input-compact w-24 text-right" /></label>}
              <span className="self-end text-xs text-ink-3">The share applies to the cost and its GST/HST. The personal share is left out of the entry.</span>
            </fieldset>
          )}
          <FilePick id="exp-sheet" name="sheet" label="Client's sheet (the source)" add="Attach the client's sheet" accept=".xlsx,.xls,.pdf,.csv"
            hint="Attached to the entry as its source. Closebook does not read it." onPick={setSheet} />
          {autoEntry && (
            <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm">
              <input type="checkbox" checked={head.autoChecked} onChange={(e) => setHead({ ...head, autoChecked: e.target.checked })} className="mt-0.5 h-4 w-4" />
              <span><b>This file already has an Auto expenses entry.</b> Vehicle costs could be booked twice. Tick when you have checked they are not.</span></label>
          )}
        </div>

        <aside aria-label="Tie-out" className="grid content-start gap-2 rounded-lg border border-sand-200 bg-surface p-3 text-sm">
          <label className="grid gap-1 font-medium">Summary total, with tax
            <input inputMode="decimal" value={head.summary} onChange={(e) => setHead({ ...head, summary: e.target.value })} onBlur={(e) => setHead({ ...head, summary: tidyAmount(e.target.value) })}
              className="input input-compact text-right tabular-nums" /></label>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
            <dt>Summary total</dt><dd className="text-right">{formHead.summaryTotal !== null ? formatAmount(formHead.summaryTotal) : "–"}</dd>
            <dt>Less the personal share</dt><dd className="text-right">({formatAmount(plan.leftOut)})</dd>
            <dt className="border-t border-ink pt-1 font-semibold">Shareholder loan credit</dt><dd className="border-t border-ink pt-1 text-right font-semibold">{formatAmount(plan.credit)}</dd>
          </dl>
          <p className={`rounded px-2 py-1 text-xs font-medium ${plan.tieOut && !plan.problems.some((p) => p.startsWith("The lines add up")) ? "bg-success-soft text-success" : "bg-sand-100 text-ink-2"}`}>
            {plan.tieOut && !plan.problems.some((p) => p.startsWith("The lines add up")) ? "Ties out: the lines typed add up to the Summary total." : `Lines typed: ${formatAmount(plan.typed)}`}</p>
        </aside>
      </div>

      {plan.rpc.length > 0 && (
        <section aria-label="The entry" className="overflow-x-auto border border-[#C9CED8] text-sm">
          <p className="bg-[#EEF1F6] px-3 py-1.5 font-bold text-[#1A3C7C]">The entry it books</p>
          <table className="w-full min-w-[560px]"><tbody>
            {plan.rpc.map((l, i) => (
              <tr key={i} className={l.is_tax ? "text-[#5B6475]" : ""}><td className="px-3 py-0.5">{name.get(l.chart) ?? l.chart}<span className="ml-2 text-xs text-muted">{l.memo}</span></td>
                <td className="w-32 px-3 py-0.5 text-right tabular-nums">{l.amount > 0 ? formatAmount(Math.round(l.amount * 100)) : ""}</td>
                <td className="w-32 px-3 py-0.5 text-right tabular-nums">{l.amount < 0 ? formatAmount(-Math.round(l.amount * 100)) : ""}</td></tr>
            ))}
          </tbody></table>
          <p className="px-3 py-1.5"><i>Memo:</i> Business costs the shareholder paid personally during the year.</p>
        </section>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul className="grid gap-0.5 text-sm text-danger">{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        <div className="grid justify-items-end gap-1">
          {plan.reviewer.length > 0 && <p className="text-xs text-ink-2">Goes to the reviewer: {plan.reviewer.join(" ")}</p>}
          <button type="submit" className="btn" disabled={plan.problems.length > 0}>Save the entry</button>
        </div>
      </div>
    </form>
  );
}
