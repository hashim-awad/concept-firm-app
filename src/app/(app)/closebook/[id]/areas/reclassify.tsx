"use client";
// Round 38 (Hashim, Nov 18, 2026): Reclassify transactions. Benchmarks: QuickBooks Online's "Reclassify Transactions"
// (the account list on the left, the filters above, tick lines, one window to change the account and the sales tax)
// and Xero's "Find and recode". Apply changes every ticked line in one step; the pill offers Undo.
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { notify } from "@/components/save-state";
import { formatDate } from "@/lib/dates";
import type { ReclassifyData, RcRow, RcTarget } from "@/lib/closebook/reclassify-server";
import { reclassifyLines, undoReclassify } from "../../reclassify-actions";
import { Modal } from "../feed/windows";

const money = (c: number) => (c < 0 ? `(${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 }));
const FLD = "h-9 rounded-[6px] border border-sand-300 bg-white px-2 text-[13.5px] outline-none focus:border-navy-600";
const PAGE = 200;

// Piece R1 (item 6): opened from another view with back=, it has "Cancel", which returns there.
export function ReclassifyPage({ data, initialAccount, back }: { data: ReclassifyData; initialAccount?: string; back?: string }) {
  const router = useRouter();
  const startAcct = data.accounts.find((a) => a.key === initialAccount);
  const [types, setTypes] = useState<"pl" | "bs">(startAcct ? (startAcct.pl ? "pl" : "bs") : "pl");
  const [find, setFind] = useState("");
  const [account, setAccount] = useState<string>(startAcct?.key ?? "");
  // The filters: typed here, applied with "Find transactions" (as QuickBooks Online).
  const blank = { from: data.yearStart, to: data.yearEnd, source: "all", tax: "all", q: "" };
  const [draft, setDraft] = useState(blank);
  const [f, setF] = useState(blank);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [win, setWin] = useState(false);

  const acctList = data.accounts.filter((a) => a.pl === (types === "pl") && (!find.trim() || `${a.number} ${a.name}`.toLowerCase().includes(find.trim().toLowerCase())));
  const rows = useMemo(() => data.rows.filter((r) => (!account || r.key === account) && r.date >= f.from && r.date <= f.to
    && (f.source === "all" || (f.source === "bank" ? r.source === "Bank line" : r.source !== "Bank line" && r.source !== "Opening balance" && r.source !== "Trial balance import"))
    && (f.tax === "all" || r.tax === f.tax) && (!f.q.trim() || r.description.toLowerCase().includes(f.q.trim().toLowerCase()))), [data.rows, account, f]);
  const movable = rows.filter((r) => r.item);
  const tickedRows = data.rows.filter((r) => ticked.has(r.id));
  const total = tickedRows.reduce((n, r) => n + r.cents, 0);
  const allTicked = movable.length > 0 && movable.every((r) => ticked.has(r.id));
  const acct = data.accounts.find((a) => a.key === account);
  // The chip stays after the last line moves out (the account then leaves the list), so the filter can be cleared.
  const chipLabel = acct ? `${acct.number} ${acct.name}`.trim() : account ? data.targets.find((t) => `chart:${t.value}` === account || t.value === account)?.label ?? account : "";
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const taxName = (c: string) => data.codes.find((x) => x.code === c)?.name ?? c;
  const th = "px-2 py-2 text-left text-[11.5px] font-bold tracking-[.06em] text-ink-2 uppercase";

  return (
    <div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)]" data-reclassify>
      {/* The accounts, with this year's balance (QuickBooks Online's left panel). */}
      <aside className="rounded-[var(--radius-ds)] border border-sand-200 bg-white p-3" aria-label="Accounts">
        <label className="grid gap-1 text-[12.5px] text-ink-2">Account types
          <select aria-label="Account types" value={types} onChange={(e) => setTypes(e.target.value as "pl" | "bs")} className={FLD}>
            <option value="pl">Profit and loss</option><option value="bs">Balance sheet</option></select></label>
        <label className="mt-3 flex h-9 items-center gap-1.5 rounded-[6px] border border-sand-300 px-2">
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an account" aria-label="Find an account" className="min-w-0 flex-1 text-[13.5px] outline-none" />
          <Search className="h-4 w-4 text-ink-3" aria-hidden /></label>
        <div className="mt-3 flex justify-between border-b border-sand-200 pb-1.5 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase"><span>Account</span><span>Amount</span></div>
        <ul className="max-h-[560px] overflow-y-auto" data-rc-accounts>
          {acctList.map((a) => (
            <li key={a.key}>
              <button type="button" onClick={() => { setAccount(a.key); setTicked(new Set()); setShown(PAGE); }} data-rc-account={a.number || a.name}
                className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sand-50 ${a.key === account ? "bg-navy-50" : ""}`}>
                <span className="min-w-0"><span className="block truncate text-[13px]" title={`${a.number} ${a.name}`}>{a.number} {a.name}</span><span className="block text-[11.5px] text-ink-3">{a.type}</span></span>
                <span className="shrink-0 pt-0.5 text-[12.5px] tabular-nums">{money(a.cents)}</span>
              </button>
            </li>))}
          {!acctList.length && <li className="px-2 py-2 text-[13px] text-ink-3">No account.</li>}
        </ul>
      </aside>

      <section className="min-w-0 rounded-[var(--radius-ds)] border border-sand-200 bg-white">
        <div className="flex items-start justify-between gap-4 border-b border-sand-200 px-4 py-3">
          <h2 className="text-[17px] font-semibold">Reclassify transactions</h2>
          {back && <a href={back} className="ml-auto self-center text-[13px] font-semibold text-navy-700 hover:underline" data-rc-cancel>Cancel</a>}
          <details className="max-w-md text-[13px] text-ink-2" data-rc-help>
            <summary className="cursor-pointer text-right font-semibold text-navy-700">How to do this</summary>
            <div className="mt-2 grid gap-2 rounded-[8px] border border-sand-200 bg-sand-50 p-3">
              <p>Benchmarks: QuickBooks Online&rsquo;s Reclassify Transactions, and Xero&rsquo;s Find and recode.</p>
              <p>Pick an account on the left, or filter by date, source, sales tax or words in the description. Tick the lines (the tick box at the top ticks every line that matches, on every page), then Reclassify: choose the new account, the new sales tax, or both, and Apply.</p>
              <p>Each line keeps its date, amount, description and memo. Bank lines post again with the new account; entry lines change their account and keep their sales tax. Greyed lines change elsewhere: hover one to see where.</p>
              <p>A bank line changed here removes step 4&rsquo;s sign-off, an entry line step 5&rsquo;s, as if you had changed it in that step. History keeps the batch and each line. Undo in the note puts every line back.</p>
            </div>
          </details>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
          <label className="grid gap-1 text-[12.5px] text-ink-2">From<input type="date" aria-label="From" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={FLD} /></label>
          <label className="grid gap-1 text-[12.5px] text-ink-2">To<input type="date" aria-label="To" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={FLD} /></label>
          <label className="grid gap-1 text-[12.5px] text-ink-2">Source<select aria-label="Source" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} className={FLD}>
            <option value="all">All</option><option value="bank">Bank lines</option><option value="entry">Entries</option></select></label>
          <label className="grid gap-1 text-[12.5px] text-ink-2">Sales tax<select aria-label="Sales tax" value={draft.tax} onChange={(e) => setDraft({ ...draft, tax: e.target.value })} className={FLD}>
            <option value="all">All</option>{data.codes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <label className="flex h-9 w-64 items-center gap-1.5 rounded-[6px] border border-sand-300 px-2">
            <input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { setF(draft); setTicked(new Set()); } }}
              placeholder="Search by description or memo" aria-label="Search by description or memo" className="min-w-0 flex-1 text-[13.5px] outline-none" /><Search className="h-4 w-4 text-ink-3" aria-hidden /></label>
          <button type="button" className="btn-secondary h-9" onClick={() => { setF(draft); setTicked(new Set()); setShown(PAGE); }}>Find transactions</button>
        </div>
        {chipLabel && (
          <div className="px-4 pt-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1 text-[12.5px]" data-rc-chip>
            Account: {chipLabel}
            <button type="button" aria-label="Clear the account" onClick={() => { setAccount(""); setTicked(new Set()); }} className="rounded-full p-0.5 hover:bg-sand-200"><X className="h-3.5 w-3.5" /></button></span></div>)}

        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button type="button" className="btn" disabled={!ticked.size || data.locked} onClick={() => setWin(true)} data-rc-open>Reclassify</button>
          <span className="text-[13.5px] font-semibold tabular-nums" data-rc-selected>{ticked.size} transaction line{ticked.size === 1 ? "" : "s"} selected: {money(total)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px]">
            {/* Fits the page at 1280 px with no sideways scrolling: the account and description share what is left. */}
            <colgroup><col className="w-8" /><col className="w-[5.75rem]" /><col className="w-[5.5rem]" /><col className="w-[4.25rem]" /><col className="w-[15%]" /><col /><col className="w-[5.5rem]" /><col className="w-[6.25rem]" /></colgroup>
            <thead><tr className="border-y border-sand-200">
              <th className="px-2 py-2"><input type="checkbox" aria-label="Tick every line that matches" checked={allTicked} disabled={!movable.length || data.locked}
                onChange={() => setTicked(allTicked ? new Set() : new Set(movable.map((r) => r.id)))} /></th>
              <th className={th}>Date</th><th className={th}>Source</th><th className={th}>Account no.</th><th className={th}>Account</th><th className={th}>Description</th><th className={th}>Sales tax</th>
              <th className={`${th} text-right`} title="The amount before sales tax">Net amount</th></tr></thead>
            <tbody>{rows.slice(0, shown).map((r) => <Row key={r.id} r={r} on={ticked.has(r.id)} toggle={toggle} taxName={taxName} />)}</tbody>
          </table>
          {!rows.length && <p className="px-4 py-4 text-[13.5px] text-ink-3">No transactions match.</p>}
          {rows.length > shown && <p className="px-4 py-3 text-[13px]"><button type="button" className="font-semibold text-navy-700 hover:underline" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button> of {rows.length - shown} not shown</p>}
        </div>
      </section>

      {win && <ReclassifyWindow data={data} rows={tickedRows} total={total} onClose={() => setWin(false)} onDone={(batch, n) => {
        setWin(false); setTicked(new Set()); router.refresh();
        notify(`Reclassified ${n} line${n === 1 ? "" : "s"}`, "ok", { ms: 15000, action: { label: "Undo", run: async () => {
          const r = await undoReclassify(data.fileId, batch);
          if (!r.ok) { notify(r.error, "error"); return; }
          notify(r.n === n ? `Undone: ${n} line${n === 1 ? "" : "s"} back` : `Undone: ${r.n} of ${n} lines back (the others changed since)`);
          router.refresh();
        } } });
      }} />}
    </div>
  );
}

function Row({ r, on, toggle, taxName }: { r: RcRow; on: boolean; toggle: (id: string) => void; taxName: (c: string) => string }) {
  const off = !r.item;
  return (
    <tr className={`h-11 border-b border-sand-100 ${off ? "text-ink-3" : on ? "bg-navy-50/60" : ""}`} title={r.why || undefined} data-rc-row={r.description} data-rc-off={off ? r.why : undefined}>
      <td className="px-2"><input type="checkbox" aria-label={`Tick ${r.description}`} checked={on} disabled={off} onChange={() => toggle(r.id)} /></td>
      <td className="px-2 whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
      <td className="truncate px-2" title={r.source}>{r.source}</td>
      <td className="px-2 tabular-nums">{r.number}</td>
      <td className="px-2 py-1" title={r.account}><span className="line-clamp-2">{r.account}</span></td>
      <td className="px-2 py-1" title={r.why ? `${r.description}\n${r.why}` : r.description}><span className="line-clamp-2 break-words">{r.description}{off && <span className="ml-2 text-[11.5px] italic">· {r.why}</span>}</span></td>
      <td className="truncate px-2" title={taxName(r.tax)}>{taxName(r.tax)}</td>
      <td className="px-2 text-right tabular-nums">{money(r.cents)}</td>
    </tr>
  );
}

// "Change account to": a list to search, the account's type on the right (QuickBooks Online).
function TargetPicker({ targets, value, onPick }: { targets: RcTarget[]; value: string; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const label = targets.find((t) => t.value === value)?.label ?? "";
  const list = targets.filter((t) => !q.trim() || t.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200);
  return (
    <div className="relative" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <div className="flex h-9 items-center rounded-[6px] border border-sand-300 bg-white focus-within:border-navy-600">
        <input value={open ? q : label} onFocus={() => { setOpen(true); setQ(""); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Select"
          aria-label="Change account to" className="min-w-0 flex-1 px-2 text-[13.5px] outline-none" />
        <ChevronDown className="mr-2 h-4 w-4 text-ink-3" aria-hidden />
      </div>
      {open && (
        <ul className="absolute z-[90] mt-1 max-h-72 w-full overflow-y-auto rounded-[8px] border border-sand-200 bg-white py-1 shadow-[0_12px_32px_rgba(15,35,80,.18)]" role="listbox">
          {list.map((t) => (
            <li key={t.value}><button type="button" role="option" aria-selected={t.value === value} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(t.value); setOpen(false); }}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13.5px] hover:bg-sand-50"><span className="truncate">{t.label}</span><span className="shrink-0 text-[12px] text-ink-3 italic">{t.type}</span></button></li>))}
          {!list.length && <li className="px-3 py-1.5 text-[13px] text-ink-3">No account.</li>}
        </ul>)}
    </div>
  );
}

function ReclassifyWindow({ data, rows, total, onClose, onDone }: { data: ReclassifyData; rows: RcRow[]; total: number; onClose: () => void; onDone: (batch: string, n: number) => void }) {
  const [account, setAccount] = useState("");
  const [tax, setTax] = useState("");
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const n = rows.length;
  const bank = rows.some((r) => r.kind === "bank"), entry = rows.some((r) => r.kind === "entry");
  // Which sign-offs this removes, before Apply (the same rules as changing each line in its own step).
  const falls = [bank && data.signed.code ? "Step 4, Code transactions" : "", entry && data.signed.entries ? "Step 5, Adjustments" : ""].filter(Boolean);
  const apply = () => start(async () => {
    setErr("");
    const r = await reclassifyLines(data.fileId, rows.map((x) => ({ kind: x.kind as "bank" | "entry", id: x.item! })), account, tax, total / 100);
    if (!r.ok) { setErr(r.error); return; }
    onDone(r.batch, n);
  });
  return (
    <Modal title={`Reclassify ${n} transaction line${n === 1 ? "" : "s"}`} onClose={onClose} width={520} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={(!account && !tax) || busy} onClick={apply} data-rc-apply>{busy ? "Applying…" : "Apply"}</button></>}>
      <p className="text-ink-2">{n} line{n === 1 ? "" : "s"}, {money(total)}. Each line keeps its date, amount, description and memo.</p>
      <div className="grid gap-1"><span className="font-semibold">Change account to</span><TargetPicker targets={data.targets} value={account} onPick={setAccount} /></div>
      <label className="grid gap-1 font-semibold">Change sales tax to
        <select aria-label="Change sales tax to" value={tax} onChange={(e) => setTax(e.target.value)} className={FLD}>
          <option value="">Select (optional)</option>{data.codes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      {tax && entry && <p className="text-[12.5px] text-ink-2">Entry lines keep their sales tax: an entry&rsquo;s tax line is worked out in step 5. The new tax applies to the bank lines.</p>}
      {falls.length > 0 && <p className="rounded-[8px] border border-warning/40 bg-warning-soft px-3 py-2 text-[13px]" data-rc-signoffs>
        This removes the sign-off on {falls.join(" and ")}, and on the steps that rest on {falls.length === 1 ? "it" : "them"}.</p>}
      {err && <p className="text-[13px] text-danger" role="alert">{err}</p>}
    </Modal>
  );
}
