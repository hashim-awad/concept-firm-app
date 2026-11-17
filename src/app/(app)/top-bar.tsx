"use client";
// Round 17 (Hashim, Nov 15, 2026): the top bar on every page, Studio and Closebook alike. Benchmark:
// QuickBooks Online: search on the left; "+ New" (its Create), Help, the gear and the person on the right.
// The gear opens one menu in columns (QuickBooks' company settings, lists, tools; TaxDome keeps templates
// as their own area). Help opens the page's own "?" panel; a page without one gets the SOP links. The
// menus stay in the page and are hidden when closed, so Sign out and every link are there from the start.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, BookCheck, Briefcase, Building2, ChevronDown, FileSignature, HelpCircle, Landmark, LogOut, Menu, Plus, Search, Settings, User, UserPlus } from "lucide-react";
import { ClientSearchDialog, useClientSearch } from "./client-search";
import type { GearColumn } from "./admin/settings-menu";
import { myNotices } from "./closebook/question-actions";

// group: a small label shown above the items that share it (round 19: "New quote" with its three kinds).
export type NewItem = { key: "lead" | "quote_t1" | "quote_corporate" | "proposal" | "letter" | "client" | "file"; label: string; href: string; group?: string };
const NEW_ICON: Record<NewItem["key"], ReactNode> = {
  lead: <UserPlus className="h-4 w-4" />, quote_t1: <User className="h-4 w-4" />, quote_corporate: <Briefcase className="h-4 w-4" />,
  proposal: <Landmark className="h-4 w-4" />, letter: <FileSignature className="h-4 w-4" />,
  client: <Building2 className="h-4 w-4" />, file: <BookCheck className="h-4 w-4" />,
};

// The firm's SOPs in Notion (SOP Library), for pages with no help panel of their own. Firm-wide SOPs only.
export const SOP_LINKS: [string, string][] = [
  ["SOP Library", "https://app.notion.com/p/391ef6ac59e28090ab98f26e5691bfbc"],
  ["2.06 T2 Compilation Year-End Workflow", "https://app.notion.com/p/391ef6ac59e280cc8c00f251271cc5a4"],
  ["2.11 Year-End Compilation and T2 (Non-Recurring Clients)", "https://app.notion.com/p/3a7ef6ac59e281b999eaf2eef7ac187f"],
  ["2.08 TaxDome Account and Folder Standards", "https://app.notion.com/p/391ef6ac59e280e5a12be7493f6ad34d"],
  ["1.11 Month-End Review and Sign-Off", "https://app.notion.com/p/391ef6ac59e28045863af98c6caf1c60"],
];

type Menu = "new" | "help" | "gear" | "me" | "bell" | null;

export function TopBar({ name, role, initials, clients, newItems, gear, drafts, bell = 0, signOut }: {
  name: string; role: string; initials: string; clients: boolean; newItems: NewItem[]; gear: GearColumn[]; drafts: number; bell?: number; signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState<Menu>(null);
  // Round 32: the bell. Opening it reads the person's notices and marks them read.
  const [unread, setUnread] = useState(bell);
  const [seenBell, setSeenBell] = useState(bell);
  if (seenBell !== bell) { setSeenBell(bell); setUnread(bell); }
  const [notices, setNotices] = useState<{ id: string; title: string; href: string; at: string; unread: boolean }[] | null>(null);
  const openBell = async () => {
    toggle("bell");
    if (open === "bell") return;
    const r = await myNotices();
    setNotices(r.ok ? r.list : []);
    setUnread(0);
  };
  const search = useClientSearch(clients);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", key); };
  }, [open]);
  const toggle = (m: Menu) => setOpen(open === m ? null : m);
  // Help: the page's own "?" panel when it has one.
  const help = () => {
    const own = document.querySelector<HTMLElement>("[data-page-help] summary, [data-page-help] button, summary[data-page-help], button[data-page-help]");
    if (own) { setOpen(null); own.click(); return; }
    toggle("help");
  };
  const icon = "relative grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-sand-100 hover:text-ink";
  const panel = "absolute top-12 z-50 rounded-xl border border-sand-300 bg-white shadow-[0_16px_40px_rgba(15,35,80,.2)]";
  return (
    <div ref={ref} className="sticky top-0 z-40 flex h-14 flex-none items-center gap-2 border-b border-sand-200 bg-white px-3 print:hidden md:px-5">
      <button type="button" onClick={() => window.dispatchEvent(new Event("studio:open-menu"))} aria-label="Open menu" className={`${icon} md:hidden`}><Menu className="h-5 w-5" /></button>
      {clients && (
        <button type="button" onClick={() => search.setOpen(true)} aria-label="Find a client"
          className="flex h-9 items-center gap-2 rounded-lg border border-sand-300 px-2.5 text-left text-[13.5px] text-ink-3 hover:border-ink-3 md:w-[360px]">
          <Search className="h-4 w-4 flex-none" aria-hidden /><span className="hidden flex-1 md:inline">Find a client</span>
          <kbd className="hidden rounded border border-sand-300 px-1.5 text-[10.5px] font-semibold text-ink-2 md:inline">Ctrl K</kbd>
        </button>
      )}
      <span className="flex-1" />
      {newItems.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => toggle("new")} aria-expanded={open === "new"} aria-haspopup="menu"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-navy-800 px-3 text-[13.5px] font-bold text-white hover:bg-navy-700"><Plus className="h-4 w-4" aria-hidden />New</button>
          {(
            <div role="menu" hidden={open !== "new"} className={`${panel} right-0 w-60 py-1.5`}>
              {newItems.map((i, n) => (
                <div key={i.key} role="none">
                  {i.group && i.group !== newItems[n - 1]?.group && <p role="presentation" className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">{i.group}</p>}
                  <Link role="menuitem" href={i.href} onClick={() => setOpen(null)} className={`flex items-center gap-2.5 py-2 pr-4 text-[13.5px] hover:bg-navy-50 ${i.group ? "pl-8" : "pl-4"}`}>{NEW_ICON[i.key]}{i.label}</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="relative">
        <button type="button" onClick={openBell} aria-expanded={open === "bell"} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} title="Notifications" className={`${icon} ${open === "bell" ? "bg-navy-50 text-navy-900" : ""}`} data-bell>
          <Bell className="h-[19px] w-[19px]" />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-[#c2410c] px-1.5 text-[10px] leading-4 font-bold text-white" data-bell-count>{unread}</span>}
        </button>
        {open === "bell" && (
          <div className={`${panel} right-0 w-96 py-2`} data-bell-panel>
            <p className="px-4 pb-1.5 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">Notifications</p>
            {notices === null && <p className="px-4 py-2 text-[13px] text-ink-3">Loading…</p>}
            {notices?.length === 0 && <p className="px-4 py-2 text-[13px] text-ink-3">Nothing new.</p>}
            {notices?.map((n) => (
              <Link key={n.id} href={n.href || "#"} onClick={() => setOpen(null)} className="flex gap-2.5 px-4 py-2 hover:bg-navy-50">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${n.unread ? "bg-[#c2410c]" : "bg-transparent"}`} />
                <span className="min-w-0 flex-1"><span className={`block text-[13.5px] ${n.unread ? "font-semibold text-ink" : "text-ink-2"}`}>{n.title}</span>
                  <span className="block text-[12px] text-ink-3">{new Date(n.at).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button type="button" onClick={help} aria-label="Help" title="Help" className={icon}><HelpCircle className="h-[19px] w-[19px]" /></button>
        {open === "help" && (
          <div className={`${panel} right-0 w-80 p-3`}>
            <p className="px-1 pb-2 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">Our SOPs</p>
            {SOP_LINKS.map(([l, h]) => <a key={h} href={h} target="_blank" rel="noreferrer" className="block rounded-md px-2 py-1.5 text-[13px] text-navy-700 hover:bg-navy-50">{l}</a>)}
          </div>
        )}
      </div>
      {gear.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => toggle("gear")} aria-expanded={open === "gear"} aria-label="Settings" title="Settings" className={`${icon} ${open === "gear" ? "bg-navy-50 text-navy-900" : ""}`}>
            <Settings className="h-[19px] w-[19px]" />
            {drafts > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-[#c2410c] px-1.5 text-[10px] leading-4 font-bold text-white" title={`${drafts} template${drafts === 1 ? "" : "s"} to approve`}>{drafts}</span>}
          </button>
          {(
            <nav aria-label="Settings" hidden={open !== "gear"} className={`${panel} -right-2 grid max-w-[calc(100vw-1.5rem)] gap-x-6 gap-y-2 overflow-x-auto p-4`} style={{ gridTemplateColumns: `repeat(${gear.length}, max-content)` }}>
              {gear.map((c) => (
                <div key={c.label}>
                  <p className="px-3 pb-2 text-[11px] font-extrabold tracking-[.1em] text-ink-3 uppercase">{c.label}</p>
                  {c.items.map((i) => (
                    <Link key={i.href} href={i.href} onClick={() => setOpen(null)} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13.5px] whitespace-nowrap hover:bg-navy-50">
                      {i.label}{i.count ? <span className="ml-auto rounded-full bg-warning-soft px-2 text-[11px] font-bold text-warning">{i.count} to approve</span> : null}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          )}
        </div>
      )}
      <div className="relative">
        <button type="button" onClick={() => toggle("me")} aria-expanded={open === "me"} className="flex h-9 items-center gap-2 rounded-lg pr-1.5 pl-1 text-[13.5px] font-semibold hover:bg-sand-100">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-navy-100 text-[11px] font-extrabold text-navy-800">{initials}</span>
          <span className="hidden max-w-40 truncate md:inline">{name}</span><ChevronDown className="h-3.5 w-3.5 text-ink-3" aria-hidden />
        </button>
        {(
          <div hidden={open !== "me"} className={`${panel} right-0 w-56 p-3`}>
            <p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-ink-3">{role}</p>
            <form action={signOut} className="mt-3 border-t border-sand-200 pt-2">
              <button type="submit" className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-[13.5px] hover:bg-sand-100"><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
            </form>
          </div>
        )}
      </div>
      {clients && <ClientSearchDialog open={search.open} onClose={() => search.setOpen(false)} />}
    </div>
  );
}
