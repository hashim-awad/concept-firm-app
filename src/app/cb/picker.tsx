"use client";
// CB2-1 Part 3b: every account dropdown in Closebook. Type to search by number or name, sorted by number, full names never
// cut off (the list grows to fit and wraps a long name). Also used for GIFI lines and tax codes.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type PickOpt = { value: string; label: string; hint?: string; sort?: string };

export function Picker({ value, options, onChange, placeholder = "Choose", name, ariaLabel, compact, allowEmpty, emptyLabel = "None", invalid }: {
  value: string; options: PickOpt[]; onChange: (v: string) => void; placeholder?: string; name?: string; ariaLabel: string; compact?: boolean;
  allowEmpty?: boolean; emptyLabel?: string; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sorted = useMemo(() => [...options].sort((a, b) => (a.sort ?? a.label).localeCompare(b.sort ?? b.label, "en", { numeric: true })), [options]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = t ? sorted.filter((o) => o.label.toLowerCase().includes(t) || (o.hint ?? "").toLowerCase().includes(t)) : sorted;
    return allowEmpty ? [{ value: "", label: emptyLabel }, ...l] : l;
  }, [q, sorted, allowEmpty, emptyLabel]);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  const h = compact ? "h-8 text-[13px]" : "h-10 text-[14px]";
  return (
    <div ref={ref} className="relative w-full">
      {name && <input type="hidden" name={name} value={value} />}
      {open ? (
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} aria-label={ariaLabel} role="combobox" aria-expanded aria-controls={listId}
          placeholder={current?.label ?? placeholder}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) pick(shown[hi].value); }
            else if (e.key === "Escape" || e.key === "Tab") { setOpen(false); setQ(""); }
          }}
          className={`w-full rounded-md border border-navy-500 bg-white px-2.5 ${h} outline-none ring-2 ring-navy-100`} />
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={ariaLabel} data-picker
          className={`flex w-full items-center gap-1 rounded-md border bg-white px-2.5 text-left ${h} ${invalid ? "border-danger" : "border-sand-200"} hover:border-navy-500`}>
          <span className={`min-w-0 flex-1 truncate ${current ? "" : "text-ink-3"}`} title={current?.label}>{current?.label ?? (value ? value : placeholder)}</span>
          <ChevronDown className="h-4 w-4 flex-none text-ink-3" />
        </button>
      )}
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 top-full z-50 mt-1 max-h-72 min-w-full w-max max-w-[min(36rem,92vw)] overflow-y-auto rounded-md border border-sand-200 bg-white py-1 shadow-xl">
          {shown.map((o, i) => (
            <li key={o.value || "_none"} role="option" aria-selected={o.value === value}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)} onMouseEnter={() => setHi(i)}
                className={`block w-full whitespace-normal px-3 py-1.5 text-left text-[13px] ${i === hi ? "bg-navy-50" : ""} ${o.value === value ? "font-semibold" : ""}`}>
                {o.label}{o.hint && <span className="ml-2 text-[11.5px] text-ink-3">{o.hint}</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-1.5 text-[13px] text-ink-3">Nothing matches.</li>}
        </ul>
      )}
    </div>
  );
}
