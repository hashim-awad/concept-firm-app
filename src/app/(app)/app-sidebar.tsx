"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { BookOpen, Building2, Calculator, FileSignature, FileText, FolderLock, History, Home, Import, Landmark, ListChecks, LogOut, Menu, Percent, Settings, ShieldCheck, Users, X } from "lucide-react";
import { Sidebar, type NavGroup } from "@/components/ds/navigation";
import { Logo } from "@/components/ds/brand";

export type SidebarAccess = {
  fullName: string;
  roleName: string;
  isOwner: boolean;
  priceBook: boolean;
  documents: boolean;
  documentsEdit: boolean;
  clients: boolean;
  taxRates: boolean;
  staff: boolean;
  settings: boolean;
};

// Menu items follow the person's permissions. The database enforces them again on every read.
export function AppSidebar({ access, signOut }: { access: SidebarAccess; signOut: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // The create screens live under /documents but have their own menu items.
  const CREATE = ["/documents/corporate-letter", "/documents/t1-letter", "/documents/proposal"];
  const is = (href: string) => (href === "/" ? path === "/"
    : href === "/documents" ? (path === href || path.startsWith("/documents/")) && !CREATE.some((c) => path.startsWith(c))
    : path === href || path.startsWith(`${href}/`));
  const item = (href: string, label: string, icon: React.ReactNode, badge?: string) => ({ href, label, icon, active: is(href), badge });

  const groups: NavGroup[] = [
    { label: "Workspace", items: [
      item("/", "Home", <Home key="i" />),
      access.documents && item("/documents", "Documents", <FolderLock key="i" />),
      access.clients && item("/clients", "Clients", <Building2 key="i" />),
    ].filter(Boolean) as NavGroup["items"] },
  ];
  if (access.documentsEdit) {
    groups.push({ label: "Create", items: [
      item("/documents/corporate-letter", "Corporate letter", <FileSignature key="i" />),
      item("/documents/t1-letter", "T1 letter", <FileText key="i" />),
      item("/documents/proposal", "Proposal", <Landmark key="i" />),
      item("/t1-pricing", "T1 pricing", <Calculator key="i" />),
    ] });
  }
  if (access.priceBook) {
    groups.push({ label: "Price book", items: [
      item("/admin/price-book", "Price book", <BookOpen key="i" />),
      item("/admin/screening", "Screening questions", <ListChecks key="i" />),
    ] });
  }
  const admin = [
    access.staff && item("/admin/staff", "Staff", <Users key="i" />),
    access.taxRates && item("/admin/tax-rates", "GST/HST rates", <Percent key="i" />),
    access.isOwner && item("/admin/roles", "Roles and permissions", <ShieldCheck key="i" />),
    access.isOwner && item("/admin/import", "Import from Studio", <Import key="i" />),
    access.settings && item("/admin/settings", "Settings", <Settings key="i" />),
    access.isOwner && item("/admin/activity", "Activity log", <History key="i" />),
  ].filter(Boolean) as NavGroup["items"];
  groups.push({ label: "Admin", items: admin });

  const signOutButton = (
    <form action={signOut} className="mt-2">
      <button type="submit" className="inline-flex items-center gap-1.5 text-xs text-white/65 hover:text-white">
        <LogOut className="h-3.5 w-3.5" aria-hidden />Sign out
      </button>
    </form>
  );

  return (
    <>
      {/* Phone and tablet: top bar with a menu button */}
      <div className="flex h-14 items-center justify-between bg-navy-800 px-4 md:hidden">
        <Logo tone="white" height={28} />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-2 text-white hover:bg-white/10"><Menu className="h-5 w-5" /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            <Sidebar groups={groups} user={{ name: access.fullName, role: access.roleName }} footer={signOutButton} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 -right-12 rounded-md bg-navy-800 p-2 text-white"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
      {/* Desktop: fixed sidebar */}
      <div className="sticky top-0 hidden h-screen shrink-0 md:block">
        <Sidebar groups={groups} user={{ name: access.fullName, role: access.roleName }} footer={signOutButton} />
      </div>
    </>
  );
}
