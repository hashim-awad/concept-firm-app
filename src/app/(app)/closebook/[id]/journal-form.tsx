"use client";
// Round 15b: the journal entry dialog. Benchmarks: CaseWare Cloud's "Add adjustment" dialog and QuickBooks
// Online's journal entry window. No., Date, Type, Description (the memo that prints on the client entry
// list) and W/P ref on top; "Amounts are: before tax / including tax" on GST/HST-registered files; the
// lines with a searchable account, description, debit, credit and sales tax; the GST/HST posting as its
// own line in the totals, so debits equal credits including tax; "+ Line"; attachments; "Reverse on the
// first day of next year". Save, Save and new, Cancel. Save only when the entry passes every rule.
// There is no Reason field: the reason the database's rules use is worked out from the entry (reasonFor).
import { useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { X } from "lucide-react";
import { useUnsavedGuard } from "@/components/save-state";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { blankLine, netOfTax, planEntry, type AcctOpt, type FormHead, type FormLine, type StdOpt } from "@/lib/closebook/entry-form";
import type { TaxCode, TaxContext } from "@/lib/closebook/sales-tax";
import { addEntry } from "../actions";
import { InfoTip } from "@/components/ds/info-tip";
import { amountTone } from "@/components/amount";
import { DESCRIPTION, ITC_ACCOUNT, WP_REF, emptyInputs, type SchedLine, type VehicleInputs, type VehicleResult } from "@/lib/closebook/vehicle-schedule";
import type { VehicleData } from "@/lib/closebook/vehicle-server";
import { HOME_DESCRIPTION, HOME_WP_REF, emptyHomeInputs, type HomeInputs, type HomeResult } from "@/lib/closebook/home-office";
import type { HomeData } from "@/lib/closebook/home-office-server";
import { VehicleWindow } from "./vehicle-window";
import { HomeWindow } from "./home-window";
import { EXP_DESCRIPTION, EXP_WP_REF, emptyExpInputs, type ExpInputs, type ExpResult } from "@/lib/closebook/expenses-schedule";
import type { ExpData } from "@/lib/closebook/expenses-schedule-server";
import { ExpensesWindow } from "./expenses-window";

type SchedKind = "vehicle" | "home_office" | "expenses";
const SCHED_NAME: Record<SchedKind, string> = { vehicle: "Vehicle schedule", home_office: "Home office schedule", expenses: "Expenses paid personally schedule" };
const SCHED_REF: Record<SchedKind, [string, string]> = { vehicle: [WP_REF, DESCRIPTION], home_office: [HOME_WP_REF, HOME_DESCRIPTION], expenses: [EXP_WP_REF, EXP_DESCRIPTION] };
type SchedInputs = VehicleInputs | HomeInputs | ExpInputs;

const KIND: [string, string][] = [["AJE", "Adjusting (AJE)"], ["RJE", "Reclassifying (RJE)"], ["TJE", "Tax, from ProFile (TJE)"]];
const WP_REFS = ["Opening balances", "Bank statements", "Code transactions", "Capital assets schedule", "Revenue check", "Payables listing", "Receivables listing",
  "Prepaid expenses schedule", "Shareholder account", "GST/HST reconciliation", "Payroll reconciliation", "Income tax schedule", "Home office schedule", "Prior year file"];

export type JournalInit = { head?: Partial<FormHead>; lines?: FormLine[]; std?: string; seq?: string; date?: string; balanceLast?: boolean };

export function JournalForm({ fileId, title, nextSeq, yearStart, yearEnd, clientList, opts, gifiLines, codes, ctx, standard, threshold, qboTypes,
  init = {}, lock = {}, approved = false, origin, edit, closeHref, backHref, problem, keptAttachments = [], vehicle, home, expenses, schedKind, openSchedule = false, printHref = "" }: {
  fileId: string; title: string; nextSeq: string; yearStart: string; yearEnd: string; clientList: boolean; opts: AcctOpt[]; gifiLines: [string, string, string, string?][];
  codes: TaxCode[]; ctx: TaxContext; standard: StdOpt[]; threshold: number; qboTypes: string[];
  init?: JournalInit; lock?: { kind?: boolean; wp?: boolean; head?: boolean }; approved?: boolean; origin?: string; edit?: string;
  closeHref: string; backHref: string; problem?: string | null; keptAttachments?: string[];
  // Piece 3: the Vehicle schedule (every full file); printHref once the entry is saved.
  vehicle?: VehicleData; openSchedule?: boolean; printHref?: string;
  // Piece 4: the Home office schedule; schedKind: the schedule an entry being edited holds.
  home?: HomeData; schedKind?: SchedKind;
  // Piece 4b: the Expenses paid personally schedule.
  expenses?: ExpData;
}) {
  const optMap = useMemo(() => new Map(opts.map((o) => [o.value, o])), [opts]);
  const codeMap = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);
  const lineTypes = useMemo(() => new Map(gifiLines.map(([no, , type]) => [no, type])), [gifiLines]);
  const newLineOf = useMemo(() => new Map(gifiLines.flatMap(([no, , , line]) => (line ? [[no, line] as [string, string]] : []))), [gifiLines]);
  const s0 = standard.find((x) => x.id === init.std);
  const [head, setHead] = useState<FormHead>({ kind: "AJE", wpRef: "", memo: "", reverse: false, inclusive: false,
    ...(s0 ? { kind: s0.kind, wpRef: s0.wp_ref, memo: s0.memo, reverse: s0.reverse } : {}), ...init.head });
  const [seq, setSeq] = useState(init.seq ?? nextSeq);
  const [date, setDate] = useState(init.date ?? yearEnd);
  const startLines = (): FormLine[] => {
    if (s0) return [{ ...blankLine(), acct: s0.debit.value, tax: ctx.registered ? s0.tax : "none" }, { ...blankLine(), acct: s0.credit.value }];
    const l = init.lines?.length ? [...init.lines] : [blankLine(), blankLine()];
    while (l.length < 2) l.push(blankLine());
    if (!init.balanceLast) return l;
    // Fix with an entry: the last line takes whatever balances the entry, its tax included.
    const p = planEntry(head, l.slice(0, -1), optMap, codeMap, ctx, lineTypes, null, newLineOf);
    const d = p.dr - p.cr;
    l[l.length - 1] = { ...l[l.length - 1], dr: d < 0 ? formatAmount(-d) : "", cr: d > 0 ? formatAmount(d) : "" };
    return l;
  };
  const [lines, setLines] = useState<FormLine[]>(startLines);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [stdAmount, setStdAmount] = useState("");
  const std = s0 ? { kind: s0.kind, reason: s0.reason, reverse: s0.reverse } : null;
  // Piece 3: lines from a schedule keep the schedule's amounts; the entry form's rules apply to the other lines.
  const [sIn, setSIn] = useState<{ kind: SchedKind; inputs: SchedInputs } | null>(null);
  const [kind, setKind] = useState<SchedKind | null>(schedKind ?? null);
  const [open, setOpen] = useState<SchedKind | null>(openSchedule ? schedKind ?? (vehicle ? "vehicle" : null) : null);
  const setVOpen = (v: boolean) => setOpen(v ? kind ?? "vehicle" : null);
  const [menu, setMenu] = useState(false);
  const schedLines = lines.filter((l) => l.sched);
  const hasSched = schedLines.length > 0;
  const other = hasSched ? lines.filter((l) => !l.sched && (l.acct || l.dr.trim() || l.cr.trim())) : lines;
  const plan0 = planEntry(head, other, optMap, codeMap, ctx, lineTypes, std, newLineOf);
  const sDr = schedLines.reduce((n, l) => n + (parseAmount(l.dr) ?? 0), 0), sCr = schedLines.reduce((n, l) => n + (parseAmount(l.cr) ?? 0), 0);
  const plan = hasSched ? { ...plan0, dr: plan0.dr + sDr, cr: plan0.cr + sCr, problems: [
    ...schedLines.filter((l) => !l.isTax && !l.acct).map(() => "A schedule line needs an account."),
    ...plan0.problems.filter((p) => !(other.length === 0 && p === "Enter at least two lines."))] } : plan0;
  const putLines = (k: SchedKind, inputs: SchedInputs, sl: SchedLine[], acctMap: Record<string, string>) => {
    const prev = new Map(schedLines.map((l) => [l.sched!, l]));
    const fresh: FormLine[] = sl.map((l) => {
      const p = prev.get(l.part);
      const dflt = l.account ?? acctMap[l.number] ?? `chart:${l.number}`;
      return { ...blankLine(), acct: l.is_tax ? acctMap[ITC_ACCOUNT] ?? `chart:${ITC_ACCOUNT}` : k === "expenses" && l.account ? dflt : p?.acct || dflt,
        desc: k === "expenses" && l.account ? l.memo : p?.desc || l.memo,
        dr: l.amount > 0 ? formatAmount(l.amount) : "", cr: l.amount < 0 ? formatAmount(-l.amount) : "", tax: l.tax_code ?? "none", sched: l.part, isTax: !!l.is_tax };
    });
    const keep = lines.filter((l) => !l.sched && (l.acct || l.dr.trim() || l.cr.trim()));
    setLines([...fresh, ...keep]);
    setHead({ ...head, kind: "AJE", wpRef: SCHED_REF[k][0], memo: head.memo.trim() ? head.memo : SCHED_REF[k][1], reverse: false, inclusive: false });
    setDate(yearEnd);
    setSIn({ kind: k, inputs });
    setKind(k);
    setOpen(null);
  };
  const putSchedule = (inputs: VehicleInputs, r: VehicleResult) => putLines("vehicle", inputs, r.lines, vehicle?.acct ?? {});
  const putHome = (inputs: HomeInputs, r: HomeResult) => putLines("home_office", inputs, r.lines, home?.acct ?? {});
  const putExpenses = (inputs: ExpInputs, r: ExpResult) => putLines("expenses", inputs, r.lines, expenses?.acct ?? {});
  const setLine = (i: number, patch: Partial<FormLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const labelOf = (v: string) => (v === "new" ? "New account in the client’s books" : optMap.get(v)?.label ?? "");
  const byLabel = useMemo(() => new Map(opts.map((o) => [o.label, o.value])), [opts]);
  // A standard entry's amount is the total paid, including tax (round 3 item 2): line 1 gets the amount
  // before tax, line 2 the total, and the GST/HST line the difference, so the entry opens balanced.
  const setAmount = (v: string) => {
    setStdAmount(v);
    if (!s0) return;
    const g = parseAmount(v);
    const tax = lines[0]?.tax ?? "none";
    const net = g === null ? null : netOfTax(g, tax !== "none" ? codeMap.get(tax) ?? null : null, optMap.get(lines[0]?.acct ?? "")?.type || "Expense", ctx);
    setLines([{ ...lines[0], dr: net === null ? "" : formatAmount(net) }, { ...lines[1], cr: g === null ? "" : formatAmount(g) }, ...lines.slice(2)]);
  };
  const ok = plan.problems.length === 0;
  // Round 21 (QuickBooks Online): Save closes the dialog with the note; leaving with changes (Cancel, the X,
  // another link) asks "Save your changes?" first.
  const formRef = useRef<HTMLFormElement>(null), saveRef = useRef<HTMLButtonElement>(null);
  const snap = JSON.stringify({ head, date, lines, seq, stdAmount, sIn });
  const [first] = useState(snap);
  useUnsavedGuard(snap !== first, { form: () => formRef.current,
    save: () => { if (ok) formRef.current?.requestSubmit(saveRef.current); return false; } });
  const stdCents = parseAmount(stdAmount) ?? 0;
  const fld = "grid gap-1 text-[11.5px] font-semibold text-ink-2";
  const box = "input input-compact text-[13px] font-normal text-ink";

  return (
    <form ref={formRef} action={addEntry} encType="multipart/form-data" className="flex max-h-[calc(100vh-96px)] flex-col">
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="back" value={backHref} />
      <input type="hidden" name="done" value={closeHref} />
      <input type="hidden" name="form" value={JSON.stringify({ head, date, lines, standard: s0?.id ?? null, seq, origin: origin ?? null, edit: edit ?? null, schedule: sIn ? { kind: sIn.kind, inputs: sIn.inputs } : null })} />
      <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {origin === "revenue_check" && <span className="rounded bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">From the revenue check</span>}
        {s0 && <span className="rounded bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">Standard entry: {s0.name}</span>}
        {hasSched && <span className="rounded bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">From the {SCHED_NAME[kind ?? "vehicle"].replace(" schedule", "")} schedule</span>}
        <span className="flex-1" />
        <Link href={closeHref} aria-label="Close" className="rounded p-1 text-ink-3 hover:bg-sand-100"><X className="h-[18px] w-[18px]" /></Link>
      </div>

      <div className="grid gap-3 overflow-y-auto px-5 py-4">
        {approved && <p className="rounded-[var(--radius-ds)] bg-warning-soft px-3 py-2 text-[12.5px] text-warning" role="note" data-approved-note>{APPROVED_NOTICE}</p>}
        <div className="grid gap-3 md:grid-cols-[7rem_10rem_13rem_minmax(0,1fr)_13rem]">
          <label className={fld}>No.<span className="flex items-center gap-1"><span className="text-[13px] font-normal text-ink-3 tabular-nums">{yearEnd.slice(0, 4)}-</span>
            <input aria-label="Entry number" value={seq} readOnly={lock.head} onChange={(e) => setSeq(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className={`${box} w-full tabular-nums`} /></span></label>
          <label className={fld}>Date<input type="date" name="date" value={date} readOnly={lock.head} min={yearStart} max={yearEnd} onChange={(e) => setDate(e.target.value)} className={box} /></label>
          <label className={fld}>Type<select value={head.kind} disabled={lock.kind} onChange={(e) => setHead({ ...head, kind: e.target.value })} className={box}>
            {KIND.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={fld}>Description<input value={head.memo} readOnly={lock.head} onChange={(e) => setHead({ ...head, memo: e.target.value })} maxLength={500} placeholder="Prints on the client entry list" className={box} /></label>
          {hasSched ? <div className={fld}>W/P ref<button type="button" onClick={() => setVOpen(true)} className="h-[30px] text-left text-[13px] font-semibold text-navy-700 underline" data-wp-link>{head.wpRef || SCHED_NAME[kind ?? "vehicle"]}</button></div>
            : <label className={fld}>W/P ref<input value={head.wpRef} readOnly={lock.wp} onChange={(e) => setHead({ ...head, wpRef: e.target.value })} list="wp-refs" maxLength={120} className={`${box} ${lock.wp ? "bg-sand-50" : ""}`} />
            <datalist id="wp-refs">{WP_REFS.map((r) => <option key={r} value={r} />)}</datalist></label>}
        </div>

        {(s0 || ctx.registered) && (
          <div className="flex flex-wrap items-end gap-4">
            {s0 && <label className={fld}>Total, including any tax<input value={stdAmount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} onBlur={(e) => setAmount(tidyAmount(e.target.value))} className={`${box} w-40 text-right tabular-nums ${amountTone(stdAmount)}`} /></label>}
            {s0 && stdAmount && <span className="pb-1.5 text-[12px] text-ink-3">{stdCents > threshold * 100 ? `Over ${formatAmount(threshold * 100)}: needs review` : "No review needed"}</span>}
            <span className="flex-1" />
            {ctx.registered && !s0 && !hasSched && <label className={`${fld} w-52`}>Amounts are<select value={head.inclusive ? "inc" : "exc"} onChange={(e) => setHead({ ...head, inclusive: e.target.value === "inc" })} className={box}>
              <option value="exc">Before tax</option><option value="inc">Including tax</option></select></label>}
          </div>
        )}

        <datalist id="acct-list">{opts.map((o) => <option key={o.value} value={o.label} />)}{clientList && <option value={labelOf("new")} />}</datalist>
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup><col className="w-8" /><col className="w-[30%]" /><col /><col className="w-32" /><col className="w-32" />{ctx.registered && <col className="w-40" />}<col className="w-8" /></colgroup>
          <thead><tr className="border-b border-sand-200 text-left text-[11px] font-semibold text-ink-3"><th className="py-1.5">#</th><th className="py-1.5">Account</th><th className="py-1.5">Description</th>
            <th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th>{ctx.registered && <th className="py-1.5 pl-2">Sales tax</th>}<th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-sand-100 align-top">
                <td className="py-1.5 text-ink-3">{i + 1}</td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} account`} list="acct-list" value={typed[i] ?? (labelOf(l.acct) || (l.isTax ? `${ITC_ACCOUNT} GST/HST payable` : ""))} placeholder="Search accounts" readOnly={l.isTax}
                    onChange={(e) => { const v = e.target.value; setTyped({ ...typed, [i]: v }); const hit = v === labelOf("new") ? "new" : byLabel.get(v); setLine(i, { acct: hit ?? "" }); }}
                    onBlur={() => { const t = { ...typed }; delete t[i]; setTyped(t); }} className={`${box} w-full ${l.isTax ? "bg-sand-50" : ""}`} />
                  {l.acct === "new" && (
                    <span className="mt-1 grid gap-1">
                      <input aria-label={`Line ${i + 1} new account name`} value={l.newName} onChange={(e) => setLine(i, { newName: e.target.value })} maxLength={80} placeholder="Name, in plain words" className={box} />
                      <select aria-label={`Line ${i + 1} QuickBooks type`} value={l.newType} onChange={(e) => setLine(i, { newType: e.target.value })} className={box}><option value="">QuickBooks type</option>{qboTypes.map((t) => <option key={t}>{t}</option>)}</select>
                      <select aria-label={`Line ${i + 1} master account`} value={l.newLine} onChange={(e) => setLine(i, { newLine: e.target.value })} className={box}><option value="">Master account</option>{gifiLines.map(([no, name]) => <option key={no} value={no}>{no.startsWith("chart:") ? name : `${no} ${name}`}</option>)}</select>
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1} description`} value={l.desc} onChange={(e) => setLine(i, { desc: e.target.value })} maxLength={200} className={`${box} w-full`} /></td>
                {l.sched ? (["dr", "cr"] as const).map((side) => (
                  <td key={side} className="py-1 pr-2"><span className="flex h-[30px] items-center justify-end gap-1.5 rounded-md bg-sand-50 px-2 tabular-nums" aria-label={`Line ${i + 1} ${side === "dr" ? "debit" : "credit"}`} data-sched-amount={l.sched}>
                    {l[side] && <button type="button" onClick={() => setVOpen(true)} title={`From the ${SCHED_NAME[kind ?? "vehicle"]}: change it there`} className="rounded bg-navy-50 px-1.5 text-[10.5px] font-semibold text-navy-700 hover:bg-navy-100">Schedule</button>}{l[side]}</span></td>
                )) : <>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1} debit`} inputMode="decimal" value={l.dr} onChange={(e) => setLine(i, { dr: e.target.value })} onBlur={(e) => setLine(i, { dr: tidyAmount(e.target.value) })} className={`${box} w-full text-right tabular-nums ${amountTone(l.dr)}`} /></td>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1} credit`} inputMode="decimal" value={l.cr} onChange={(e) => setLine(i, { cr: e.target.value })} onBlur={(e) => setLine(i, { cr: tidyAmount(e.target.value) })} className={`${box} w-full text-right tabular-nums ${amountTone(l.cr)}`} /></td></>}
                {ctx.registered && (l.sched ? <td className="py-1.5 pl-2 text-[12.5px] text-ink-2">{l.isTax ? "GST/HST" : l.tax && l.tax !== "none" ? codes.find((c) => c.code === l.tax)?.name ?? l.tax : "No tax"}</td>
                  : <td className="py-1 pl-2"><select aria-label={`Line ${i + 1} sales tax`} value={l.tax} onChange={(e) => setLine(i, { tax: e.target.value })} className={`${box} w-full`}>
                  <option value="" disabled>Choose</option><option value="none">No tax</option>{codes.filter((c) => c.parts.some((p) => p.rate > 0)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></td>)}
                <td className="py-1.5 text-center">{lines.length > 2 && !l.sched && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger"><X className="h-3.5 w-3.5" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2"><button type="button" onClick={() => setLines([...lines, blankLine()])} className="btn-secondary btn-compact">+ Line</button>
          {(vehicle || home || expenses) && <span className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} onKeyDown={(e) => { if (e.key === "Escape") setMenu(false); }} className="btn-secondary btn-compact">From a schedule<ChevronDown className="h-3.5 w-3.5" /></button>
            {menu && <span role="menu" className="absolute top-full left-0 z-10 mt-1 grid min-w-[220px] rounded-lg border border-sand-200 bg-white py-1 shadow-[0_10px_30px_rgba(11,26,58,.18)]">
              {/* One schedule per entry: while the entry holds one, the other item is off. */}
              {vehicle && <button type="button" role="menuitem" autoFocus disabled={hasSched && kind !== "vehicle"} title={hasSched && kind !== "vehicle" ? "This entry holds another schedule" : undefined}
                onClick={() => { setMenu(false); setOpen("vehicle"); }} onKeyDown={(e) => { if (e.key === "Escape") setMenu(false); }}
                className="px-3 py-1.5 text-left text-[13px] hover:bg-sand-50 focus:bg-sand-50 focus:outline-none disabled:text-ink-3">Vehicle (owner&apos;s car)</button>}
              {home && <button type="button" role="menuitem" disabled={hasSched && kind !== "home_office"} title={hasSched && kind !== "home_office" ? "This entry holds another schedule" : undefined}
                onClick={() => { setMenu(false); setOpen("home_office"); }} onKeyDown={(e) => { if (e.key === "Escape") setMenu(false); }}
                className="px-3 py-1.5 text-left text-[13px] hover:bg-sand-50 focus:bg-sand-50 focus:outline-none disabled:text-ink-3">Home office</button>}
              {expenses && <button type="button" role="menuitem" disabled={hasSched && kind !== "expenses"} title={hasSched && kind !== "expenses" ? "This entry holds another schedule" : undefined}
                onClick={() => { setMenu(false); setOpen("expenses"); }} onKeyDown={(e) => { if (e.key === "Escape") setMenu(false); }}
                className="px-3 py-1.5 text-left text-[13px] hover:bg-sand-50 focus:bg-sand-50 focus:outline-none disabled:text-ink-3">Expenses paid personally</button>}</span>}
          </span>}</div>

        {/* The GIFI/HST posting as its own line, then the totals: debits equal credits, the tax included. */}
        <table className="ml-auto w-full max-w-[640px] border-collapse text-[13px]">
          <tbody>
            {plan.taxRows.map((t) => (
              <tr key={t.label} className="text-ink-2"><td className="py-1">{t.label}</td>
                <td className="w-32 py-1 text-right tabular-nums">{t.cents > 0 ? formatAmount(t.cents) : ""}</td><td className="w-32 py-1 text-right tabular-nums">{t.cents < 0 ? formatAmount(-t.cents) : ""}</td><td className="w-40" /></tr>
            ))}
            <tr className="border-t border-ink font-bold"><td className="py-1.5 text-right">Total</td><td className="py-1.5 text-right tabular-nums">{formatAmount(plan.dr)}</td><td className="py-1.5 text-right tabular-nums">{formatAmount(plan.cr)}</td>
              <td className={`py-1.5 pl-4 ${plan.diff ? "text-danger" : "text-success"}`}>Difference {formatAmount(Math.abs(plan.diff))}</td></tr>
          </tbody>
        </table>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          {lock.head ? <Attachments kept={keptAttachments} readOnly /> : <Attachments kept={keptAttachments} />}
          <label className="flex items-center gap-2 pt-1 text-[13px]"><input type="checkbox" checked={head.reverse} disabled={lock.head} onChange={(e) => setHead({ ...head, reverse: e.target.checked })} className="h-4 w-4" />Reverse on the first day of next year</label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-b-[10px] border-t border-sand-200 bg-sand-50 px-5 py-3">
        <Link href={closeHref} className="btn-secondary btn-compact">Cancel</Link>
        <span className="flex-1" />
        {(problem || !ok) && <span role="status" className="text-[12.5px] text-danger">{problem ?? plan.problems[0]}</span>}
        {!edit && <button type="submit" name="then" value="new" className="btn-secondary btn-compact" disabled={!ok}>Save and new</button>}
        <button ref={saveRef} type="submit" name="then" value="close" className="btn btn-compact" disabled={!ok}>Save</button>
      </div>
      {vehicle && open === "vehicle" && <VehicleWindow notice={approved ? APPROVED_NOTICE : undefined} data={vehicle} initial={(sIn?.kind === "vehicle" ? sIn.inputs as VehicleInputs : null) ?? (vehicle.stored ? { ...vehicle.stored.inputs, itc: vehicle.stored.itc_claim } : emptyInputs())}
        canPrint={!!printHref && !!vehicle.stored && !sIn} printHref={printHref} onPut={putSchedule} onClose={() => setOpen(null)} />}
      {home && open === "home_office" && <HomeWindow notice={approved ? APPROVED_NOTICE : undefined} data={home} initial={(sIn?.kind === "home_office" ? sIn.inputs as HomeInputs : null) ?? (home.stored ? { ...home.stored.inputs, itc: home.stored.itc_claim } : emptyHomeInputs())}
        canPrint={!!printHref && !!home.stored && !sIn} printHref={printHref} onPut={putHome} onClose={() => setOpen(null)} />}
      {expenses && open === "expenses" && <ExpensesWindow notice={approved ? APPROVED_NOTICE : undefined} data={expenses} initial={(sIn?.kind === "expenses" ? sIn.inputs as ExpInputs : null) ?? (expenses.stored ? { ...expenses.stored.inputs, itc: expenses.stored.itc_claim } : emptyExpInputs())}
        canPrint={!!printHref && !!expenses.stored && !sIn} printHref={printHref} onPut={putExpenses} onClose={() => setOpen(null)} />}
    </form>
  );
}

// Attachments like QuickBooks Online (round 3 item 11): an "Add attachment" control and the files chosen,
// each with a remove button. The files ride on the form's own file input.
// Piece S1: shown in the schedule window, and over the form, when the entry is approved.
export const APPROVED_NOTICE = "This entry is approved. Saving takes the approval back and it goes to the reviewer again. Only the schedule can change.";

function Attachments({ kept, readOnly = false }: { kept: string[]; readOnly?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const sync = (list: File[]) => {
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(f));
    if (input.current) input.current.files = dt.files;
    setFiles(list);
  };
  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-lg border border-dashed border-sand-300 px-3 py-2 text-[12.5px]">
      <input ref={input} type="file" name="attachments" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv" className="sr-only" aria-label="Add attachment"
        onChange={(e) => sync([...files, ...Array.from(e.target.files ?? [])].slice(0, 10))} />
      {kept.map((p) => <span key={p} className="rounded bg-sand-50 px-2 py-0.5">{p.split("/").pop()!.replace(/^\d+-/, "")}</span>)}
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded bg-sand-50 px-2 py-0.5">{f.name}
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => sync(files.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger">×</button></span>
      ))}
      {!readOnly && <button type="button" onClick={() => input.current?.click()} className="font-semibold text-navy-700 hover:underline">Add attachment</button>}
      {!readOnly && <InfoTip label="Files allowed">PDF, image, Excel or CSV. Up to 10, 20 MB each.</InfoTip>}
    </div>
  );
}
