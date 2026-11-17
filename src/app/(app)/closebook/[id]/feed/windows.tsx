"use client";
// Round 31, step 4 (Hashim, Nov 17, 2026): the windows of the Bank transactions page, as QuickBooks Online has them:
// Edit selected transactions, Split, Ask the client, Exclude, and the pair options.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { AccountPicker, type Pick } from "./account-picker";
import type { FeedChart, FeedSplit } from "@/lib/closebook/feed-server";
import type { FeedAccount, PairOption } from "@/lib/closebook/bank-feed";
import type { TaxCode } from "@/lib/closebook/sales-tax";
import { formatDate } from "@/lib/dates";

// A compact field (the app's .input pads for 40 px fields).
export const FLD = "h-8 w-full rounded-[6px] border border-sand-300 bg-white px-2 text-[13.5px] outline-none focus:border-navy-600 disabled:bg-sand-50 disabled:text-ink-3";
export const money = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Modal({ title, onClose, children, foot, width = 560, label }: { title: string; onClose: () => void; children: ReactNode; foot: ReactNode; width?: number; label?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-navy-950/45 px-4 py-8" role="dialog" aria-modal="true" aria-label={label ?? title}>
      <div className="w-full overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]" style={{ maxWidth: width }}>
        <div className="flex items-center gap-3 border-b border-sand-200 px-6 py-4"><h2 className="text-[18px] font-semibold">{title}</h2><span className="flex-1" />
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 px-6 py-5 text-[14px]">{children}</div>
        <div className="flex justify-end gap-2 border-t border-sand-200 px-6 py-3.5">{foot}</div>
      </div>
    </div>
  );
}

const TaxSelect = ({ codes, value, onChange, disabled, label = "Sales tax" }: { codes: TaxCode[]; value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) => (
  <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={FLD}>
    <option value="">Choose</option>
    {codes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
  </select>
);
export { TaxSelect };

// ---------- Edit selected transactions (C2): one type of money only.
export type EditChoice = { type: string; pick: Pick | null; tax: string };
export function EditWindow({ n, out, chart, banks, codes, defaultTax, onClose, onApply }: {
  n: number; out: boolean; chart: FeedChart[]; banks: FeedAccount[]; codes: TaxCode[]; defaultTax: Record<string, string | null>;
  onClose: () => void; onApply: (c: EditChoice, post: boolean) => Promise<void>;
}) {
  const types = out ? ["Expense", "Transfer"] : ["Deposit", "Transfer"];
  const [type, setType] = useState(types[0]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [tax, setTax] = useState("");
  const [busy, setBusy] = useState(false);
  const transfer = type === "Transfer";
  const label = !pick ? "" : "account" in pick ? `${pick.account} ${chart.find((c) => c.number === pick.account)?.name ?? ""}` : banks.find((b) => b.id === pick.transfer)?.label ?? "";
  const ready = !!pick && (transfer || !!tax);
  const go = async (post: boolean) => { setBusy(true); await onApply({ type, pick, tax: transfer ? "" : tax }, post); setBusy(false); };
  return (
    <Modal title="Edit selected transactions" onClose={onClose} width={520} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-secondary" disabled={!ready || busy} onClick={() => go(false)}>Apply</button>
      <button type="button" className="btn" disabled={!ready || busy} onClick={() => go(true)}>Apply and post</button></>}>
      <p className="text-ink-2">{n} {out ? "money out" : "money in"} transaction{n === 1 ? "" : "s"} selected.</p>
      <label className="grid gap-1 font-semibold">Transaction type
        <select aria-label="Transaction type" value={type} onChange={(e) => { setType(e.target.value); setPick(null); setTax(""); }} className="input h-9 font-normal">
          {types.map((t) => <option key={t}>{t}</option>)}</select></label>
      <div className="grid gap-1"><span className="font-semibold">Account</span>
        <AccountPicker chart={chart} banks={banks} out={out} ownAccount={null} label={label} transferOnly={transfer}
          onPick={(p) => { setPick(p); if ("account" in p) setTax(defaultTax[p.account] ?? ""); }} /></div>
      {!transfer && <label className="grid gap-1 font-semibold">Sales tax<TaxSelect codes={codes} value={tax} onChange={setTax} /></label>}
    </Modal>
  );
}

// ---------- Split (C4)
type SplitRow = { pick: Pick | null; tax: string; amount: string; memo: string };
export function SplitWindow({ line, out, chart, codes, defaultTax, initial, onClose, onSave, onRemove }: {
  line: { date: string; description: string; cents: number }; out: boolean; chart: FeedChart[]; codes: TaxCode[]; defaultTax: Record<string, string | null>;
  initial: FeedSplit[]; onClose: () => void; onSave: (rows: { account: string; tax: string; amount: string; memo: string }[]) => Promise<boolean>; onRemove?: () => Promise<void>;
}) {
  const blank = (): SplitRow => ({ pick: null, tax: "", amount: "", memo: "" });
  const [rows, setRows] = useState<SplitRow[]>(initial.length ? initial.map((s) => ({ pick: { account: s.account }, tax: s.tax, amount: (s.cents / 100).toFixed(2), memo: s.memo })) : [blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) || 0;
  const left = Math.abs(line.cents) - rows.reduce((n, r) => n + cents(r.amount), 0);
  const ok = left === 0 && rows.filter((r) => r.pick || r.amount).length >= 2 && rows.every((r) => (!r.pick && !r.amount) || (r.pick && r.tax && cents(r.amount) !== 0));
  const set = (i: number, p: Partial<SplitRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Modal title="Split" onClose={onClose} width={860} foot={<>
      {onRemove && <button type="button" className="btn-secondary mr-auto" disabled={busy} onClick={async () => { setBusy(true); await onRemove(); setBusy(false); }}>Remove the split</button>}
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={!ok || busy} title={ok ? undefined : "Left to split must be 0.00."} onClick={async () => {
        setBusy(true);
        const done = await onSave(rows.filter((r) => r.pick && "account" in r.pick).map((r) => ({ account: (r.pick as { account: string }).account, tax: r.tax, amount: (cents(r.amount) / 100).toFixed(2), memo: r.memo })));
        setBusy(false); if (done) onClose();
      }}>Save</button></>}>
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-[8px] bg-sand-50 px-4 py-2.5"><span>{formatDate(line.date)}</span><span className="flex-1 font-semibold">{line.description}</span>
        <span className="tabular-nums">{out ? "Spent" : "Received"} {money(line.cents)}</span></div>
      <table className="w-full table-fixed text-[13.5px]">
        <colgroup><col /><col className="w-[11rem]" /><col className="w-[8rem]" /><col className="w-[12rem]" /><col className="w-8" /></colgroup>
        <thead><tr className="text-left text-[12px] text-ink-3 uppercase"><th className="pb-1 font-semibold">Account</th><th className="pb-1 font-semibold">Sales tax</th><th className="pb-1 text-right font-semibold">Amount</th><th className="pb-1 pl-2 font-semibold">Memo</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td className="py-1 pr-2"><AccountPicker chart={chart} banks={[]} out={out} ownAccount={null}
              label={r.pick && "account" in r.pick ? `${r.pick.account} ${chart.find((c) => c.number === (r.pick as { account: string }).account)?.name ?? ""}` : ""}
              onPick={(p) => "account" in p && set(i, { pick: p, tax: defaultTax[p.account] ?? r.tax })} /></td>
            <td className="py-1 pr-2"><TaxSelect codes={codes} value={r.tax} onChange={(v) => set(i, { tax: v })} label={`Sales tax, line ${i + 1}`} /></td>
            <td className="py-1"><input aria-label={`Amount, line ${i + 1}`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" className={`${FLD} text-right tabular-nums`} placeholder="0.00" /></td>
            <td className="py-1 pl-2"><input aria-label={`Memo, line ${i + 1}`} value={r.memo} onChange={(e) => set(i, { memo: e.target.value })} className={FLD} /></td>
            <td className="py-1 text-right">{rows.length > 2 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger">✕</button>}</td>
          </tr>))}</tbody>
      </table>
      <div className="flex items-center"><button type="button" className="text-navy-700 underline" onClick={() => setRows((rs) => [...rs, blank()])}>Add a line</button><span className="flex-1" />
        <span className={`font-semibold tabular-nums ${left === 0 ? "text-success" : "text-danger"}`}>Left to split: {left < 0 ? "−" : ""}{money(left)}</span></div>
    </Modal>
  );
}

// ---------- Ask the client (C5)
export function AskWindow({ lines, onClose, onSend }: { lines: { date: string; description: string; cents: number }[]; onClose: () => void; onSend: (q: string) => Promise<boolean> }) {
  const [q, setQ] = useState("What was this payment for?");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Ask the client" onClose={onClose} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={busy || q.trim().length < 3} onClick={async () => { setBusy(true); const ok = await onSend(q.trim()); setBusy(false); if (ok) onClose(); }}>Send</button></>}>
      <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-[8px] bg-sand-50 px-4 py-2.5">{lines.map((l, i) => (
        <li key={i} className="flex gap-3"><span className="w-24 flex-none tabular-nums">{formatDate(l.date)}</span><span className="flex-1 truncate">{l.description}</span><span className="tabular-nums">{money(l.cents)}</span></li>))}</ul>
      <label className="grid gap-1 font-semibold">Question<textarea aria-label="Question" value={q} onChange={(e) => setQ(e.target.value)} rows={3} maxLength={500} className="input font-normal" /></label>
      <p className="text-[13px] text-ink-3">Send adds {lines.length === 1 ? "the line" : "the lines"} to today&rsquo;s client request list. {lines.length === 1 ? "It stays" : "They stay"} in Pending.</p>
    </Modal>
  );
}

// ---------- Exclude (C6)
export const EXCLUDE_REASONS = [["duplicate", "Duplicate line"], ["recorded", "Already recorded by an entry"], ["other", "Other"]] as const;
export function ExcludeWindow({ n, onClose, onExclude }: { n: number; onClose: () => void; onExclude: (reason: "duplicate" | "recorded" | "other", note: string) => Promise<boolean> }) {
  const [reason, setReason] = useState<"duplicate" | "recorded" | "other" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = !!reason && (reason !== "other" || note.trim().length >= 3);
  return (
    <Modal title="Exclude" onClose={onClose} width={480} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={!ok || busy} onClick={async () => { setBusy(true); const d = await onExclude(reason as "duplicate", note.trim()); setBusy(false); if (d) onClose(); }}>Exclude</button></>}>
      <p className="text-ink-2">{n === 1 ? "This line" : `These ${n} lines`} will move to the Excluded tab and post nothing. The books are built from the statements, so the trial balance will differ from the bank by {n === 1 ? "its amount" : "their amounts"} until the reviewer checks it.</p>
      <fieldset className="grid gap-2"><legend className="mb-1 font-semibold">Reason</legend>
        {EXCLUDE_REASONS.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} />{l}</label>)}</fieldset>
      {reason === "other" && <label className="grid gap-1 font-semibold">Note<input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="input font-normal" placeholder="Why is it excluded?" /></label>}
    </Modal>
  );
}

// ---------- PAIR · 2 options (D)
export function PairWindow({ options, accounts, onClose, onPick }: { options: PairOption[]; accounts: FeedAccount[]; onClose: () => void; onPick: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Choose the other side of this transfer" onClose={onClose} width={640} foot={<button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}>
      <p className="text-ink-2">These lines in the client&rsquo;s other accounts have the same amount within 7 days. The nearest date is first. Pick the one that is the other side.</p>
      <table className="w-full text-[13.5px]"><thead><tr className="text-left text-[12px] text-ink-3 uppercase"><th className="pb-1">Account</th><th className="pb-1">Date</th><th className="pb-1">Bank description</th><th className="pb-1 text-right">Amount</th><th /></tr></thead>
        <tbody>{options.map((o) => (
          <tr key={o.id} className="border-t border-sand-100"><td className="py-2 pr-2">{accounts.find((a) => a.id === o.account_id)?.label.split(" · ")[0] ?? ""}</td><td className="py-2 pr-2 tabular-nums">{formatDate(o.date)}</td>
            <td className="py-2 pr-2">{o.description}</td><td className="py-2 text-right tabular-nums">{money(o.cents)}</td>
            <td className="py-2 pl-3 text-right"><button type="button" className="btn btn-compact" disabled={busy} onClick={async () => { setBusy(true); await onPick(o.id); setBusy(false); onClose(); }}>Pick</button></td></tr>))}</tbody></table>
    </Modal>
  );
}

// ---------- A small box below a button (dates, settings, memo, receipts, the date of a line)
export function Pop({ anchor, onClose, children, width = 300, align = "left" }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos] = useState<{ left: number; top: number } | null>(() => {
    const r = anchor?.getBoundingClientRect();
    return r ? { left: Math.max(8, Math.min(align === "right" ? r.right - width : r.left, window.innerWidth - width - 8)), top: r.bottom + 4 } : null;
  });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", close); window.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", k); };
  }, [anchor, onClose, width, align]);
  if (!pos) return null;
  return <div ref={ref} style={{ position: "fixed", left: pos.left, top: Math.min(pos.top, window.innerHeight - 40), width }}
    className="z-[75] grid gap-3 rounded-[10px] border border-sand-200 bg-white p-3.5 text-[13.5px] shadow-[0_12px_32px_rgba(15,35,80,.22)]">{children}</div>;
}
