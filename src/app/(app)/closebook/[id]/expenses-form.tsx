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
import { addPersonalExpenses, saveExpenseLineInline } from "../round9-actions";
import { FilePick } from "./file-pick";

type Typed = { before: string; tax: string; account: string; note: string; taxChecked: boolean; receipts: number };
const blank = (): Typed => ({ before: "", tax: "", account: "", note: "", taxChecked: false, receipts: 0 });
const TAX: Record<string, string> = { taxable: "GST/HST", meals: "Meals: 50% ITC", none: "No tax normally", auto: "As Auto expenses" };

export function ExpensesForm({ fileId, yearEnd, defs, chart, ctx, province, autoEntry, clientList, shown, shareholders, options, defaults, chosen, rolledFrom, editable = true }: {
  fileId: string; yearEnd: string; defs: ExpenseDef[]; chart: { number: string; name: string; type: string }[];
  // Each chart account as it posts on this file, and the accounts the credit can go to (fix 7).
  shown: Record<string, string>; shareholders: { value: string; label: string }[];
  // Round 9b: each line's account list on this file, its default, and the choice saved for the file.
  options: Record<string, { value: string; label: string; group: string }[]>; defaults: Record<string, string>; chosen: Record<string, string>;
  rolledFrom: string | null; editable?: boolean;
  ctx: { registered: boolean; quick: boolean; autoTax: string }; province: string; autoEntry: boolean; clientList: boolean;
}) {
  const [typed, setTyped] = useState<Record<string, Typed>>(() => Object.fromEntries(Object.entries(chosen).map(([k, v]) => [k, { ...blank(), account: v }])));
  const [saveError, setSaveError] = useState("");
  // The line's account: the one chosen on the file, else the default. Saved as soon as it is picked.
  const acctOf = (d: ExpenseDef) => (d.pick ? typed[d.key]?.account ?? "" : typed[d.key]?.account || defaults[d.key] || (d.account ?? ""));
  const keep = async (key: string, value: string) => { const e = await saveExpenseLineInline(fileId, key, value); setSaveError(e ?? ""); };
  const [head, setHead] = useState({ summary: "", kmTotal: "", kmBusiness: "", phone: "", shareholder: shareholders[0]?.value ?? "23000", autoChecked: false });
  const [sheet, setSheet] = useState("");
  const name = useMemo(() => new Map(chart.map((c) => [c.number, shown[c.number] ?? `${c.number} ${c.name}`])), [chart, shown]);
  const holder = useMemo(() => new Map(shareholders.map((h) => [h.value.replace(/^acct:/, ""), h.label])), [shareholders]);
  // Km with thousands separators once typed (20,000), as amounts are.
  const tidyKm = (v: string) => { const n = Number(v.replace(/[,\s]/g, "")); return v.trim() === "" || !Number.isFinite(n) ? v : n.toLocaleString("en-CA", { maximumFractionDigits: 1 }); };
  const t = (k: string) => typed[k] ?? blank();
  const set = (k: string, patch: Partial<Typed>) => setTyped({ ...typed, [k]: { ...t(k), ...patch } });
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,\s]/g, "")));
  const inputs: ExpenseInput[] = defs.map((d) => ({ key: d.key, before: parseAmount(t(d.key).before) ?? 0, tax: parseAmount(t(d.key).tax) ?? 0,
    account: acctOf(d) || undefined, note: t(d.key).note, receipts: t(d.key).receipts, taxChecked: t(d.key).taxChecked }));
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
      style={{ width: "6.25rem" }} className={`input input-compact text-right tabular-nums ${t(k)[field] && parseAmount(t(k)[field]) === null ? "border-danger" : ""}`} />
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
            {shareholders.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}</select></label>
      </div>
      <p className="text-sm text-ink-2">Type the amounts from the Summary of the client&rsquo;s sheet for the lines that apply; leave the rest blank. GST/HST is never worked out from a total: type it as the client wrote it.
        {ctx.registered && !ctx.quick ? " This client is a regular GST/HST registrant: the GST/HST is claimed as an ITC (meals and client gifts of food or drink: half)." : ctx.registered ? " This client uses the quick method: GST/HST is added to the cost." : " This client is not registered: GST/HST is added to the cost."}
        {clientList && " The client keeps their own books: each line posts to their account on the same GIFI line, or a new account if they have none, and the entry goes on the client entry list."}
        {" Change a line's account in its list: the choice is kept for this file and next year's."}{rolledFrom && ` Choices carried forward from the file for the year ended ${rolledFrom}.`}</p>
      {saveError && <p role="alert" className="text-sm text-danger">The account choice was not saved: {saveError}</p>}

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
                <td className={`${cell} w-36`}>{d.name}<span className="block text-xs text-ink-3">{TAX[d.tax]}{d.capital ? " · capital" : ""}{d.to_reviewer ? " · to the reviewer" : ""}</span>
                  <div className="grid gap-1 text-xs">
                  {r?.flag && <label className="flex items-start gap-1.5 text-warning"><input type="checkbox" checked={t(d.key).taxChecked} onChange={(e) => set(d.key, { taxChecked: e.target.checked })} className="mt-0.5 h-4 w-4" />
                    <span>{r.flag} Checked</span></label>}
                  {r?.toReviewer && <span className="block rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">To the reviewer: {r.toReviewer.toLowerCase()}</span>}
                  {big && <div className={`mt-1 ${t(d.key).receipts ? "" : "text-danger"}`}><FilePick id={`rc-${d.key}`} name={`receipts_${d.key}`} label="Over $5,000: receipts" add="Attach the receipts"
                    accept=".pdf,.png,.jpg,.jpeg" hint="One PDF or image with the receipts." narrow onPick={(n) => set(d.key, { receipts: n ? 1 : 0 })} /></div>}
                  </div></td>
                <td className={cell}>{d.pick
                  ? <select aria-label={`${d.name}: account`} value={t(d.key).account} onChange={(e) => set(d.key, { account: e.target.value })} className="input input-compact pr-8" style={{ width: "18rem" }}>
                      <option value="">Choose</option>{pickChoices(d).map((n) => <option key={n} value={n}>{name.get(n) ?? n}</option>)}</select>
                  : options[d.key] ? (() => {
                      const v = acctOf(d), isNew = v.startsWith("new:"), groups = [...new Set(options[d.key].map((o) => o.group))];
                      const label = (x: string) => options[d.key].find((o) => o.value === x)?.label ?? (x.startsWith("new:") ? `New account: ${x.slice(4)}` : x);
                      return <>
                        <select aria-label={`${d.name}: account`} value={isNew ? "new" : v} disabled={!editable} style={{ width: "18rem" }} className="input input-compact pr-8"
                          onChange={(e) => { const nv = e.target.value === "new" ? `new:${(chart.find((c) => c.number === d.account)?.name) ?? d.name}` : e.target.value; set(d.key, { account: nv }); void keep(d.key, nv); }}>
                          {groups.map((g) => <optgroup key={g} label={g}>{options[d.key].filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
                          {clientList && <option value="new">New account, with a name</option>}
                        </select>
                        {/* The name box shows on a line in use or changed from its default, not on every unused line. */}
                        {isNew && (rowOf.has(d.key) || v !== defaults[d.key]) && <input aria-label={`${d.name}: new account name`} value={v.slice(4)} maxLength={80} onChange={(e) => set(d.key, { account: `new:${e.target.value}` })}
                          onBlur={(e) => void keep(d.key, `new:${e.target.value}`)} placeholder="Name of the new account" style={{ width: "18rem" }} className="input input-compact mt-1 block" />}
                        {v !== defaults[d.key] && <span className="mt-0.5 block text-xs text-ink-3">Changed on this file. Default: {label(defaults[d.key] ?? "")}</span>}
                      </>;
                    })()
                  : <span className="tabular-nums">{name.get(d.account ?? "") ?? d.account}</span>}
                  {d.note_required && <input aria-label={`${d.name}: what it is`} value={t(d.key).note} onChange={(e) => set(d.key, { note: e.target.value })} maxLength={120}
                    placeholder="What it is" className="input input-compact mt-1 block" style={{ width: "18rem" }} />}</td>
                <td className={`${cell} text-right`}>{amountBox(d.key, "before", `${d.name}: before tax`)}</td>
                <td className={`${cell} text-right`}>{amountBox(d.key, "tax", `${d.name}: GST/HST`)}</td>
                <td className={`${cell} text-right tabular-nums`}>{r?.needs ? <span className="whitespace-nowrap font-medium text-danger">{r.needs === "km" ? "Needs km" : "Needs the share"}</span>
                  : r && r.share !== null ? `${(Math.round(r.share * 1000) / 10).toLocaleString("en-CA")}%` : d.share === "km" ? "km" : d.share === "phone" ? "share" : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{r && !r.needs ? money(r.cost) : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{r && !r.needs ? money(r.itc) : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{r && !r.needs ? money(r.leftOut) : ""}</td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr className="font-semibold">
            <td /><td className={cell}>Total typed</td><td />
            <td className={`${cell} text-right tabular-nums`} colSpan={2}>{formatAmount(plan.typed)}</td><td />
            {/* Totals only when every line is worked out: a line waiting for its km has no figures yet. */}
            <td className={`${cell} text-right tabular-nums`}>{plan.rows.some((r) => r.needs) ? "–" : formatAmount(plan.credit - plan.itcTotal)}</td>
            <td className={`${cell} text-right tabular-nums`}>{plan.rows.some((r) => r.needs) ? "–" : formatAmount(plan.itcTotal)}</td>
            <td className={`${cell} text-right tabular-nums`}>{plan.rows.some((r) => r.needs) ? "–" : formatAmount(plan.leftOut)}</td></tr></tfoot>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-3">
          {(vehicle || phone) && (
            <fieldset className="flex flex-wrap gap-4 rounded-lg border border-sand-200 p-3 text-sm">
              <legend className="px-1 text-xs font-semibold text-ink-2">Business share</legend>
              {vehicle && <>
                <label className="grid gap-1">Total km in the year<input inputMode="numeric" value={head.kmTotal} onChange={(e) => setHead({ ...head, kmTotal: e.target.value })} onBlur={(e) => setHead({ ...head, kmTotal: tidyKm(e.target.value) })} className="input input-compact w-32 text-right" /></label>
                <label className="grid gap-1">Business km<input inputMode="numeric" value={head.kmBusiness} onChange={(e) => setHead({ ...head, kmBusiness: e.target.value })} onBlur={(e) => setHead({ ...head, kmBusiness: tidyKm(e.target.value) })} className="input input-compact w-32 text-right" /></label>
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
          {/* Only true figures (fix 3): until the lines typed add up to the Summary total, the box shows the
              difference and no shareholder loan credit; until every vehicle line has its km, no credit either. */}
          {formHead.summaryTotal === null ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums"><dt>Lines typed</dt><dd className="text-right">{formatAmount(plan.typed)}</dd>
              <dt className="col-span-2 text-xs text-ink-3">Type the Summary total to tie out.</dt></dl>
          ) : !plan.balanced ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
              <dt>Lines typed</dt><dd className="text-right">{formatAmount(plan.typed)}</dd>
              <dt>Summary total</dt><dd className="text-right">{formatAmount(formHead.summaryTotal)}</dd>
              <dt className="border-t border-ink pt-1 font-semibold text-danger">Difference</dt><dd className="border-t border-ink pt-1 text-right font-semibold text-danger">{formatAmount(plan.summaryDiff ?? 0)}</dd>
              <dt className="col-span-2 text-xs text-ink-2">No shareholder loan credit until the lines add up to the Summary total.</dt>
            </dl>
          ) : !plan.complete ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
              <dt>Lines typed</dt><dd className="text-right">{formatAmount(plan.typed)}</dd>
              <dt>Summary total</dt><dd className="text-right">{formatAmount(formHead.summaryTotal)}</dd>
              <dt className="col-span-2 text-xs text-ink-2">The personal share and the shareholder loan credit show once every vehicle line has its km{plan.rows.some((r) => r.needs === "share") ? " and phone has its business share" : ""}.</dt>
            </dl>
          ) : (<>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
              <dt>Summary total</dt><dd className="text-right">{formatAmount(formHead.summaryTotal)}</dd>
              <dt>Less the personal share</dt><dd className="text-right">({formatAmount(plan.leftOut)})</dd>
              <dt className="border-t border-ink pt-1 font-semibold">Shareholder loan credit</dt><dd className="border-t border-ink pt-1 text-right font-semibold">{formatAmount(plan.credit)}</dd>
            </dl>
            <p className="rounded bg-success-soft px-2 py-1 text-xs font-medium text-success">Ties out: the lines typed add up to the Summary total.</p>
          </>)}
        </aside>
      </div>

      {plan.complete && plan.rpc.length > 0 && (
        <section aria-label="The entry" className="overflow-x-auto border border-[#C9CED8] text-sm">
          <p className="bg-[#EEF1F6] px-3 py-1.5 font-bold text-[#1A3C7C]">The entry it books</p>
          <table className="w-full min-w-[560px]"><tbody>
            {plan.rpc.map((l, i) => (
              <tr key={i} className={l.is_tax ? "text-[#5B6475]" : ""}><td className="px-3 py-0.5">{l.account ? holder.get(l.account) ?? Object.values(options).flat().find((o) => o.value === `acct:${l.account}`)?.label : l.new_name ? `New account: ${l.new_name}` : name.get(l.chart ?? "") ?? l.chart}<span className="ml-2 text-xs text-muted">{l.memo}</span></td>
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
