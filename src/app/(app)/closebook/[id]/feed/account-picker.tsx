"use client";
// Round 31, step 4 (Hashim, Nov 17, 2026): the account field, as QuickBooks Online's category field on the Bank
// transactions page. Click it: it becomes a text box with the cursor in it and the list opens below. Typing filters at
// once by number or by any word in the name ("63" shows 63000 Bank charges; "bank" shows Bank charges and the bank
// accounts). Each row: number and name on the left, the account type on the right in grey. The client's bank, card and
// loan accounts come first, under "Transfer to" (money out) or "Transfer from" (money in). ↑ ↓ move, Enter picks, Esc closes.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FeedChart } from "@/lib/closebook/feed-server";
import type { FeedAccount } from "@/lib/closebook/bank-feed";

export type Pick = { account: string } | { transfer: string };
type Item = { key: string; pick: Pick; number: string; name: string; type: string };

export function filterItems(items: Item[], q: string): Item[] {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  const words = t.split(/\s+/);
  // A bank, card or loan account of the client's is found by its type too, and by the word "bank" (step 3's bank accounts).
  const text = (i: Item) => (i.key.startsWith("b:") ? `${i.name} ${i.type} bank` : i.name).toLowerCase();
  return items.filter((i) => words.every((w) => i.number.startsWith(w) || text(i).includes(w)));
}

export function AccountPicker({ chart, banks, out, ownAccount, label, badge, disabled, onPick, transferOnly = false, placeholder = "Choose an account", width }: {
  chart: FeedChart[]; banks: FeedAccount[]; out: boolean; ownAccount: string | null; label: string; badge?: ReactNode; disabled?: boolean;
  onPick: (p: Pick) => void; transferOnly?: boolean; placeholder?: string; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const items = useMemo<Item[]>(() => {
    const t: Item[] = banks.filter((b) => b.id !== ownAccount).map((b) => ({ key: `b:${b.id}`, pick: { transfer: b.id }, number: b.number, name: b.label.replace(/^\d+\s/, ""), type: b.type }));
    if (transferOnly) return t;
    return [...t, ...chart.map((c) => ({ key: `c:${c.number}`, pick: { account: c.number }, number: c.number, name: c.name, type: c.type }))];
  }, [chart, banks, ownAccount, transferOnly]);
  const shown = useMemo(() => filterItems(items, q), [items, q]);

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.max(r.width, 380), below = window.innerHeight - r.bottom;
    setPos({ left: Math.min(r.left, window.innerWidth - w - 8), top: below < 300 && r.top > below ? r.top : r.bottom, width: w, up: below < 300 && r.top > below });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !list.current?.contains(t)) setOpen(false); };
    const move = () => place();
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", move, true); window.addEventListener("resize", move);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", move, true); window.removeEventListener("resize", move); };
  }, [open]);
  useEffect(() => { list.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);

  const start = () => { if (disabled) return; setQ(""); setAt(0); setOpen(true); };
  const pick = (i: Item | undefined) => { if (!i) return; setOpen(false); onPick(i.pick); };

  return (
    <div ref={box} className="relative" style={width ? { width } : undefined}>
      {open ? (
        <input ref={input} autoFocus value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} aria-label="Account" placeholder={label || placeholder} role="combobox" aria-expanded="true" aria-controls={listId}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(shown[at]); }
            else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
          }}
          className="h-8 w-full rounded-[6px] border border-navy-600 bg-white px-2 text-[13.5px] outline-none ring-2 ring-navy-100" />
      ) : (
        <button type="button" onClick={start} disabled={disabled} title={label || undefined} aria-label={label ? `Account: ${label}` : "Account"}
          className={`flex h-8 w-full items-center gap-1.5 overflow-hidden rounded-[6px] border px-2 text-left text-[13.5px] ${disabled ? "border-sand-200 bg-sand-50 text-ink-3" : "border-sand-300 bg-white hover:border-navy-400"}`}>
          {badge}
          <span className={`min-w-0 flex-1 truncate ${label ? "" : "text-ink-3"}`}>{label || placeholder}</span>
          {!disabled && <span aria-hidden className="text-[10px] text-ink-3">▾</span>}
        </button>
      )}
      {open && pos && createPortal(
        <div ref={list} id={listId} role="listbox" aria-label="Accounts" style={{ position: "fixed", left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top + 2 } : { top: pos.top + 2 }) }}
          className="z-[80] max-h-[340px] overflow-y-auto rounded-[8px] border border-sand-200 bg-white py-1 text-[13.5px] shadow-[0_12px_32px_rgba(15,35,80,.22)]">
          {shown.length === 0 && <p className="px-3 py-2 text-ink-3">No account matches “{q}”.</p>}
          {shown.map((i, n) => (
            <div key={i.key}>
              {(n === 0 || shown[n - 1].key[0] !== i.key[0]) && (
                <p className="px-3 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-[.06em] text-ink-3 uppercase">{i.key.startsWith("b:") ? (out ? "Transfer to" : "Transfer from") : "Accounts"}</p>)}
              <div role="option" aria-selected={n === at} data-at={n} onMouseEnter={() => setAt(n)} onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                className={`flex cursor-pointer items-baseline gap-3 px-3 py-1.5 ${n === at ? "bg-navy-50" : ""}`}>
                <span className="min-w-0 flex-1"><span className="tabular-nums">{i.number}</span> {i.name}</span>
                <span className="flex-none text-[12px] text-ink-3">{i.type}</span>
              </div>
            </div>
          ))}
        </div>, document.body)}
    </div>
  );
}
