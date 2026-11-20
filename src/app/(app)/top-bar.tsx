"use client";
// Piece UI1 (Hashim, Nov 19 to 20, 2026; D1, P2, Q8): the navy top bar replaces the left menu. Six items (My day, Clients,
// Closebook, Engagements, Documents, Sales with Leads and Quotes), then Find a client (a button below 1366 px), the bell,
// Help, the gear, + New and the person. Below 1120 px wide the items and Help move into the Menu panel, so the bar never
// cuts off. Counts: Sales = website leads with status New; Engagements = letters waiting for signature (opens Letters);
// quotes waiting for signature show beside Quotes in the Sales menu.
// Round 17 (Hashim, Nov 15, 2026): the top bar on every page, Studio and Closebook alike. Benchmark:
// QuickBooks Online: search on the left; "+ New" (its Create), Help, the gear and the person on the right.
// The gear opens one menu in columns (QuickBooks' company settings, lists, tools; TaxDome keeps templates
// as their own area). Help opens the page's own "?" panel; a page without one gets the SOP links. The
// menus stay in the page and are hidden when closed, so Sign out and every link are there from the start.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StudioLogo, StudioMark } from "@/components/ds/brand";
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

type Menu = "new" | "help" | "gear" | "me" | "bell" | "sales" | "panel" | null;

export type NavAccess = { leads: boolean; clients: boolean; closebook: boolean; engagements: boolean; documents: boolean };
export type NavCounts = { leadsNew: number; lettersWaiting: number; quotesWaiting: number };
// Which item a page belongs to (pages keep their addresses).
const OWNER: [string, string][] = [
  ["/leads", "sales"], ["/quotes", "sales"], ["/documents/proposal", "sales"], ["/proposals", "sales"],
  ["/documents/corporate-letter", "engagements"], ["/documents/t1-letter", "engagements"], ["/engagement-letters", "engagements"],
  ["/documents/engagements", "engagements"], ["/engagements", "engagements"],
  ["/clients", "clients"], ["/closebook", "closebook"], ["/statements", "closebook"], ["/documents", "documents"], ["/admin", "gear"],
];
export function navOwner(path: string): string {
  if (path === "/") return "myday";
  return OWNER.find(([p]) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"))?.[1] ?? "";
}

export function TopBar({ name, role, initials, clients, newItems, gear, drafts, bell = 0, signOut, nav, counts }: {
  name: string; role: string; initials: string; clients: boolean; newItems: NewItem[]; gear: GearColumn[]; drafts: number; bell?: number; signOut: () => Promise<void>;
  nav: NavAccess; counts: NavCounts;
}) {
  const path = usePathname();
  const owner = navOwner(path);
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
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    // Escape closes the menu and puts focus back on the button that opened it (ui-reviewer finding 12).
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); opener.current?.focus(); } };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", key); };
  }, [open]);
  const toggle = (m: Menu) => { if (open !== m) opener.current = document.activeElement as HTMLElement | null; setOpen(open === m ? null : m); };
  // Help: the page's own "?" panel when it has one.
  const help = () => {
    const own = document.querySelector<HTMLElement>("[data-page-help] summary, [data-page-help] button, summary[data-page-help], button[data-page-help]");
    if (own) { setOpen(null); own.click(); return; }
    toggle("help");
  };
  const icon = "relative grid h-9 w-9 place-items-center text-white hover:bg-white/10";
  const panel = "absolute top-[52px] z-50 border border-sand-300 bg-white text-ink shadow-[0_16px_40px_rgba(1,33,105,.2)]";
  const count = "grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white px-1 text-[10.5px] font-bold text-navy-700";
  const item = (key: string) => `flex h-14 items-center gap-2 border-b-[3px] px-3 text-[14px] font-medium whitespace-nowrap ${owner === key ? "border-lime-500 bg-navy-600 text-white" : "border-transparent text-[#DDE4F2] hover:text-white"}`;
  const lettersHref = counts.lettersWaiting > 0 ? "/engagements?tab=letters" : "/engagements";
  // The six items, in order (D1). Each shows only with the person's permission; the database checks again.
  const links: { key: string; label: string; href: string; badge?: number; badgeLabel?: string }[] = [
    { key: "myday", label: "My day", href: "/" },
    ...(nav.clients ? [{ key: "clients", label: "Clients", href: "/clients" }] : []),
    ...(nav.closebook ? [{ key: "closebook", label: "Closebook", href: "/closebook" }] : []),
    ...(nav.engagements ? [{ key: "engagements", label: "Engagements", href: lettersHref, badge: counts.lettersWaiting, badgeLabel: "letters waiting for signature" }] : []),
    ...(nav.documents ? [{ key: "documents", label: "Documents", href: "/documents" }] : []),
  ];
  const salesItems = [
    { label: "Leads", href: "/leads", note: counts.leadsNew ? `${counts.leadsNew} new` : "" },
    { label: "Quotes", href: "/quotes", note: counts.quotesWaiting ? `${counts.quotesWaiting} waiting` : "" },
  ];
  return (
    <header ref={ref} data-bar onBlur={(e) => { if (open && !ref.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(null); }} className="sticky top-0 z-40 flex h-14 flex-none items-center gap-1 bg-navy-700 px-3 text-white print:hidden md:px-4">
      {/* Below 1120 px: the Menu panel holds the six items and Help. */}
      <div className="relative min-[1120px]:hidden">
        <button type="button" onClick={() => toggle("panel")} aria-expanded={open === "panel"} aria-label="Menu" className={icon}><Menu className="h-5 w-5" /></button>
        <nav aria-label="Main" hidden={open !== "panel"} className={`${panel} left-0 w-72 py-1.5`}>
          {links.map((l) => (
            <Link key={l.key} href={l.href} onClick={() => setOpen(null)} aria-current={owner === l.key ? "page" : undefined}
              className={`flex items-center justify-between px-4 py-2.5 text-[14px] hover:bg-navy-50 ${owner === l.key ? "bg-navy-50 font-semibold" : ""}`}>
              {l.label}{l.badge ? <span className="text-[12px] text-ink-2">{l.badge}</span> : null}
            </Link>
          ))}
          {nav.leads && <>
            <p className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">Sales</p>
            {salesItems.map((i) => (
              <Link key={i.href} href={i.href} onClick={() => setOpen(null)} className="flex items-center justify-between py-2.5 pr-4 pl-8 text-[14px] hover:bg-navy-50">{i.label}<span className="text-[12px] text-ink-2">{i.note}</span></Link>
            ))}
          </>}
          <div className="my-1.5 border-t border-sand-200" />
          <button type="button" onClick={() => { setOpen(null); help(); }} className="flex w-full px-4 py-2.5 text-left text-[14px] hover:bg-navy-50">Help</button>
        </nav>
      </div>
      <Link href="/" aria-label="Concept Studio, My day" className="mr-3 flex items-center">
        <span className="hidden min-[1120px]:block"><StudioLogo tone="white" height={26} priority /></span>
        <span className="min-[1120px]:hidden"><StudioMark tone="white" size={28} /></span>
      </Link>
      <nav aria-label="Main" className="hidden items-stretch min-[1120px]:flex">
        {links.map((l) => (
          <Link key={l.key} href={l.href} aria-current={owner === l.key ? "page" : undefined} className={item(l.key)}>
            {l.label}{l.badge ? <><span className={count} aria-hidden>{l.badge}</span><span className="sr-only">, {l.badge} {l.badgeLabel}</span></> : null}
          </Link>
        ))}
        {nav.leads && (
          <div className="relative flex">
            <button type="button" onClick={() => toggle("sales")} aria-expanded={open === "sales"} aria-controls="sales-menu" className={item("sales")} aria-current={owner === "sales" ? "page" : undefined}>
              Sales{counts.leadsNew ? <><span className={count} aria-hidden>{counts.leadsNew}</span><span className="sr-only">, {counts.leadsNew} new leads</span></> : null}<ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            <div id="sales-menu" hidden={open !== "sales"} className={`${panel} left-0 w-60 py-1.5`}>
              {salesItems.map((i) => (
                <Link key={i.href} href={i.href} onClick={() => setOpen(null)} className="flex items-center justify-between px-4 py-2.5 text-[14px] hover:bg-navy-50">{i.label}<span className="text-[12px] text-ink-2">{i.note}</span></Link>
              ))}
            </div>
          </div>
        )}
      </nav>
      <span className="flex-1" />
      {clients && (<>
        <button type="button" onClick={() => search.setOpen(true)} aria-label="Find a client (Ctrl K)"
          className="hidden h-9 w-[300px] items-center gap-2 border border-[#7E91B2] bg-white/5 px-2.5 text-left text-[13px] text-[#C9D3E6] hover:bg-white/10 min-[1366px]:flex">
          <Search className="h-4 w-4 flex-none" aria-hidden /><span className="flex-1">Find a client</span>
          <kbd className="border border-[#7E91B2] px-1.5 text-[10.5px] font-semibold">Ctrl K</kbd>
        </button>
        <button type="button" onClick={() => search.setOpen(true)} aria-label="Find a client (Ctrl K)"
          className="flex h-9 items-center gap-1.5 border border-[#7E91B2] px-2.5 text-[13px] hover:bg-white/10 min-[1366px]:hidden">
          <Search className="h-4 w-4" aria-hidden /><span className="hidden min-[1120px]:inline">Find</span>
        </button>
      </>)}
      <div className="relative">
        <button type="button" onClick={openBell} aria-expanded={open === "bell"} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} title="Notifications" className={`${icon} ${open === "bell" ? "bg-white/15" : ""}`} data-bell>
          <Bell className="h-[19px] w-[19px]" />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-white px-1.5 text-[10px] leading-4 font-bold text-navy-700" data-bell-count>{unread}</span>}
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
        <button type="button" onClick={help} aria-label="Help" title="Help" className={`${icon} hidden min-[1120px]:grid`}><HelpCircle className="h-[19px] w-[19px]" /></button>
        {open === "help" && (
          <div className={`${panel} right-0 w-80 p-3`}>
            <p className="px-1 pb-2 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">Our SOPs</p>
            {SOP_LINKS.map(([l, h]) => <a key={h} href={h} target="_blank" rel="noreferrer" className="block rounded-md px-2 py-1.5 text-[13px] text-navy-700 hover:bg-navy-50">{l}</a>)}
          </div>
        )}
      </div>
      {gear.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => toggle("gear")} aria-expanded={open === "gear"} aria-label="Settings" title="Settings" aria-current={owner === "gear" ? "page" : undefined}
            className={`${icon} ${open === "gear" ? "bg-white/15" : ""} ${owner === "gear" ? "!h-14 border-b-[3px] border-lime-500 bg-navy-600" : ""}`}>
            <Settings className="h-[19px] w-[19px]" />
            {drafts > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-white px-1.5 text-[10px] leading-4 font-bold text-navy-700" title={`${drafts} template${drafts === 1 ? "" : "s"} to approve`}>{drafts}</span>}
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
      {newItems.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => toggle("new")} aria-expanded={open === "new"} aria-haspopup="menu"
            className="ml-1 flex h-9 items-center gap-1.5 bg-lime-500 px-3 text-[13.5px] font-bold text-navy-800 hover:bg-[#9BCB45]"><Plus className="h-4 w-4" aria-hidden />New</button>
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
        <button type="button" onClick={() => toggle("me")} aria-expanded={open === "me"} aria-label={`${name}, account menu`} className="ml-1 flex h-9 items-center gap-2 pr-1.5 pl-1 text-[13.5px] font-semibold text-white hover:bg-white/10">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-[11px] font-extrabold text-navy-700">{initials}</span>
          <span className="hidden max-w-40 truncate min-[1440px]:inline">{name}</span><ChevronDown className="h-3.5 w-3.5" aria-hidden />
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
    </header>
  );
}
