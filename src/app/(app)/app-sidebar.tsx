"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3, BookOpen, Building2, Calculator, ClipboardCheck, FileSignature, FolderLock, History, Home, Landmark, Library, ListChecks,
  CloudDownload, LogOut, Menu, Newspaper, Percent, ScrollText, Settings, Sparkles, Tags, UserPlus, Users, Wallet, X, Briefcase, Layers,
} from "lucide-react";
import { Sidebar, type NavGroup, type NavItem } from "@/components/ds/navigation";
import { StudioLogo } from "@/components/ds/brand";
import { ClientSearchDialog, useClientSearch } from "./client-search";

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
};
export type SidebarCounts = { proposalsAwaiting: number; lettersAwaiting: number; leadsNew: number };

// Which menu item a page belongs to (pages keep their addresses; only their place in the menu changed).
const OWNER: [string, string][] = [
  ["/documents/proposal", "/proposals"], ["/t1-pricing", "/proposals"],
  ["/documents/corporate-letter", "/engagement-letters"], ["/documents/t1-letter", "/engagement-letters"],
  ["/documents/engagements", "/engagements"], ["/admin/staff", "/admin/team"], ["/admin/roles", "/admin/team"],
];

// Menu sections and items follow the person's permissions. The database enforces them again on every read.
export function AppSidebar({ access, counts, signOut }: { access: SidebarAccess; counts: SidebarCounts; signOut: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const search = useClientSearch(access.clients);
  const home = OWNER.find(([p]) => path === p || path.startsWith(p + "/"))?.[1];
  const is = (href: string) => (home ? home === href : href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const item = (href: string, label: string, icon: React.ReactNode, badge?: number): NavItem => ({ href, label, icon, active: is(href), badge: badge ? String(badge) : undefined });
  const soon = (label: string, icon: React.ReactNode): NavItem => ({ href: "", label, icon, soon: true });
  const group = (label: string, items: (NavItem | false)[]): NavGroup | null => {
    const kept = items.filter(Boolean) as NavItem[];
    return kept.length ? { label, items: kept, collapsible: true } : null;
  };

  const groups = [
    { label: "Home", items: [item("/", "My day", <Home key="i" />)] } as NavGroup,
    group("Sales", [
      access.leads && item("/leads", "Leads", <UserPlus key="i" />, counts.leadsNew),
      access.documents && access.pricing && item("/proposals", "Proposals", <Landmark key="i" />, counts.proposalsAwaiting),
      access.documentsEdit && access.pricing && item("/engagement-letters", "Engagement letters", <FileSignature key="i" />, counts.lettersAwaiting),
    ]),
    group("Clients", [
      access.clients && item("/clients", "Clients", <Building2 key="i" />),
      access.documents && item("/engagements", "Engagements", <Briefcase key="i" />),
    ]),
    group("Work", access.clients ? [
      soon("Personal tax (T1)", <Calculator key="i" />),
      soon("Year-End & T2", <Layers key="i" />),
      soon("CFO reports", <BarChart3 key="i" />),
      soon("Owner pay planner", <Wallet key="i" />),
      soon("Incorporations", <Sparkles key="i" />),
    ] : []),
    group("Documents", [(access.documents || access.vault) && item("/documents", "Document vault", <FolderLock key="i" />)]),
    group("Quality", [access.isOwner && soon("Reviews", <ClipboardCheck key="i" />)]),
    group("Firm setup", [
      access.pricing && item("/admin/price-book", "Price book", <BookOpen key="i" />),
      access.templates && item("/admin/templates", "Templates", <Library key="i" />),
      access.screening && item("/admin/screening", "Screening questions", <ListChecks key="i" />),
      access.isOwner && soon("Chart of accounts", <ScrollText key="i" />),
      access.isOwner && soon("Vendor rules", <Tags key="i" />),
      access.taxRates && item("/admin/tax-rates", "GST/HST rates", <Percent key="i" />),
    ]),
    group("Admin", [
      (access.staff || access.isOwner) && item("/admin/team", "Team and roles", <Users key="i" />),
      access.settings && item("/admin/settings", "Settings", <Settings key="i" />),
      access.isOwner && item("/admin/taxdome-import", "Import from TaxDome", <CloudDownload key="i" />),
      access.isOwner && item("/admin/activity", "Activity log", <History key="i" />),
      item("/admin/changelog", "Change log", <Newspaper key="i" />),
    ]),
  ].filter(Boolean) as NavGroup[];

  const signOutButton = (
    <form action={signOut} className="mt-2">
      <button type="submit" className="inline-flex items-center gap-1.5 text-xs text-white/65 hover:text-white">
        <LogOut className="h-3.5 w-3.5" aria-hidden />Sign out
      </button>
    </form>
  );
  const onSearch = access.clients ? () => { setOpen(false); search.setOpen(true); } : undefined;
  const sidebar = <Sidebar groups={groups} user={{ name: access.fullName, role: access.roleName }} footer={signOutButton} onSearch={onSearch} />;

  return (
    <>
      {/* Phone and tablet: top bar with a menu button */}
      <div className="flex h-14 items-center justify-between bg-navy-800 px-4 md:hidden">
        <StudioLogo tone="white" height={34} />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-2 text-white hover:bg-white/10"><Menu className="h-5 w-5" /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            {sidebar}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 -right-12 rounded-md bg-navy-800 p-2 text-white"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
      {/* Desktop: fixed sidebar */}
      <div className="sticky top-0 hidden h-screen shrink-0 md:block">{sidebar}</div>
      {access.clients && <ClientSearchDialog open={search.open} onClose={() => search.setOpen(false)} />}
    </>
  );
}
