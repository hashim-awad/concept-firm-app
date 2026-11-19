"use client";
// Round 15 (CaseWare Cloud): the small pieces the file screens share. A popover and a side drawer built
// on <details>, so their forms are in the page from the start and work without waiting for scripts;
// a click outside or Escape closes them. A toast for "Saved" and refusals that never covers a control.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { notify } from "@/components/save-state";
import Link from "next/link";
import { PinButton, Tip, useTip } from "@/components/ds/sidebar";
import { setMenuPin } from "../../../menu-actions";

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
export function FileToast({ msg, error, info }: { msg?: string | null; error?: string | null; info?: { id: string; text: string } | null }) {
  const key = `${msg ?? ""}|${error ?? ""}`;
  const [closed, setClosed] = useState<string | null>(null);
  // Round 34: "3.3 sign-off removed: <reason>" (from History), once per removal in this browser tab.
  const [infoSeen, setInfoSeen] = useState<string | null>(null);
  useEffect(() => {
    if (!info) return;
    let seen = false;
    try { seen = sessionStorage.getItem(`cb.signoff.${info.id}`) === "1"; sessionStorage.setItem(`cb.signoff.${info.id}`, "1"); } catch { /* storage off: show it */ }
    if (seen) setInfoSeen(info.id); // eslint-disable-line react-hooks/set-state-in-effect
  }, [info]);
  const shown = useRef<string | null>(null);
  const path = usePathname(), sp = useSearchParams();
  useEffect(() => {
    if (!msg && !error) return;
    const q = new URLSearchParams(sp.toString());
    q.delete("msg"); q.delete("error");
    window.history.replaceState(null, "", `${path}${q.toString() ? `?${q}` : ""}${window.location.hash}`);
    if (msg && !error && shown.current !== key) { shown.current = key; notify(msg); }
  }, [msg, error, key, path, sp]);
  if (info && infoSeen !== info.id && closed !== `info:${info.id}` && !error) return (
    <div role="status" data-signoff-pill className="ml-auto flex max-w-[52%] items-center gap-2 self-center rounded-md bg-navy-50 px-3 py-1.5 text-[12.5px] font-medium text-navy-900">
      <span className="min-w-0 truncate" title={info.text}>{info.text}</span>
      <button type="button" aria-label="Close" onClick={() => setClosed(`info:${info.id}`)} className="rounded p-0.5 opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
  if (!error || closed === key) return null;
  return (
    <div role="alert" className="ml-auto flex max-w-[52%] items-center gap-2 self-center rounded-md bg-danger-soft px-3 py-1.5 text-[12.5px] font-medium text-danger">
      <span className="min-w-0 truncate" title={error}>{error}</span>
      <button type="button" aria-label="Close" onClick={() => setClosed(key)} className="rounded p-0.5 opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// Round 36b: a step in the folded panel; its name shows beside it on hover, as in the folded main menu.
export function TipLink({ href, label, className, children }: { href: string; label: string; className: string; children: ReactNode }) {
  const tip = useTip();
  return <Link href={href} aria-label={label} className={className} {...tip.on}>{children}<Tip text={label} at={tip.at} /></Link>;
}

// Round 36b (TaxDome): the left panel has the same pin as the main menu. Pinned: open. Unpinned: a narrow
// column (the steps' status circles, each name on hover) or nothing (other tabs). The choice is the
// person's, kept across files, pages and sign-ins; it is shared by every page of a file through this store.
const pinSubs = new Set<() => void>();
let pinMem: boolean | null = null;
// Piece R2 (item 1): forceFolded keeps the narrow column on a page that needs the full width (step 4 "Assign mapping" on a trial
// balance file). The person's saved pin is not changed; the pin button says why it does nothing there (round 36b item 6).
export function LeftPanel({ children, folded: foldedNode, pinned: saved = true, forceFolded = false }: { children: ReactNode; folded?: ReactNode; pinned?: boolean; forceFolded?: boolean }) {
  const stored = useSyncExternalStore((cb) => { pinSubs.add(cb); return () => { pinSubs.delete(cb); }; }, () => pinMem ?? saved, () => saved);
  const pinned = stored && !forceFolded;
  const toggle = () => {
    pinMem = !pinned; pinSubs.forEach((f) => f());
    void setMenuPin("steps", pinMem).then((r) => { if (!r.ok) notify(r.error, "error"); });
  };
  return (
    <aside className={`sticky top-[146px] flex h-[calc(100vh-146px)] flex-none print:hidden flex-col border-r border-sand-200 bg-white ${pinned ? "w-[236px]" : "w-14"}`} data-steps-panel={pinned ? "pinned" : "unpinned"}>
      <div className="flex-1 overflow-x-hidden overflow-y-auto py-2">{pinned ? children : foldedNode ?? null}</div>
      <div className={`flex border-t border-sand-200 py-2 ${pinned ? "px-1.5" : "justify-center"}`}>
        {/* On a page that needs the full width (step 4 on a trial balance file) the pin is left out: it would do nothing. */}
        {forceFolded ? null : <PinButton pin={{ pinned, onToggle: toggle }} wide={pinned} tone="light" what="panel" />}
      </div>
    </aside>
  );
}

// Round 38b (Hashim, Nov 18, 2026; benchmark QuickBooks Online Accountant's "Accountant tools" menu): "Tools ▾" in the
// file tabs. A menu, not a page: it opens on a click (or Enter / Space), closes on a choice, Escape or a click outside;
// the arrow keys move between items. One item per tool. "New journal entry" opens the journal window over the page the
// person is on (the window saves back to that page); "Reclassify transactions" opens its page.
export function ToolsMenu({ fileId, on, journal }: { fileId: string; on: boolean; journal: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  const pathname = usePathname(), params = useSearchParams();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  // The page as it is now, without a dialog or message already in its address, plus the journal window.
  const keep = new URLSearchParams([...params.entries()].filter(([k]) => !["new", "open", "edit", "acct", "msg", "error"].includes(k)));
  keep.set("new", "journal");
  // Piece R1: "Match accounts to GIFI" is no longer here (step 8's first paper). Reclassify carries back= to this page.
  const here = new URLSearchParams([...params.entries()].filter(([k]) => !["new", "open", "edit", "acct", "msg", "error", "back"].includes(k)));
  const items: { label: string; href: string }[] = [
    ...(journal ? [{ label: "New journal entry", href: `${pathname}?${keep}` }] : []),
    { label: "Reclassify transactions", href: `/closebook/${fileId}?area=tb&tool=reclassify${params.get("tool") ? "" : `&back=${encodeURIComponent(`${pathname}?${here}`)}`}` },
  ];
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === "ArrowDown" ? 1 : els.length - 1)) % els.length]?.focus();
  };
  return (
    <div ref={box} className="relative flex" onKeyDown={move} data-tools-menu>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-current={on ? "page" : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); setTimeout(() => box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(), 0); } }}
        className={`flex items-center gap-1 border-b-2 px-3 text-[13px] font-semibold ${on ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>
        Tools<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <ul role="menu" aria-label="Tools" className="absolute top-full left-0 z-50 mt-1 w-60 rounded-[8px] border border-sand-200 bg-white py-1 shadow-[0_12px_32px_rgba(15,35,80,.18)]">
          {items.map((it) => (
            <li key={it.label} role="none"><Link role="menuitem" href={it.href} scroll={false} onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-[13px] text-ink hover:bg-navy-50 focus:bg-navy-50 focus:outline-none">{it.label}</Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
