"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { StudioLogo } from "./brand";

export type NavItem = { href: string; label: string; icon: ReactNode; active?: boolean; badge?: string; soon?: boolean };
export type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean };

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

// Staff sidebar: navy, grouped sections that fold away (remembered per browser). Active item:
// navy-tint highlight with a green marker. Pages not built yet show greyed out with "Soon" and
// are not links. A folded group shows the total of its badges. A group whose pages are all "Soon"
// starts folded, so the menu fits a laptop screen without scrolling (batch section 13); for those
// groups the stored list means "unfolded" instead of "folded".
export function Sidebar({ groups, footer, user, onSearch, bottom, compact }: { groups: NavGroup[]; footer?: ReactNode; user?: { name: string; role: string }; onSearch?: () => void; bottom?: NavItem; compact?: boolean }) {
  const closed = parse(useSyncExternalStore(subscribe, readClosed, () => "[]"));
  // Round 15 (CaseWare Cloud): inside a Closebook file the menu folds to its icons, so the file gets the
  // width. Every item stays one click away; its name shows on hover.
  if (compact) return (
    <aside className="flex h-full w-14 flex-col items-center bg-gradient-to-b from-navy-800 to-navy-950 py-3 text-white" aria-label="Main menu">
      <Link href="/" className="mb-3 text-lg font-extrabold leading-none" title="Concept Studio">C</Link>
      {onSearch && <button type="button" onClick={onSearch} title="Find a client" aria-label="Find a client" className="mb-1 rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"><Search className="h-[18px] w-[18px]" aria-hidden /></button>}
      <nav aria-label="Main" className="sidebar-scroll flex flex-1 flex-col items-center gap-0.5 overflow-y-auto">
        {groups.flatMap((g) => g.items.filter((i) => !i.soon)).map((i) => <IconLink key={i.label} i={i} />)}
      </nav>
      {bottom && <IconLink i={bottom} />}
      {footer && <div className="mt-1 [&_button]:text-[0px] [&_svg]:h-4 [&_svg]:w-4" title="Sign out">{footer}</div>}
    </aside>
  );
  const toggle = (label: string) => writeClosed(closed.includes(label) ? closed.filter((x) => x !== label) : [...closed, label]);
  return (
    <aside className="flex h-full w-60 flex-col bg-gradient-to-b from-navy-800 to-navy-950 text-white">
      <div className="px-5 pt-4 pb-3 [@media(max-height:820px)]:pt-3 [@media(max-height:820px)]:pb-2"><StudioLogo tone="white" height={46} /></div>
      {onSearch && (
        <div className="px-2.5 pb-2">
          <button type="button" onClick={onSearch}
            className="flex w-full items-center gap-2 rounded-md bg-white/8 px-3 py-[6px] text-left text-[13px] text-white/65 hover:bg-white/12 hover:text-white">
            <Search className="h-4 w-4" aria-hidden /><span className="flex-1">Find a client</span>
            <kbd className="rounded bg-white/10 px-1.5 text-[10px] font-semibold">Ctrl K</kbd>
          </button>
        </div>
      )}
      <nav aria-label="Main" className="sidebar-scroll flex-1 space-y-2 overflow-y-auto px-2.5 pb-3 [@media(max-height:820px)]:space-y-1">
        {groups.map((g) => {
          const hasActive = g.items.some((i) => i.active);
          const allSoon = g.items.every((i) => i.soon);
          const isOpen = !g.collapsible || hasActive || (allSoon ? closed.includes(g.label) : !closed.includes(g.label));
          const total = g.items.reduce((n, i) => n + (Number(i.badge) || 0), 0);
          const id = `nav-${g.label.replace(/\W+/g, "-").toLowerCase()}`;
          return (
            <div key={g.label}>
              {g.collapsible ? (
                <button type="button" onClick={() => toggle(g.label)} aria-expanded={isOpen} aria-controls={id} disabled={hasActive}
                  className="flex w-full items-center gap-1 rounded px-3 pb-1 text-left text-[10.5px] font-semibold tracking-wider text-white/45 uppercase hover:text-white/70 disabled:cursor-default disabled:hover:text-white/45">
                  <span className="flex-1">{g.label}</span>
                  {!isOpen && total > 0 && <span className="rounded bg-lime-500 px-1.5 text-[10px] text-navy-900">{total}</span>}
                  {!isOpen && allSoon && <span className="text-[9.5px] font-semibold tracking-normal normal-case text-white/40">{g.items.length} soon</span>}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
              ) : <p className="px-3 pb-1 text-[10.5px] font-semibold tracking-wider text-white/45 uppercase">{g.label}</p>}
              {isOpen && (
                <ul id={id} className="space-y-px">
                  {g.items.map((i) => (
                    <li key={i.label}>
                      {i.soon ? (
                        <span aria-disabled="true" title="Not built yet"
                          className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-[6px] text-[13.5px] font-medium text-white/35 [@media(max-height:820px)]:py-[3px] [@media(max-height:820px)]:text-[13px]">
                          <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{i.icon}</span>
                          <span className="flex-1 leading-tight">{i.label}</span>
                          <span className="shrink-0 rounded border border-white/15 px-1 text-[9.5px] leading-4 font-semibold text-white/45">Soon</span>
                        </span>
                      ) : (
                        <NavLink i={i} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      {bottom && <div className="border-t border-white/10 px-2.5 py-2"><NavLink i={bottom} /></div>}
      {(user || footer) && (
        <div className="flex items-end justify-between gap-3 border-t border-white/10 px-5 py-3 [@media(max-height:820px)]:py-2">
          {user && (<div className="min-w-0"><p className="truncate text-[13px] font-medium">{user.name}</p><p className="truncate text-xs text-white/60">{user.role}</p></div>)}
          {footer}
        </div>
      )}
    </aside>
  );
}

function NavLink({ i }: { i: NavItem }) {
  return (
    <a href={i.href} aria-current={i.active ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-md px-3 py-[6px] text-[13.5px] [@media(max-height:820px)]:py-[3px] [@media(max-height:820px)]:text-[13px] font-medium transition-colors ${i.active ? "bg-white/12 text-white" : "text-white/80 hover:bg-white/8 hover:text-white"}`}>
      {i.active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-lime-500" aria-hidden />}
      <span className={`h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4 ${i.active ? "text-lime-400" : ""}`} aria-hidden>{i.icon}</span>
      <span className="flex-1 leading-tight">{i.label}</span>
      {i.badge && <span className="rounded bg-lime-500 px-1.5 py-0.5 text-[10px] font-semibold text-navy-900">{i.badge}</span>}
    </a>
  );
}

function IconLink({ i }: { i: NavItem }) {
  return (
    <a href={i.href} aria-current={i.active ? "page" : undefined} title={i.label} aria-label={i.label}
      className={`relative rounded-md p-2 ${i.active ? "bg-white/12 text-lime-400" : "text-white/75 hover:bg-white/8 hover:text-white"}`}>
      <span className="block h-[18px] w-[18px] [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden>{i.icon}</span>
      {i.badge && <span className="absolute -top-0.5 -right-0.5 rounded bg-lime-500 px-1 text-[9px] font-semibold text-navy-900">{i.badge}</span>}
    </a>
  );
}
