"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Pin, PinOff, Search } from "lucide-react";
import { StudioLogo } from "./brand";

// children: sub-items, shown under the item when it is open (its page or one of theirs is showing).
export type NavItem = { href: string; label: string; icon: ReactNode; active?: boolean; badge?: string; soon?: boolean; children?: NavItem[] };
export type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean };
// The pin at the bottom of the menu (TaxDome): pinned keeps the menu open; unpinned folds it to icons.
// locked (round 36): the menu is held folded here; the button says why and does nothing.
export type MenuPin = { pinned: boolean; onToggle: () => void; locked?: string };

const KEY = "studio.sidebar.closed";
// Folded groups, remembered in this browser only. Storage can be blocked: then every group is open.
const listeners = new Set<() => void>();
function readClosed(): string {
  try { return localStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; }
}
function writeClosed(v: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* not saved */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function parse(raw: string): string[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Round 36b (Hashim, Nov 17, 2026; benchmark TaxDome's menu, measured at 100% zoom): Studio's colours,
// TaxDome's spacing and folding.
//   Pinned: 232 px wide; rows 40 px; icon 16 px at 8 px from the left; label 14 px semi-bold at 36 px;
//   counts as a 16 px pill at the right; the selected item a light background, 40 px tall, 8 px corners,
//   inset 2 px left and 9 px right. Sub-items: label at 36 px, a guide line at 16 px, the selected one a
//   3 px bar on that line.
//   Unpinned: 64 px wide, icons centred in the same 40 px rows, "CA" for the logo, the selected icon in a
//   rounded square, the label as a tooltip on hover.
//   One pin button at the bottom: "Unpin menu" / "Pin menu".
export function Sidebar({ groups, footer, user, onSearch, bottom, compact, pin }: { groups: NavGroup[]; footer?: ReactNode; user?: { name: string; role: string }; onSearch?: () => void; bottom?: NavItem; compact?: boolean; pin?: MenuPin }) {
  const closed = parse(useSyncExternalStore(subscribe, readClosed, () => "[]"));
  if (compact) return (
    <aside className="flex h-full w-16 flex-col bg-gradient-to-b from-navy-800 to-navy-950 text-white" aria-label="Main menu" data-menu="unpinned">
      <Link href="/" className="grid h-14 shrink-0 place-items-center text-[17px] font-extrabold tracking-tight" title="Concept Studio" aria-label="Concept Studio">CA</Link>
      {onSearch && <div className="flex justify-center"><IconButton label="Find a client" onClick={onSearch}><Search aria-hidden /></IconButton></div>}
      <nav aria-label="Main" className="sidebar-scroll flex flex-1 flex-col items-center overflow-y-auto pt-1">
        {groups.flatMap((g) => g.items.filter((i) => !i.soon)).map((i) => <IconLink key={i.label} i={i} />)}
      </nav>
      {bottom && <div className="flex justify-center"><IconLink i={bottom} /></div>}
      {footer && <div className="mt-1 flex justify-center [&_button]:text-[0px] [&_svg]:h-4 [&_svg]:w-4" title="Sign out">{footer}</div>}
      {pin && <div className="flex justify-center border-t border-white/10 py-2"><PinButton pin={pin} /></div>}
    </aside>
  );
  const toggle = (label: string) => writeClosed(closed.includes(label) ? closed.filter((x) => x !== label) : [...closed, label]);
  return (
    <aside className="flex h-full w-[232px] flex-col bg-gradient-to-b from-navy-800 to-navy-950 text-white" aria-label="Main menu" data-menu="pinned">
      <div className="px-4 pt-4 pb-3 [@media(max-height:820px)]:pt-3 [@media(max-height:820px)]:pb-2"><StudioLogo tone="white" height={46} /></div>
      {onSearch && (
        <div className="pr-[9px] pb-2 pl-[2px]">
          <button type="button" onClick={onSearch}
            className="flex h-10 w-full items-center gap-3 rounded-lg bg-white/8 pr-2 pl-[6px] text-left text-[13px] text-white/65 hover:bg-white/12 hover:text-white">
            <Search className="h-4 w-4" aria-hidden /><span className="flex-1">Find a client</span>
            <kbd className="rounded bg-white/10 px-1.5 text-[10px] font-semibold">Ctrl K</kbd>
          </button>
        </div>
      )}
      <nav aria-label="Main" className="sidebar-scroll flex-1 space-y-2 overflow-y-auto pr-[9px] pb-3 pl-[2px]">
        {groups.map((g) => {
          const hasActive = g.items.some((i) => i.active || i.children?.some((c) => c.active));
          const allSoon = g.items.every((i) => i.soon);
          const isOpen = !g.collapsible || hasActive || (allSoon ? closed.includes(g.label) : !closed.includes(g.label));
          const total = g.items.reduce((n, i) => n + (Number(i.badge) || 0), 0);
          const id = `nav-${g.label.replace(/\W+/g, "-").toLowerCase()}`;
          return (
            <div key={g.label}>
              {!g.label ? null : g.collapsible ? (
                <button type="button" onClick={() => toggle(g.label)} aria-expanded={isOpen} aria-controls={id} disabled={hasActive}
                  className="flex w-full items-center gap-1 rounded pb-1 pl-[6px] text-left text-[10.5px] font-semibold tracking-wider text-white/45 uppercase hover:text-white/70 disabled:cursor-default disabled:hover:text-white/45">
                  <span className="flex-1">{g.label}</span>
                  {!isOpen && total > 0 && <span className="h-4 rounded-full bg-lime-500 px-1.5 text-[10px] leading-4 text-navy-900">{total}</span>}
                  {!isOpen && allSoon && <span className="text-[9.5px] font-semibold tracking-normal normal-case text-white/40">{g.items.length} soon</span>}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
              ) : <p className="pb-1 pl-[6px] text-[10.5px] font-semibold tracking-wider text-white/45 uppercase">{g.label}</p>}
              {isOpen && (
                <ul id={id}>
                  {g.items.map((i) => (
                    <li key={i.label}>
                      {i.soon ? (
                        <span aria-disabled="true" title="Not built yet"
                          className="flex h-10 cursor-default items-center gap-3 rounded-lg pr-2 pl-[6px] text-[14px] font-semibold text-white/35">
                          <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{i.icon}</span>
                          <span className="flex-1 truncate">{i.label}</span>
                          <span className="shrink-0 rounded border border-white/15 px-1 text-[9.5px] leading-4 font-semibold text-white/45">Soon</span>
                        </span>
                      ) : (
                        <>
                          <NavLink i={i} />
                          {i.children?.length && (i.active || i.children.some((c) => c.active)) ? <SubItems items={i.children} /> : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      {bottom && <div className="border-t border-white/10 pt-2 pr-[9px] pb-2 pl-[2px]"><NavLink i={bottom} /></div>}
      {(user || footer) && (
        <div className="flex items-end justify-between gap-3 border-t border-white/10 px-4 py-3 [@media(max-height:820px)]:py-2">
          {user && (<div className="min-w-0"><p className="truncate text-[13px] font-medium">{user.name}</p><p className="truncate text-xs text-white/60">{user.role}</p></div>)}
          {footer}
        </div>
      )}
      {pin && <div className="border-t border-white/10 py-2 pr-[9px] pl-[2px]"><PinButton pin={pin} wide /></div>}
    </aside>
  );
}

const pill = "grid h-4 min-w-4 place-items-center rounded-full bg-lime-500 px-1.5 text-[10.5px] leading-4 font-semibold text-navy-900";

function NavLink({ i }: { i: NavItem }) {
  const open = !!i.children?.length && (i.active || i.children.some((c) => c.active));
  return (
    <a href={i.href} aria-current={i.active ? "page" : undefined} data-nav-item={i.label}
      className={`flex h-10 items-center gap-3 rounded-lg pr-2 pl-[6px] text-[14px] font-semibold transition-colors ${i.active ? "bg-white/12 text-white" : "text-white/80 hover:bg-white/8 hover:text-white"}`}>
      <span className={`h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4 ${i.active ? "text-lime-400" : ""}`} aria-hidden>{i.icon}</span>
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {i.badge && <span className={pill}>{i.badge}</span>}
      {i.children?.length ? <ChevronDown className={`h-4 w-4 shrink-0 text-white/60 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /> : null}
    </a>
  );
}

// Sub-items: the label at 36 px (as the items above), a thin guide line at 16 px; the selected one a 3 px bar
// on that line and the same light background.
function SubItems({ items }: { items: NavItem[] }) {
  return (
    <ul className="relative" data-nav-sub>
      <span className="absolute top-1 bottom-1 left-[13.5px] w-px bg-white/15" aria-hidden />
      {items.map((c) => (
        <li key={c.label} className="relative">
          {c.active && <span className="absolute top-2 bottom-2 left-[12.5px] z-10 w-[3px] rounded-full bg-lime-400" aria-hidden />}
          <a href={c.href} aria-current={c.active ? "page" : undefined}
            className={`flex h-10 items-center gap-3 rounded-lg pr-2 pl-[34px] text-[14px] font-semibold ${c.active ? "bg-white/12 text-white" : "text-white/75 hover:bg-white/8 hover:text-white"}`}>
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            {c.badge && <span className={pill}>{c.badge}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

// A label shown beside the icon on hover or keyboard focus (the folded menu's tooltip). Placed on the page
// (fixed), so the menu's scrolling list does not cut it off.
export function useTip() {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const show = (e: { currentTarget: HTMLElement }) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ top: r.top + r.height / 2, left: r.right + 6 }); };
  const hide = () => setAt(null);
  return { at, on: { onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide } };
}
export function Tip({ text, at }: { text: string; at: { top: number; left: number } | null }) {
  if (!at) return null;
  return (
    <span role="tooltip" data-menu-tip style={{ position: "fixed", top: at.top, left: at.left }}
      className="pointer-events-none z-[60] -translate-y-1/2 rounded-md bg-navy-950 px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-white shadow-lg ring-1 ring-white/10">
      {text}
    </span>
  );
}

function IconLink({ i }: { i: NavItem }) {
  const tip = useTip();
  return (
    <a href={i.href} aria-current={i.active ? "page" : undefined} aria-label={i.label} data-nav-item={i.label} {...tip.on}
      className="group relative flex h-10 w-16 items-center justify-center">
      <span className={`grid h-9 w-10 place-items-center rounded-lg ${i.active ? "bg-white/12 text-lime-400" : "text-white/75 group-hover:bg-white/8 group-hover:text-white"}`}>
        <span className="block h-4 w-4 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{i.icon}</span>
      </span>
      {i.badge && <span className={`absolute top-0.5 right-2.5 ${pill} px-1 text-[9.5px]`}>{i.badge}</span>}
      <Tip text={i.label} at={tip.at} />
    </a>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  const tip = useTip();
  return (
    <button type="button" onClick={onClick} aria-label={label} {...tip.on} className="group relative flex h-10 w-16 items-center justify-center text-white/70 hover:text-white">
      <span className="grid h-9 w-10 place-items-center rounded-lg group-hover:bg-white/8 [&_svg]:h-4 [&_svg]:w-4">{children}</span>
      <Tip text={label} at={tip.at} />
    </button>
  );
}

// TaxDome's pin: pinned shows the pin, and "Unpin menu" on hover; unpinned shows the crossed pin, and "Pin menu".
export function PinButton({ pin, wide, tone = "dark", what = "menu" }: { pin: MenuPin; wide?: boolean; tone?: "dark" | "light"; what?: string }) {
  const tip = useTip();
  const label = pin.locked ?? (pin.pinned ? `Unpin ${what}` : `Pin ${what}`);
  const Icon = pin.pinned ? Pin : PinOff;
  const c = tone === "dark" ? "text-white/70 hover:bg-white/8 hover:text-white" : "text-ink-3 hover:bg-sand-100 hover:text-ink";
  if (wide) return (
    <button type="button" onClick={pin.onToggle} aria-label={label} aria-pressed={pin.pinned} data-menu-pin={pin.pinned ? "pinned" : "unpinned"}
      className={`group flex h-10 w-full items-center gap-3 rounded-lg pr-2 pl-[6px] text-[14px] font-semibold ${c}`}>
      <Icon className="h-4 w-4 shrink-0 -rotate-45" aria-hidden />
      <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label}</span>
    </button>
  );
  return (
    <button type="button" onClick={pin.locked ? undefined : pin.onToggle} aria-label={label} aria-pressed={pin.pinned} aria-disabled={pin.locked ? true : undefined}
      data-menu-pin={pin.locked ? "locked" : pin.pinned ? "pinned" : "unpinned"} {...tip.on}
      className={`group relative grid h-10 w-10 place-items-center rounded-lg ${pin.locked ? "cursor-default text-white/40" : c}`}>
      <Icon className="h-4 w-4 -rotate-45" aria-hidden />
      <Tip text={label} at={tip.at} />
    </button>
  );
}
