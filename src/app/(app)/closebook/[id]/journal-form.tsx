"use client";
// Step 5, New entry (Hashim, Nov 16, 2026, round 2 items 1, 2 and 11), laid out like the QuickBooks Online
// journal entry: entry number, date, type, reason and W/P reference on the top line; "Start from a
// standard entry" in the same form; the lines table (# | Account | Debits | Credits | Description | Sales
// tax) with the totals and the difference under it; "Add lines" and "Clear all lines"; Memo and
// Attachments side by side; Cancel on the left and Save on the right. A rule shows only when it is broken,
// beside Save. The rules themselves sit under "How to do this".
import { useMemo, useRef, useState } from "react";
import { formatAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { blankLine, netOfTax, planEntry, type AcctOpt, type FormLine, type StdOpt } from "@/lib/closebook/entry-form";
import type { TaxCode, TaxContext } from "@/lib/closebook/sales-tax";
import { addEntry } from "../actions";


const REASONS: Record<string, string> = { accrual: "Accrual", reclassification: "Reclassification", correction: "Correction", tax: "Tax", prior_period: "Prior period adjustment" };
const KIND: Record<string, string> = { AJE: "AJE (adjusting)", RJE: "RJE (reclass)", TJE: "TJE (tax)" };
const WP_REFS = ["Opening balances", "Bank statements", "Code the transactions", "Capital assets schedule", "Revenue check", "Payables listing", "Receivables listing",
  "Prepaid expenses schedule", "Shareholder account", "GST/HST reconciliation", "Payroll reconciliation", "Income tax schedule", "Home office schedule", "Prior year file"];

export function JournalForm({ fileId, nextNo, yearStart, yearEnd, clientList, opts, gifiLines, codes, ctx, standard, threshold, qboTypes }: {
  fileId: string; nextNo: string; yearStart: string; yearEnd: string; clientList: boolean; opts: AcctOpt[]; gifiLines: [string, string, string][];
  codes: TaxCode[]; ctx: TaxContext; standard: StdOpt[]; threshold: number; qboTypes: string[];
}) {
  const [head, setHead] = useState({ kind: "AJE", reason: "accrual", wpRef: "", memo: "", reverse: false });
  const [date, setDate] = useState(yearEnd);
  const [lines, setLines] = useState<FormLine[]>([blankLine(), blankLine()]);
  const [std, setStd] = useState("");
  const [stdAmount, setStdAmount] = useState("");
  const optMap = useMemo(() => new Map(opts.map((o) => [o.value, o])), [opts]);
  const codeMap = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);
  const lineTypes = useMemo(() => new Map(gifiLines.map(([no, , type]) => [no, type])), [gifiLines]);
  const groups = useMemo(() => [...new Set(opts.map((o) => o.group))], [opts]);
  const plan = planEntry(head, lines, optMap, codeMap, ctx, lineTypes);
  const s = standard.find((x) => x.id === std);
  const setLine = (i: number, patch: Partial<FormLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // The standard entry's amount is the total paid, including tax (round 3 item 2): line 1 gets the amount
  // before tax, line 2 the total, and the tax line the difference, so the entry opens balanced.
  const fill = (x: StdOpt, gross: string, tax: string, base: FormLine[]) => {
    const g = parseAmount(gross);
    const typeOf = (v: string) => optMap.get(v)?.type ?? "";
    const net = g === null ? null : netOfTax(g, tax ? codeMap.get(tax) ?? null : null, typeOf(base[0]?.acct ?? x.debit.value) || "Expense", ctx);
    const l1 = { ...(base[0] ?? blankLine()), tax, dr: net === null ? "" : formatAmount(net) };
    const l2 = { ...(base[1] ?? blankLine()), cr: g === null ? "" : formatAmount(g) };
    return [l1, l2, ...base.slice(2)];
  };

  // Picking a standard entry fills the type, reason, W/P ref, memo and the two lines; the preparer types
  // the amount. On a client who keeps their own books, a side with no client account on its GIFI line stays
  // empty for the preparer to choose (item 2): nothing posts to a bare GIFI line.
  const pick = (id: string) => {
    setStd(id);
    const x = standard.find((y) => y.id === id);
    if (!x) return;
    setHead({ kind: x.kind, reason: x.reason, wpRef: x.wp_ref, memo: x.memo, reverse: x.reverse });
    setLines(fill(x, stdAmount, ctx.registered ? x.tax : "", [{ ...blankLine(), acct: x.debit.value }, { ...blankLine(), acct: x.credit.value }]));
  };
  const setAmount = (v: string) => {
    setStdAmount(v);
    if (s) setLines(fill(s, v, lines[0]?.tax ?? "", lines));
  };
  // A new tax code on line 1 of a standard entry splits the total again.
  const setTax = (i: number, tax: string) => (s && i === 0 && stdAmount ? setLines(fill(s, stdAmount, tax, lines)) : setLine(i, { tax }));
  const stdCents = parseAmount(stdAmount) ?? 0;
  const ok = plan.problems.length === 0;

  return (
    <form action={addEntry} className="card form-col grid gap-4" encType="multipart/form-data">
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="form" value={JSON.stringify({ head, date, lines, standard: std || null })} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">New entry</h2>
        <details className="text-sm">
          <summary className="cursor-pointer text-navy-700 underline">How to do this</summary>
          <ul className="mt-2 max-w-md list-disc space-y-1 pl-5 text-ink-2">
            <li>Debits must equal credits, the sales tax included.</li>
            <li>Amounts are before tax. The tax on a line posts to 21500 GST/HST payable (PST to 21550), as in QuickBooks Online.</li>
            <li>An RJE moves amounts between accounts and cannot change the result.</li>
            <li>A line on 31500 Prior period adjustments (or retained earnings) needs the reason &ldquo;Prior period adjustment&rdquo;. It never reverses next year.</li>
            <li>Only an accrual reverses next year.</li>
            <li>Every entry goes to the reviewer, except a standard entry at or under {formatAmount(threshold * 100)}.</li>
            {clientList && <li>This client keeps their own books: use their accounts, or name a new account in plain words.</li>}
          </ul>
        </details>
      </div>

      {standard.length > 0 && (
        <div className="grid gap-3 rounded-lg bg-sand-50 p-3 sm:grid-cols-[minmax(0,18rem)_12rem_1fr] sm:items-end">
          <label className="grid gap-1 text-sm font-medium">Start from a standard entry
            <select value={std} onChange={(e) => pick(e.target.value)} className="input input-compact">
              <option value="">None</option>{standard.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          {s && <label className="grid gap-1 text-sm font-medium">Total paid, including tax
            <input value={stdAmount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} onBlur={(e) => setAmount(tidyAmount(e.target.value))} className="input input-compact text-right tabular-nums" /></label>}
          {/* The threshold only: a missing account shows on its own line (round 3 item 9). */}
          {s && <p className="text-xs text-ink-2">{stdCents > threshold * 100
            ? `Over ${formatAmount(threshold * 100)}: it goes to the reviewer.` : `At or under ${formatAmount(threshold * 100)}: no review needed, if the lines stay as set.`}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[7rem_10rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid gap-1 text-sm font-medium">Entry no.<span className="input input-compact bg-sand-50 tabular-nums text-ink-2">{nextNo}</span></div>
        <label className="grid gap-1 text-sm font-medium">Date<input type="date" name="date" value={date} min={yearStart} max={yearEnd} onChange={(e) => setDate(e.target.value)} className="input input-compact" /></label>
        <label className="grid gap-1 text-sm font-medium">Type<select value={head.kind} onChange={(e) => setHead({ ...head, kind: e.target.value })} className="input input-compact">
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Reason<select value={head.reason} onChange={(e) => setHead({ ...head, reason: e.target.value, reverse: e.target.value === "accrual" && head.reverse })} className="input input-compact">
          {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">W/P reference<input value={head.wpRef} onChange={(e) => setHead({ ...head, wpRef: e.target.value })} list="wp-refs" maxLength={120} placeholder="Step or schedule" className="input input-compact" />
          <datalist id="wp-refs">{WP_REFS.map((r) => <option key={r} value={r} />)}</datalist></label>
      </div>
      {head.reason === "accrual" && (
        <label className="-mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={head.reverse} onChange={(e) => setHead({ ...head, reverse: e.target.checked })} className="h-4 w-4" />Reverse it next year</label>
      )}

      <div className="overflow-x-auto">
        <table className="table table-compact min-w-[860px] table-fixed">
          <colgroup><col className="w-9" /><col className="w-[34%]" /><col className="w-28" /><col className="w-28" /><col />{ctx.registered && <col className="w-36" />}<col className="w-7" /></colgroup>
          <thead><tr><th>#</th><th>Account</th><th className="text-right">Debits</th><th className="text-right">Credits</th><th>Description</th>{ctx.registered && <th>Sales tax</th>}<th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const miss = s && i < 2 && !l.acct ? (i === 0 ? s.debit.missing : s.credit.missing) : "";
              return (
                <tr key={i}>
                  <td className="text-ink-3">{i + 1}</td>
                  <td>
                    {/* The chosen account in full, never cut off (round 3 item 10): the box shows the whole name and
                        the list opens over it. */}
                    <span className="relative block">
                      <span aria-hidden className={`input input-compact block min-h-[30px] pr-6 leading-snug ${l.acct ? "" : "text-ink-3"} ${miss ? "border-warning" : ""}`}>
                        {l.acct === "new" ? "New account in the client\u2019s books" : optMap.get(l.acct)?.label ?? "Choose"}<span className="absolute top-1.5 right-2 text-ink-3">▾</span></span>
                      <select aria-label={`Line ${i + 1} account`} value={l.acct} onChange={(e) => setLine(i, { acct: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                        <option value="">Choose</option>
                        {groups.map((g) => <optgroup key={g} label={g}>{opts.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
                        {clientList && <option value="new">New account in the client&rsquo;s books…</option>}
                      </select>
                    </span>
                    {miss && <span className="block text-xs text-warning">{miss}</span>}
                    {l.acct === "new" && (
                      <span className="mt-1 grid gap-1">
                        <input aria-label={`Line ${i + 1} new account name`} value={l.newName} onChange={(e) => setLine(i, { newName: e.target.value })} maxLength={80} placeholder="Name, in plain words" className="input input-compact" />
                        <select aria-label={`Line ${i + 1} QuickBooks type`} value={l.newType} onChange={(e) => setLine(i, { newType: e.target.value })} className="input input-compact"><option value="">QuickBooks type</option>{qboTypes.map((t) => <option key={t}>{t}</option>)}</select>
                        <select aria-label={`Line ${i + 1} GIFI line`} value={l.newLine} onChange={(e) => setLine(i, { newLine: e.target.value })} className="input input-compact"><option value="">GIFI line (working papers)</option>{gifiLines.map(([no, name]) => <option key={no} value={no}>{no} {name}</option>)}</select>
                      </span>
                    )}
                  </td>
                  <td><input aria-label={`Line ${i + 1} debit`} inputMode="decimal" value={l.dr} onChange={(e) => setLine(i, { dr: e.target.value })} onBlur={(e) => setLine(i, { dr: tidyAmount(e.target.value) })} className="input input-compact text-right tabular-nums" /></td>
                  <td><input aria-label={`Line ${i + 1} credit`} inputMode="decimal" value={l.cr} onChange={(e) => setLine(i, { cr: e.target.value })} onBlur={(e) => setLine(i, { cr: tidyAmount(e.target.value) })} className="input input-compact text-right tabular-nums" /></td>
                  <td><input aria-label={`Line ${i + 1} description`} value={l.desc} onChange={(e) => setLine(i, { desc: e.target.value })} maxLength={200} className="input input-compact" /></td>
                  {ctx.registered && <td><select aria-label={`Line ${i + 1} sales tax`} value={l.tax} onChange={(e) => setTax(i, e.target.value)} className="input input-compact w-full">
                    <option value="">No tax</option>{codes.filter((c) => c.parts.some((p) => p.rate > 0)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></td>}
                  <td>{lines.length > 2 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger">×</button>}</td>
                </tr>
              );
            })}
            {plan.taxRows.map((t) => (
              <tr key={t.label} className="text-ink-2"><td /><td className="text-sm">{t.label}</td>
                <td className="text-right tabular-nums">{t.cents > 0 ? formatAmount(t.cents) : ""}</td><td className="text-right tabular-nums">{t.cents < 0 ? formatAmount(-t.cents) : ""}</td>
                <td className="text-xs">Worked out from the sales tax on the lines</td>{ctx.registered && <td />}<td /></tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold"><td /><td className="text-right">Total</td><td className="text-right tabular-nums">{formatAmount(plan.dr)}</td><td className="text-right tabular-nums">{formatAmount(plan.cr)}</td>
              <td className={plan.diff ? "text-danger" : "text-success"}>Difference {formatAmount(Math.abs(plan.diff))}</td>{ctx.registered && <td />}<td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="flex gap-3">
        <button type="button" className="btn-secondary btn-compact" onClick={() => setLines([...lines, blankLine(), blankLine()])}>Add lines</button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => { setLines([blankLine(), blankLine()]); setStd(""); setStdAmount(""); }}>Clear all lines</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Memo<textarea value={head.memo} onChange={(e) => setHead({ ...head, memo: e.target.value })} rows={3} maxLength={500} placeholder="What the entry does and why" className="input" /></label>
        <Attachments />
      </div>
      <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 rounded-b-[var(--radius-ds)] border-t border-sand-200 bg-sand-50 px-5 py-3 md:-mx-6 md:-mb-6 md:px-6">
        <a href={`/closebook/${fileId}?step=entries`} className="btn-secondary">Cancel</a>
        <span className="flex flex-wrap items-center gap-3">
          {!ok && <span role="status" className="text-sm text-ink-2">{plan.problems[0]}</span>}
          <button type="submit" className="btn" disabled={!ok}>Save</button>
        </span>
      </div>
    </form>
  );
}

// Attachments like QuickBooks Online (round 3 item 11): an "Add attachment" control and the files chosen,
// each with a remove button. The files ride on the form's own file input.
function Attachments() {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const sync = (list: File[]) => {
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(f));
    if (input.current) input.current.files = dt.files;
    setFiles(list);
  };
  return (
    <div className="grid content-start gap-1 text-sm font-medium">Attachments
      <input ref={input} type="file" name="attachments" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv" className="sr-only" aria-label="Add attachment"
        onChange={(e) => sync([...files, ...Array.from(e.target.files ?? [])].slice(0, 10))} />
      <div className="flex min-h-[78px] flex-col gap-1.5 rounded-lg border border-dashed border-sand-300 p-2.5">
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded bg-sand-50 px-2 py-1 text-sm font-normal">
            <span className="truncate">{f.name}</span>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => sync(files.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger">×</button>
          </span>
        ))}
        <button type="button" onClick={() => input.current?.click()} className="w-fit text-sm font-medium text-navy-700 underline">Add attachment</button>
        <span className="text-xs font-normal text-ink-3">PDF, image, Excel or CSV. Up to 10 files, 20 MB each.</span>
      </div>
    </div>
  );
}
