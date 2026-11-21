"use client";
// CB2-1 Part 3c: QuickBooks Online's Journal Entry window, copied. Two differences only: "Reclass entry" sits where QBO shows
// "Is Adjusting Journal Entry?", and there is no Name column. Must balance to save; anything else saves, with at most a
// warning line in the window.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Clock, Copy, GripVertical, HelpCircle, Paperclip, Trash2, X } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dates";
import { bracketAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { entryLineTax, type TaxCode } from "@/lib/closebook/sales-tax";
import { Picker } from "../../picker";
import { deleteEntry, saveEntry, uploadEntryFiles } from "../../actions";

export type WinLine = { account: string; amount: number; memo: string; tax: string };
export type WinEntry = { id: string | null; genId?: string; saved: boolean; origin: string | null; no: string; date: string; reclass: boolean; memo: string; lines: WinLine[];
  attachments: string[]; locked: boolean; schedule?: boolean };
type Acct = { value: string; label: string; sort: string; type: string; tax: string; number: string };
type Row = { key: number; account: string; dr: string; cr: string; memo: string; tax: string };
type Hist = { id: string; at: string; who: string; detail: string; old: string | null; now: string | null };

let seq = 0;
const blank = (): Row => ({ key: ++seq, account: "", dr: "", cr: "", memo: "", tax: "" });
const pad = (rows: Row[], n = 8) => (rows.length >= n ? rows : [...rows, ...Array.from({ length: n - rows.length }, blank)]);
const fmt = (c: number) => (c ? bracketAmount(c) : "");

export function JournalWindow({ clientId, entry, nextNo, accounts, codes, years, canEdit, history, journal, warnings, back, openHistory }: {
  clientId: string; entry: WinEntry; nextNo: string; accounts: Acct[]; codes: TaxCode[]; years: { from: string; to: string; registered: boolean; quick: boolean }[];
  canEdit: boolean; history: Hist[]; journal: { account: string; cents: number }[]; warnings: string[]; back: string; openHistory: boolean;
}) {
  const router = useRouter();
  const base = `/cb/${clientId}/journal`;
  const [date, setDate] = useState(entry.date);
  const [no, setNo] = useState(entry.saved ? entry.no : nextNo);
  const [reclass, setReclass] = useState(entry.reclass);
  const [memo, setMemo] = useState(entry.memo);
  const [rows, setRows] = useState<Row[]>(() => pad(entry.lines.map((l) => ({ key: ++seq, account: l.account, dr: l.amount > 0 ? bracketAmount(l.amount) : "", cr: l.amount < 0 ? bracketAmount(-l.amount) : "", memo: l.memo, tax: l.tax }))));
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"history" | "journal" | "help" | null>(openHistory ? "history" : null);
  const [more, setMore] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [pending, start] = useTransition();
  const drag = useRef<number | null>(null);
  // Until the switch-over, the opening balances, opening difference and trial balance import entries are view-only here.
  const viewOnly = !!entry.genId || ["opening_balances", "opening_difference", "tb_import"].includes(entry.origin ?? "");
  const ro = !canEdit || viewOnly;
  const act = canEdit && !viewOnly;
  const acct = useMemo(() => new Map(accounts.map((a) => [a.value, a])), [accounts]);
  const code = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);
  const ctx = useMemo(() => years.find((y) => y.from <= date && date <= y.to) ?? years[years.length - 1] ?? { registered: true, quick: false }, [years, date]);
  const taxOpts = codes.map((c) => ({ value: c.code, label: c.name, sort: c.name }));
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !panel) router.push(back); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [panel, back, router]);

  // The lines as posted: each line's amount before tax, plus what sales tax adds (QBO Canada): ITCs and tax collected on
  // GST/HST payable (21500), PST collected on PST payable (21550), anything not claimable on the line's own account.
  const plan = useMemo(() => {
    let gst = 0, pst = 0, dr = 0, cr = 0;
    const out: { account: string; amount: number; memo: string; tax_code: string | null; is_tax?: boolean }[] = [];
    const problems: string[] = [];
    rows.forEach((r, i) => {
      const d = parseAmount(r.dr) ?? 0, c = parseAmount(r.cr) ?? 0;
      if (!r.account && !d && !c) return;
      if (!r.account) { problems.push(`Line ${i + 1} needs an account.`); dr += d; cr += c; return; }
      if (d && c) { problems.push(`Line ${i + 1}: a debit or a credit, not both.`); return; }
      const net = d - c;
      const t = entryLineTax(net, r.tax ? code.get(r.tax) ?? null : null, acct.get(r.account)?.type ?? "", ctx);
      gst += t.gstHst; pst += t.pst;
      const amount = net + t.toLine;
      if (amount > 0) dr += amount; else cr -= amount;
      out.push({ account: r.account, amount, memo: r.memo.trim(), tax_code: r.tax || null });
    });
    if (gst) { out.push({ account: "tax:21500", amount: gst, memo: "Sales tax", tax_code: null, is_tax: true }); if (gst > 0) dr += gst; else cr -= gst; }
    if (pst) { out.push({ account: "tax:21550", amount: pst, memo: "Sales tax", tax_code: null, is_tax: true }); if (pst > 0) dr += pst; else cr -= pst; }
    if (out.filter((x) => !x.is_tax).length < 2 && !problems.length) problems.push("Enter at least two lines.");
    if (dr !== cr && !problems.length) problems.push(`Debits and credits must be equal. They differ by ${bracketAmount(Math.abs(dr - cr))}.`);
    return { out, dr, cr, gst, pst, problems };
  }, [rows, code, acct, ctx]);

  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const pickAccount = (i: number, v: string) => set(i, { account: v, ...(rows[i].tax ? {} : { tax: acct.get(v)?.tax ?? "" }) });
  const save = (then: "close" | "new") => start(async () => {
    setError(null);
    if (plan.problems.length) { setError(plan.problems[0]); return; }
    let attachments: string[] | undefined;
    if (files.length) {
      const fd = new FormData(); for (const f of files) fd.append("files", f);
      const up = await uploadEntryFiles(clientId, fd);
      if ("error" in up) { setError(up.error); return; }
      attachments = up.paths;
    }
    const r = await saveEntry(clientId, { id: entry.id, date, journalNo: no, reclass, memo, origin: entry.genId ? entry.origin : null, attachments,
      lines: plan.out.map((l) => ({ ...l, amount: l.amount / 100 })) });
    if (!r.ok) { setError(r.error); return; }
    router.push(then === "new" ? `${base}/new` : back);
    router.refresh();
  });
  const remove = () => start(async () => {
    if (!entry.id) return;
    const r = await deleteEntry(clientId, entry.id);
    if (r.error) { setError(r.error); setAskDelete(false); return; }
    router.push(back); router.refresh();
  });
  const title = entry.saved ? `Journal entry no. ${entry.no}` : entry.genId ? `Journal entry: ${entry.memo}` : `Journal entry no. ${no}`;
  const reverseHref = `${base}/new?reverse=${encodeURIComponent(entry.id ?? entry.genId ?? "")}&back=${encodeURIComponent(back)}`;
  const copyHref = `${base}/new?copy=${encodeURIComponent(entry.id ?? entry.genId ?? "")}&back=${encodeURIComponent(back)}`;
  const iconBtn = "rounded p-1.5 text-ink-2 hover:bg-sand-100";
  const cell = "border-b border-sand-200 px-1.5 py-1 align-top";

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white" data-journal-window>
      {/* Top bar: History (QBO's clock) and the title at the left; Copy, Help and Close at the right. */}
      <div className="flex flex-none items-center gap-2 border-b border-sand-200 px-4 py-2.5">
        <button type="button" onClick={() => setPanel(panel === "history" ? null : "history")} aria-label="Audit history" title="Audit history" className={iconBtn} disabled={!entry.saved} data-je-history-icon><Clock className="h-5 w-5" /></button>
        <h1 className="min-w-0 truncate text-[18px] font-bold" data-je-title>{title}</h1>
        <span className="flex-1" />
        {entry.saved && act && <a href={copyHref} className={`${iconBtn} flex items-center gap-1 text-[13px]`} data-je-copy><Copy className="h-4 w-4" />Copy</a>}
        <button type="button" onClick={() => setPanel(panel === "help" ? null : "help")} aria-label="Help" title="Help" className={iconBtn}><HelpCircle className="h-5 w-5" /></button>
        <button type="button" onClick={() => router.push(back)} aria-label="Close" title="Close" className={iconBtn} data-je-close><X className="h-5 w-5" /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {/* Header: Journal date, Journal no., Reclass entry. */}
          <div className="flex flex-wrap items-end gap-4">
            <label className="grid gap-1 text-[12.5px] font-semibold text-ink-2">Journal date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={ro} className="input input-compact w-40" data-je-date /></label>
            <label className="grid gap-1 text-[12.5px] font-semibold text-ink-2">Journal no.<input value={no} onChange={(e) => setNo(e.target.value)} disabled={ro || !!entry.genId} maxLength={21} className="input input-compact w-32" data-je-no /></label>
            <label className="flex items-center gap-2 pb-2 text-[13px]"><input type="checkbox" checked={reclass} onChange={(e) => setReclass(e.target.checked)} disabled={ro} className="h-4 w-4" data-je-reclass />Reclass entry</label>
          </div>
          {viewOnly && <p className="mt-3 rounded-md bg-navy-50 px-3 py-2 text-[13px] text-navy-800" data-je-view-only>Change this entry in the old Closebook until the switch-over.</p>}
          {warnings.length > 0 && <ul className="mt-3 grid gap-1 rounded-md bg-warning-soft px-3 py-2 text-[12.5px] text-warning" data-je-warnings>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {entry.schedule && <p className="mt-3 text-[12.5px] text-ink-3">Made by a schedule. It edits here as an ordinary entry.</p>}
          {/* Lines: #, Account, Debits, Credits, Description, Sales tax. */}
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] border-collapse text-[13px]" data-je-lines>
              <thead><tr className="border-b border-sand-300 text-left text-[11.5px] font-semibold uppercase tracking-[.04em] text-ink-3">
                <th className="w-12 px-1.5 py-2">#</th><th className="px-1.5 py-2">Account</th><th className="w-32 px-1.5 py-2 text-right">Debits</th><th className="w-32 px-1.5 py-2 text-right">Credits</th>
                <th className="px-1.5 py-2">Description</th><th className="w-44 px-1.5 py-2">Sales tax</th><th className="w-16" /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={r.key} draggable={!ro} onDragStart={() => { drag.current = i; }} onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { const from = drag.current; drag.current = null; if (from === null || from === i) return; setRows((rs) => { const c = [...rs]; const [m] = c.splice(from, 1); c.splice(i, 0, m); return c; }); }}
                  data-je-line={i + 1}>
                  <td className={`${cell} whitespace-nowrap pt-2.5 text-ink-3`}>{!ro && <GripVertical className="mr-0.5 inline h-4 w-4 cursor-grab" aria-label="Drag to reorder" />}{i + 1}</td>
                  <td className={`${cell} min-w-[16rem]`}>{ro ? <span className="block pt-1.5">{acct.get(r.account)?.label}</span> : <Picker compact ariaLabel={`Line ${i + 1} account`} value={r.account} onChange={(v) => pickAccount(i, v)} options={accounts} placeholder="" />}</td>
                  <td className={cell}><input value={r.dr} onChange={(e) => set(i, { dr: e.target.value, ...(e.target.value ? { cr: "" } : {}) })} onBlur={(e) => set(i, { dr: tidyAmount(e.target.value) })} disabled={ro} inputMode="decimal" aria-label={`Line ${i + 1} debit`} className="input input-compact w-full text-right tabular-nums" /></td>
                  <td className={cell}><input value={r.cr} onChange={(e) => set(i, { cr: e.target.value, ...(e.target.value ? { dr: "" } : {}) })} onBlur={(e) => set(i, { cr: tidyAmount(e.target.value) })} disabled={ro} inputMode="decimal" aria-label={`Line ${i + 1} credit`} className="input input-compact w-full text-right tabular-nums" /></td>
                  <td className={cell}><input value={r.memo} onChange={(e) => set(i, { memo: e.target.value })} disabled={ro} maxLength={200} aria-label={`Line ${i + 1} description`} className="input input-compact w-full" /></td>
                  <td className={cell}>{ro ? <span className="block pt-1.5">{code.get(r.tax)?.name}</span> : <Picker compact ariaLabel={`Line ${i + 1} sales tax`} value={r.tax} onChange={(v) => set(i, { tax: v })} options={taxOpts} allowEmpty emptyLabel="None" placeholder="" />}</td>
                  <td className={`${cell} whitespace-nowrap pt-1.5`}>{!ro && <>
                    <button type="button" aria-label={`Copy line ${i + 1}`} title="Copy line" onClick={() => setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i], key: ++seq }, ...rs.slice(i + 1)])} className={iconBtn}><Copy className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Delete line ${i + 1}`} title="Delete line" onClick={() => setRows((rs) => pad(rs.filter((_, k) => k !== i), 2))} className={iconBtn}><Trash2 className="h-4 w-4" /></button></>}</td>
                </tr>
              ))}
                {(plan.gst !== 0 || plan.pst !== 0) && <>
                  {plan.gst !== 0 && <tr className="text-ink-2" data-je-taxline><td /><td className="px-1.5 py-1.5">21500 GST/HST payable (sales tax)</td><td className="px-1.5 text-right tabular-nums">{plan.gst > 0 ? fmt(plan.gst) : ""}</td><td className="px-1.5 text-right tabular-nums">{plan.gst < 0 ? fmt(-plan.gst) : ""}</td><td colSpan={3} /></tr>}
                  {plan.pst !== 0 && <tr className="text-ink-2" data-je-taxline><td /><td className="px-1.5 py-1.5">21550 PST payable (sales tax)</td><td className="px-1.5 text-right tabular-nums">{plan.pst > 0 ? fmt(plan.pst) : ""}</td><td className="px-1.5 text-right tabular-nums">{plan.pst < 0 ? fmt(-plan.pst) : ""}</td><td colSpan={3} /></tr>}
                </>}
                <tr className="font-bold" data-je-total><td /><td className="px-1.5 py-2 text-right">Total</td><td className="border-t-2 border-ink px-1.5 py-2 text-right tabular-nums">{bracketAmount(plan.dr)}</td>
                  <td className="border-t-2 border-ink px-1.5 py-2 text-right tabular-nums">{bracketAmount(plan.cr)}</td><td colSpan={3} /></tr></tbody>
            </table>
          </div>
          {/* Phone width: each line as a card (same fields), so nothing scrolls sideways. */}
          <ol className="mt-4 grid gap-2.5 md:hidden" data-je-cards>{rows.map((r, i) => (
            <li key={r.key} className="rounded-md border border-sand-200 p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-ink-3"><span>Line {i + 1}</span>{!ro && <span>
                <button type="button" aria-label={`Copy line ${i + 1}`} onClick={() => setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i], key: ++seq }, ...rs.slice(i + 1)])} className={iconBtn}><Copy className="h-4 w-4" /></button>
                <button type="button" aria-label={`Delete line ${i + 1}`} onClick={() => setRows((rs) => pad(rs.filter((_, k) => k !== i), 2))} className={iconBtn}><Trash2 className="h-4 w-4" /></button></span>}</div>
              <div className="grid gap-1.5">
                {ro ? <span>{acct.get(r.account)?.label}</span> : <Picker compact ariaLabel={`Line ${i + 1} account (phone)`} value={r.account} onChange={(v) => pickAccount(i, v)} options={accounts} placeholder="Account" />}
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={r.dr} onChange={(e) => set(i, { dr: e.target.value, ...(e.target.value ? { cr: "" } : {}) })} onBlur={(e) => set(i, { dr: tidyAmount(e.target.value) })} disabled={ro} inputMode="decimal" placeholder="Debit" aria-label={`Line ${i + 1} debit (phone)`} className="input input-compact w-full text-right tabular-nums" />
                  <input value={r.cr} onChange={(e) => set(i, { cr: e.target.value, ...(e.target.value ? { dr: "" } : {}) })} onBlur={(e) => set(i, { cr: tidyAmount(e.target.value) })} disabled={ro} inputMode="decimal" placeholder="Credit" aria-label={`Line ${i + 1} credit (phone)`} className="input input-compact w-full text-right tabular-nums" />
                </div>
                <input value={r.memo} onChange={(e) => set(i, { memo: e.target.value })} disabled={ro} maxLength={200} placeholder="Description" aria-label={`Line ${i + 1} description (phone)`} className="input input-compact w-full" />
                {ro ? <span className="text-ink-2">{code.get(r.tax)?.name}</span> : <Picker compact ariaLabel={`Line ${i + 1} sales tax (phone)`} value={r.tax} onChange={(v) => set(i, { tax: v })} options={taxOpts} allowEmpty emptyLabel="No sales tax" placeholder="Sales tax" />}
              </div>
            </li>))}
            {plan.gst !== 0 && <li className="flex justify-between px-1 text-[13px] text-ink-2"><span>21500 GST/HST payable (sales tax)</span><span className="tabular-nums">{bracketAmount(plan.gst)}</span></li>}
            {plan.pst !== 0 && <li className="flex justify-between px-1 text-[13px] text-ink-2"><span>21550 PST payable (sales tax)</span><span className="tabular-nums">{bracketAmount(plan.pst)}</span></li>}
            <li className="flex justify-between border-t-2 border-ink px-1 pt-1.5 text-[13px] font-bold"><span>Total</span><span className="tabular-nums">Debits {bracketAmount(plan.dr)} · Credits {bracketAmount(plan.cr)}</span></li>
          </ol>
          {!ro && <div className="mt-2 flex gap-2">
            <button type="button" className="btn-secondary btn-compact" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 8 }, blank)])} data-je-add-lines>Add lines</button>
            <button type="button" className="btn-secondary btn-compact" onClick={() => setRows(pad([]))} data-je-clear-lines>Clear all lines</button></div>}
          {/* Memo (left) and Attachments (right). */}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-[12.5px] font-semibold text-ink-2">Memo<textarea value={memo} onChange={(e) => setMemo(e.target.value)} disabled={ro} maxLength={500} rows={4} className="input min-h-24 py-2" data-je-memo /></label>
            <div className="grid content-start gap-1 text-[12.5px] font-semibold text-ink-2"><span className="flex items-center gap-1"><Paperclip className="h-4 w-4" />Attachments</span>
              <div className="rounded-md border border-dashed border-sand-300 p-3 text-[12.5px] font-normal">
                {entry.attachments.length > 0 && <ul className="mb-2 grid gap-0.5">{entry.attachments.map((a) => <li key={a}>{a}</li>)}</ul>}
                {!ro && <input type="file" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} aria-label="Add attachments" className="text-[12.5px]" />}
                {!entry.attachments.length && ro && <span className="text-ink-3">None</span>}
                <p className="mt-1 text-ink-3">Max 10 files.</p>
              </div></div>
          </div>
          {(error || (plan.problems.length > 0 && plan.out.length > 0)) && <p role="alert" className="mt-3 text-[13px] text-danger" data-je-error>{error ?? plan.problems[0]}</p>}
        </div>
        {panel && (
          <aside className="w-[min(24rem,100vw)] flex-none overflow-y-auto border-l border-sand-200 bg-white px-4 py-4 max-md:fixed max-md:inset-0 max-md:z-10" data-je-panel={panel}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">{panel === "history" ? "Audit history" : panel === "journal" ? "Transaction journal" : "Help"}</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="Close" className={iconBtn}><X className="h-4 w-4" /></button></div>
            {panel === "history" && <ol className="grid gap-2.5">{history.map((h) => (
              <li key={h.id} className="rounded-md border border-sand-200 p-2.5 text-[12.5px]"><p className="text-[11.5px] text-ink-3">{formatDateTime(h.at)}{h.who ? ` · ${h.who}` : ""}</p><p className="mt-0.5 font-semibold">{h.detail}</p>
                {(h.old || h.now) && <div className="mt-1 grid gap-1">{h.old && <pre className="whitespace-pre-wrap rounded bg-sand-50 p-1.5 font-sans text-[11.5px]">{h.old}</pre>}{h.now && <pre className="whitespace-pre-wrap rounded bg-navy-50 p-1.5 font-sans text-[11.5px]">{h.now}</pre>}</div>}</li>))}
              {!history.length && <li className="text-[12.5px] text-ink-3">{entry.saved ? "Nothing recorded yet." : "This entry is not saved yet."}</li>}</ol>}
            {panel === "journal" && <table className="w-full text-[12.5px]"><thead><tr className="text-left text-ink-3"><th className="py-1">Account</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th></tr></thead>
              <tbody>{journal.map((j, i) => <tr key={i} className="border-t border-sand-200"><td className="py-1">{j.account}</td><td className="py-1 text-right tabular-nums">{j.cents > 0 ? fmt(j.cents) : ""}</td><td className="py-1 text-right tabular-nums">{j.cents < 0 ? fmt(-j.cents) : ""}</td></tr>)}
                {!journal.length && <tr><td colSpan={3} className="py-1 text-ink-3">Nothing posted yet.</td></tr>}</tbody></table>}
            {panel === "help" && <div className="grid gap-2 text-[12.5px] text-ink-2"><p>Enter each line&rsquo;s account and its debit or credit. The entry saves when debits equal credits.</p>
              <p>Sales tax: choose the code on a line; the amount is before tax. Closebook adds the tax to GST/HST payable, as QuickBooks Online does.</p>
              <p>Reclass entry: tick it for a reclassification. It decides the Reclass column of the trial balance by group; nothing else depends on it.</p></div>}
          </aside>
        )}
      </div>
      {/* Footer: Cancel at the left; Reverse and More in the middle (saved entries); Save and Save and new at the right. */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-t border-sand-200 bg-sand-50 px-4 py-3">
        <button type="button" className="btn-secondary" onClick={() => router.push(back)} data-je-cancel>Cancel</button>
        <span className="flex-1" />
        {(entry.saved || entry.genId) && act && <a href={reverseHref} className="btn-secondary" data-je-reverse>Reverse</a>}
        {(entry.saved || entry.genId) && (
          <div className="relative">
            <button type="button" className="btn-secondary" onClick={() => setMore(!more)} aria-expanded={more} data-je-more>More</button>
            {more && <ul className="absolute bottom-full left-0 mb-1 w-48 rounded-md border border-sand-200 bg-white py-1 shadow-xl">
              {act && <li><a href={copyHref} className="block px-3 py-2 text-[13px] hover:bg-sand-100">Copy</a></li>}
              {entry.saved && act && <li><button type="button" className="block w-full px-3 py-2 text-left text-[13px] hover:bg-sand-100" onClick={() => { setMore(false); setAskDelete(true); }} data-je-delete>Delete</button></li>}
              <li><button type="button" className="block w-full px-3 py-2 text-left text-[13px] hover:bg-sand-100" onClick={() => { setMore(false); setPanel("journal"); }} data-je-txn-journal>Transaction journal</button></li>
              <li><button type="button" className="block w-full px-3 py-2 text-left text-[13px] hover:bg-sand-100" onClick={() => { setMore(false); setPanel("history"); }} data-je-audit>Audit history</button></li>
            </ul>}
          </div>
        )}
        <span className="flex-1" />
        {act && <>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => save("close")} data-je-save>Save</button>
          <button type="button" className="btn" disabled={pending} onClick={() => save("new")} data-je-save-new>Save and new</button></>}
      </div>
      {askDelete && (
        <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-navy-950/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"><p className="text-[15px] font-semibold">Delete journal entry no. {entry.no}?</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setAskDelete(false)}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={pending} onClick={remove} data-je-delete-yes>Delete</button></div></div>
        </div>
      )}
      <span className="sr-only">{formatDate(date)}</span>
    </div>
  );
}
