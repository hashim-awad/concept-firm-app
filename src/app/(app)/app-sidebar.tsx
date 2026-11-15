"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BookCheck, Briefcase, Building2, FileSignature, FolderLock, Home, Landmark, UserPlus, X } from "lucide-react";
import { Sidebar, type NavItem } from "@/components/ds/navigation";

export type SidebarAccess = {
  fullName: string;
  roleName: string;
  isOwner: boolean;
  leads: boolean;
  clients: boolean;
  documents: boolean;
  documentsEdit: boolean;
  vault: boolean;
  pricing: boolean;
  screening: boolean;
  templates: boolean;
  taxRates: boolean;
  staff: boolean;
  settings: boolean;
  closebook: boolean;
};
export type SidebarCounts = { quotesAwaiting: number; lettersAwaiting: number; leadsNew: number };

// Which menu item a page belongs to (pages keep their addresses; only their place in the menu changed).
const OWNER: [string, string][] = [
  ["/documents/proposal", "/quotes"], ["/proposals", "/quotes"],
  ["/documents/corporate-letter", "/engagement-letters"], ["/documents/t1-letter", "/engagement-letters"], ["/engagement-letters/new", "/engagement-letters"],
  ["/documents/engagements", "/engagements"],
];

// Round 17 (Hashim, Nov 15, 2026; benchmark QuickBooks Online): the left menu holds daily work only, in
// one list with no headings. Find a client, the person and Sign out moved to the top bar; Settings to
// the gear. Items follow the person's permissions; the database enforces them again on every read.
export function AppSidebar({ access, counts }: { access: SidebarAccess; counts: SidebarCounts; signOut?: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("studio:open-menu", show);
    return () => window.removeEventListener("studio:open-menu", show);
  }, []);
  const home = OWNER.find(([p]) => path === p || path.startsWith(p + "/"))?.[1];
  const is = (href: string) => (home ? home === href : href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const item = (href: string, label: string, icon: React.ReactNode, badge?: number): NavItem => ({ href, label, icon, active: is(href), badge: badge ? String(badge) : undefined });
  const items = [
    item("/", "My day", <Home key="i" />),
    access.leads && item("/leads", "Leads", <UserPlus key="i" />, counts.leadsNew),
    access.leads && item("/quotes", "Quotes", <Landmark key="i" />),
    access.clients && item("/clients", "Clients", <Building2 key="i" />),
    access.documents && item("/engagements", "Engagements", <Briefcase key="i" />),
    // Engagement letters keeps its own item until round 19, when it becomes a tab under Engagements.
    (access.documents || access.leads) && item("/engagement-letters", "Engagement letters", <FileSignature key="i" />, counts.lettersAwaiting),
    // Closebook opens on My files; All files and Review notes are tabs on that page.
    access.closebook && item("/closebook", "Closebook", <BookCheck key="i" />),
    (access.documents || access.vault) && item("/documents", "Documents", <FolderLock key="i" />),
  ].filter(Boolean) as NavItem[];
  const groups = [{ label: "", items }];
  // Inside a Closebook file the menu folds to icons (round 15).
  const inFile = /^\/closebook\/[0-9a-f-]{36}(\/|$)/.test(path);
  const sidebar = <Sidebar groups={groups} />;
  const desktop = inFile ? <Sidebar compact groups={groups} /> : sidebar;

  return (
    <>
      {/* Phone and tablet: the menu opens from the top bar's menu button. */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            {sidebar}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 -right-12 rounded-md bg-navy-800 p-2 text-white"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
      {/* Desktop: fixed sidebar */}
      <div className="sticky top-0 hidden h-screen shrink-0 md:block">{desktop}</div>
    </>
  );
}
