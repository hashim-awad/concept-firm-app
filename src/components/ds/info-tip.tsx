"use client";
// Round 16 (Hashim; CaseWare Cloud's info icon): secondary explanation sits behind a small "i" in a circle.
// It opens on hover, on click or tap, and from the keyboard (focus, Enter or Space; Escape closes). Only
// text the user must act on stays on the face of the screen; the amber warning icon is for those.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function InfoTip({ children, label = "More detail", align = "left", className = "" }: {
  children: ReactNode; label?: string; align?: "left" | "right"; className?: string;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const open = hover || pinned;
  useEffect(() => {
    if (!pinned) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(false); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", key); };
  }, [pinned]);
  return (
    <span ref={ref} className={`relative inline-flex align-middle ${className}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setPinned(!pinned)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        onKeyDown={(e) => { if (e.key === "Escape") { setPinned(false); setHover(false); } }}
        className="ml-1 grid h-[15px] w-[15px] flex-none place-items-center rounded-full border-[1.3px] border-ink-3 text-[9.5px] leading-none font-bold text-ink-3 italic hover:border-navy-700 hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-navy-700">i</button>
      {open && (
        <span id={id} role="tooltip" className={`absolute top-5 z-50 w-72 rounded-lg border border-sand-300 bg-white px-3 py-2 text-left text-[12.5px] leading-snug font-normal tracking-normal text-ink-2 normal-case shadow-[0_10px_28px_rgba(15,35,80,.18)] ${align === "right" ? "right-0" : "left-0"}`}>{children}</span>
      )}
    </span>
  );
}
