"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ellipsis } from "lucide-react";

export type MenuItem = { label: string; href: string; external?: boolean };

// Round 18: each client row ends with a "..." menu (like QuickBooks Online's action column). The menu is
// fixed to the window, so the table's scroll box never clips it.
export function RowMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => { const r = button.current!.getBoundingClientRect(); setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", key); };
  }, [open]);
  const cls = "block rounded px-3 py-1.5 text-left text-sm whitespace-nowrap text-ink hover:bg-sand-100 focus-visible:bg-sand-100 focus-visible:outline-none";
  return (
    <span ref={ref} className="inline-flex">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${name}`} onClick={() => setOpen(!open)}
        className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-sand-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-navy-700">
        <Ellipsis className="h-4.5 w-4.5" aria-hidden />
      </button>
      {open && (
        <span role="menu" style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }} className="card fixed z-40 grid min-w-[11rem] gap-0.5 p-1.5">
          {items.map((i) => i.external
            ? <a key={i.label} role="menuitem" href={i.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={cls}>{i.label}</a>
            : <Link key={i.label} role="menuitem" href={i.href} onClick={() => setOpen(false)} className={cls}>{i.label}</Link>)}
        </span>
      )}
    </span>
  );
}
