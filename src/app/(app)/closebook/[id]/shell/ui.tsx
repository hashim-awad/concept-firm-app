"use client";
// Round 15 (CaseWare Cloud): the small pieces the file screens share. A popover and a side drawer built
// on <details>, so their forms are in the page from the start and work without waiting for scripts;
// a click outside or Escape closes them. A toast for "Saved" and refusals that never covers a control.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { notify } from "@/components/save-state";

function useCloseOnOutside(ref: React.RefObject<HTMLDetailsElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const d = ref.current;
    if (!d) return;
    const onDoc = (e: MouseEvent) => { if (d.open && !d.contains(e.target as Node)) d.open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && d.open) d.open = false; };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [ref, enabled]);
}

// A button that opens a small card under it (or beside it: side="right"). Round 21 (Hashim; CaseWare
// Cloud's sign-off box): the card floats above the page in fixed position, placed from the button, so a
// scrolling column (the step list) never clips it or scrolls sideways. Before scripts load it opens in
// place, as before.
const WIDTHS: Record<string, number> = { "w-56": 224, "w-64": 256, "w-72": 288, "w-80": 320 };
export function Popover({ button, label, children, align = "left", width = "w-72", className = "", open, side = "below" }: {
  button: ReactNode; label: string; children: ReactNode; align?: "left" | "right"; width?: string; className?: string; open?: boolean; side?: "below" | "right";
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useCloseOnOutside(ref);
  const place = useCallback((opening = false) => {
    const d = ref.current, sum = d?.querySelector("summary");
    if (!d || !sum || (!opening && !d.open)) return;
    const r = sum.getBoundingClientRect(), m = 8, vw = window.innerWidth, vh = window.innerHeight;
    const w = card.current?.offsetWidth || WIDTHS[width] || 288, h = card.current?.offsetHeight || 0;
    let left: number, top: number;
    if (side === "right") {
      left = r.right + m; top = r.top - 6;
      if (left + w > vw - m) left = r.left - w - m;
    } else {
      top = r.bottom + m; left = align === "right" ? r.right - w : r.left;
      if (h && top + h > vh - m && r.top - h - m > m) top = r.top - h - m;
    }
    left = Math.max(m, Math.min(left, vw - w - m));
    if (h) top = Math.max(m, Math.min(top, vh - h - m));
    setPos({ top, left });
  }, [align, side, width]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const again = () => place();
    const onToggle = () => { if (d.open) place(); };
    d.addEventListener("toggle", onToggle);
    window.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    if (d.open) place();
    return () => { d.removeEventListener("toggle", onToggle); window.removeEventListener("scroll", again, true); window.removeEventListener("resize", again); };
  }, [place]);
  return (
    <details ref={ref} open={open} className={`relative ${className}`}>
      <summary aria-label={label} title={label} onClick={() => { if (!ref.current?.open) place(true); }} className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">{button}</summary>
      {/* Round 21: a sign-off (or any form) inside closes the box, so it never stays open over the next step. */}
      <div ref={card} style={pos ? { top: pos.top, left: pos.left } : undefined} onSubmitCapture={() => setTimeout(() => { if (ref.current) ref.current.open = false; }, 0)}
        className={`${pos ? "fixed" : `absolute mt-2 ${align === "right" ? "right-0" : "left-0"}`} z-50 ${width} max-w-[calc(100vw-16px)] rounded-lg border border-sand-300 bg-white p-3 text-sm text-ink shadow-[0_10px_28px_rgba(15,35,80,.18)]`}>{children}</div>
    </details>
  );
}

// A panel on the right, under the file's header and tabs, opened from an icon or chip in the title row.
export function Drawer({ button, label, title, children, open: startOpen, top = "top-[146px]" }: { button: ReactNode; label: string; title: ReactNode; children: ReactNode; open?: boolean; top?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && d.open) d.open = false; };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <details ref={ref} open={startOpen} className="cb-drawer group">
      <summary aria-label={label} title={label} className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">{button}</summary>
      <aside className={`fixed ${top} right-0 bottom-0 z-30 flex w-[420px] max-w-full flex-col border-l border-sand-300 bg-white shadow-[-8px_0_24px_rgba(15,35,80,.10)]`}>
        <div className="flex items-center gap-2 border-b border-sand-200 px-4 py-3">
          <span className="flex-1 text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase">{title}</span>
          <button type="button" aria-label="Close" onClick={() => { if (ref.current) ref.current.open = false; }} className="rounded p-1 text-ink-2 hover:bg-sand-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">{children}</div>
      </aside>
    </details>
  );
}

// A refusal stays until closed; it sits in the tabs bar, so it never covers a control. Round 21 (Hashim;
// Dext): "Saved" and other messages are the short note in the bottom-left corner (notify). The message
// leaves the address once shown, so Back does not show it again.
export function FileToast({ msg, error }: { msg?: string | null; error?: string | null }) {
  const key = `${msg ?? ""}|${error ?? ""}`;
  const [closed, setClosed] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const path = usePathname(), sp = useSearchParams();
  useEffect(() => {
    if (!msg && !error) return;
    const q = new URLSearchParams(sp.toString());
    q.delete("msg"); q.delete("error");
    window.history.replaceState(null, "", `${path}${q.toString() ? `?${q}` : ""}${window.location.hash}`);
    if (msg && !error && shown.current !== key) { shown.current = key; notify(msg); }
  }, [msg, error, key, path, sp]);
  if (!error || closed === key) return null;
  return (
    <div role="alert" className="ml-auto flex max-w-[52%] items-center gap-2 self-center rounded-md bg-danger-soft px-3 py-1.5 text-[12.5px] font-medium text-danger">
      <span className="min-w-0 truncate" title={error}>{error}</span>
      <button type="button" aria-label="Close" onClick={() => setClosed(key)} className="rounded p-0.5 opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// The fold is kept in this browser; read through a store so the server render and the first paint agree.
const foldSubs = new Set<() => void>();
let foldMem = false;
const readFold = () => { try { return localStorage.getItem("cb.left.folded") === "1"; } catch { return foldMem; } };

// The left panel folds to numbers (steps) or away (other tabs); remembered in this browser.
export function LeftPanel({ children, folded: foldedNode }: { children: ReactNode; folded?: ReactNode }) {
  const folded = useSyncExternalStore((cb) => { foldSubs.add(cb); return () => { foldSubs.delete(cb); }; }, readFold, () => false);
  const toggle = () => { foldMem = !folded; try { localStorage.setItem("cb.left.folded", foldMem ? "1" : "0"); } catch { /* kept for this page only */ } foldSubs.forEach((f) => f()); };
  return (
    <aside className={`sticky top-[146px] flex h-[calc(100vh-146px)] flex-none print:hidden flex-col border-r border-sand-200 bg-white ${folded ? "w-[52px]" : "w-[236px]"}`}>
      <div className="flex-1 overflow-x-hidden overflow-y-auto py-2">{folded ? foldedNode ?? null : children}</div>
      <button type="button" onClick={toggle} className="flex items-center gap-1.5 border-t border-sand-200 px-4 py-2 text-xs text-ink-3 hover:text-ink" aria-label={folded ? "Open the panel" : "Fold the panel"}>
        {folded ? "›" : "‹ Fold"}
      </button>
    </aside>
  );
}
