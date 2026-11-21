"use client";
// CB2-1 Part 2: Closebook's own window, laid out like QuickBooks Online: a top bar (logo, client switcher, + New, search,
// Back to Studio) and a left menu (Books). Light only. At phone width the left menu folds behind "Menu".
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, FileText, LayoutDashboard, ListTree, Menu, Plus, Search, Settings, X } from "lucide-react";
import { CbLogo } from "./logo";

export type ShellClient = { id: string; name: string };

const BOOKS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "chart", label: "Chart of accounts", icon: ListTree },
  { key: "journal", label: "Journal entries", icon: BookOpen },
  { key: "reports", label: "Reports", icon: FileText },
] as const;

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

// QBO's company switcher: type to search, one click to switch; the page you are on stays the same.
function ClientSwitcher({ client, clients }: { client: ShellClient; clients: ShellClient[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const path = usePathname();
  const ref = useOutside(open, () => setOpen(false));
  const list = useMemo(() => clients.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50), [clients, q]);
  const section = path.split("/")[3] ?? "overview";
  const to = (id: string) => `/cb/${id}/${["journal", "chart", "reports", "settings", "overview", "search"].includes(section) ? section : "overview"}`;
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-client-switcher
        className="flex max-w-[8.5rem] items-center gap-1 rounded-md px-1.5 py-1.5 text-[13.5px] font-semibold hover:bg-white/10 sm:max-w-[22rem] sm:gap-1.5 sm:px-2.5">
        <span className="truncate">{client.name}</span><ChevronDown className="h-4 w-4 flex-none opacity-80" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,90vw)] rounded-lg border border-sand-200 bg-white p-2 text-ink shadow-xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" aria-label="Find a client" className="input input-compact mb-1.5 w-full" />
          <ul className="max-h-[60vh] overflow-y-auto">
            {list.map((c) => <li key={c.id}><Link href={to(c.id)} onClick={() => setOpen(false)} aria-current={c.id === client.id ? "true" : undefined}
              className={`block rounded px-2.5 py-1.5 text-[13px] hover:bg-sand-100 ${c.id === client.id ? "font-semibold text-navy-700" : ""}`}>{c.name}</Link></li>)}
            {!list.length && <li className="px-2.5 py-1.5 text-[13px] text-ink-3">No client matches.</li>}
          </ul>
          <Link href="/cb" onClick={() => setOpen(false)} className="mt-1 block border-t border-sand-200 px-2.5 pt-2 text-[12.5px] font-semibold text-navy-700 hover:underline">All clients</Link>
        </div>
      )}
    </div>
  );
}

// QBO's "+ New". Upload bank file and Rule come with Bank transactions (PR B).
function NewMenu({ base, canEdit }: { base: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  if (!canEdit) return null;
  const items = [{ label: "Journal entry", href: `${base}/journal/new` }, { label: "Account", href: `${base}/chart?panel=new` }];
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="New" data-new-menu
        className="flex flex-none items-center gap-1 rounded-full bg-white px-2 py-1.5 text-[13px] font-semibold text-navy-800 hover:bg-navy-50 sm:px-3"><Plus className="h-4 w-4" /><span className="hidden sm:inline">New</span></button>
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-sand-200 bg-white p-1 text-ink shadow-xl">
          {items.map((i) => <li key={i.label}><Link href={i.href} onClick={() => setOpen(false)} className="block rounded px-3 py-2 text-[13px] hover:bg-sand-100">{i.label}</Link></li>)}
        </ul>
      )}
    </div>
  );
}

export function CbShell({ client, clients, canEdit, children }: { client: ShellClient; clients: ShellClient[]; canEdit: boolean; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const base = `/cb/${client.id}`;
  const on = (key: string) => path === `${base}/${key}` || path.startsWith(`${base}/${key}/`);
  const item = (active: boolean) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] ${active ? "bg-navy-50 font-semibold text-navy-800" : "text-ink-2 hover:bg-sand-100"}`;
  const nav = (
    <nav aria-label="Books" className="flex h-full flex-col gap-0.5 p-2.5">
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-ink-3">Books</p>
      {BOOKS.map((b) => <Link key={b.key} href={`${base}/${b.key}`} onClick={() => setMenu(false)} aria-current={on(b.key) ? "page" : undefined} className={item(on(b.key))}><b.icon className="h-4 w-4" />{b.label}</Link>)}
      <span className="flex-1" />
      <Link href={`${base}/settings`} onClick={() => setMenu(false)} aria-current={on("settings") ? "page" : undefined} className={item(on("settings"))}><Settings className="h-4 w-4" />Settings</Link>
    </nav>
  );
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 flex-none items-center gap-2 bg-navy-800 px-3 text-white print:hidden md:gap-3 md:px-4">
        <button type="button" onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu} className="rounded p-1.5 hover:bg-white/10 md:hidden"><Menu className="h-5 w-5" /></button>
        <Link href={`${base}/overview`} className="hidden flex-none sm:block" aria-label="Closebook overview"><CbLogo tone="white" height={26} /></Link>
        <ClientSwitcher client={client} clients={clients} />
        <NewMenu base={base} canEdit={canEdit} />
        <form role="search" className="ml-auto hidden min-w-0 flex-1 justify-end md:flex" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); router.push(`${base}/search?q=${encodeURIComponent(String(q ?? ""))}`); }}>
          <label className="relative w-full max-w-[22rem]">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-200" />
            <input name="q" placeholder="Search amount, date, description, account or no." data-books-search
              className="h-9 w-full rounded-full border border-white/20 bg-white/10 pl-8 pr-3 text-[13px] text-white placeholder:text-navy-200 focus:bg-white focus:text-ink focus:outline-none" />
          </label>
        </form>
        <Link href={`${base}/search`} aria-label="Search" className="ml-auto rounded p-1.5 hover:bg-white/10 md:hidden"><Search className="h-5 w-5" /></Link>
        <Link href="/" className="flex-none whitespace-nowrap rounded-md px-1.5 py-1.5 text-[13px] font-semibold hover:bg-white/10 sm:px-2" data-back-to-studio><span className="sm:hidden">Studio</span><span className="hidden sm:inline">Back to Studio</span></Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 flex-none border-r border-sand-200 bg-white md:block print:hidden"><div className="sticky top-14 h-[calc(100vh-3.5rem)]">{nav}</div></aside>
        {menu && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button type="button" aria-label="Close the menu" onClick={() => setMenu(false)} className="absolute inset-0 bg-navy-950/40" />
            <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-sand-200 px-3 py-2.5"><CbLogo tone="navy" height={22} />
                <button type="button" onClick={() => setMenu(false)} aria-label="Close the menu" className="rounded p-1 hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
              {nav}
            </div>
          </div>
        )}
        <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
