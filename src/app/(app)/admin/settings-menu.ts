import type { Access, Area } from "@/lib/access";

// The gear menu (round 17, Hashim, Nov 15, 2026). Benchmark: QuickBooks Online's gear, one menu in
// columns; TaxDome keeps templates as their own area. Each entry opens its page; pages that merge
// older pages have tabs.
//
// Each entry and tab states:
// - open: who can open it. Any one of these is enough: an area (needs View), "admin" (Edit on Staff accounts and Settings, piece R3a-1), or "everyone".
//   The menu shows an entry only to people who can open it (QuickBooks hides admin-only items), and a
//   page shows only the tabs the person can open. There are no lock icons.
// - adminOnly: what only an Admin can do there. The button is hidden from everyone else.
// - settingKeys: for pages that save to the settings table, the keys they save.
// - dir: the folder (under src/app/(app)/admin) whose view does the work, for the checks.
// tests/settings-menu.test.ts checks these against the code: each view's own access check must match
// "open", and settingKeys must be Admin-only in update_setting exactly when "adminOnly" is set.
export type Open = Area | "admin" | "everyone";
export type GearTab = { key: string; label: string; open: Open[]; adminOnly?: string; settingKeys?: string[]; dir: string };
export type GearDef = { label: string; href: string; open?: Open[]; adminOnly?: string; settingKeys?: string[]; dir?: string; tabs?: GearTab[]; also?: string[]; count?: string };
export type GearItem = { label: string; href: string; count?: number };
export type GearColumn = { label: string; items: GearItem[] };

const TEMPLATES: Open[] = ["engagement_terms"];

export const GEAR: [string, GearDef[]][] = [
  ["Your firm", [
    { label: "Firm details", href: "/admin/firm", tabs: [
      { key: "hours", label: "Business hours", open: ["settings"], settingKeys: ["business_hours"], dir: "settings/business-hours" },
      { key: "signers", label: "Signers", open: ["settings"], settingKeys: ["signer_engagement_letter", "signer_proposal", "signer_other"], adminOnly: "change signer names", dir: "settings/signers" },
      { key: "signature", label: "Signature", open: ["admin"], settingKeys: ["signature_image"], adminOnly: "change the signature", dir: "settings/signature" },
      { key: "contact", label: "Contact details", open: ["settings"], adminOnly: "change the firm's contact details", dir: "settings/contact" },
    ] },
    { label: "Team and roles", href: "/admin/team", open: ["staff_accounts", "admin"], also: ["/admin/staff", "/admin/roles"], dir: "team" },
    { label: "Online sales", href: "/admin/online-sales", tabs: [
      { key: "start", label: "Start page", open: ["settings"], settingKeys: ["start_page_open"], adminOnly: "open or close it", dir: "settings/start-page" },
      { key: "screening", label: "Screening questions", open: ["price_book"], dir: "screening" },
      { key: "booking", label: "Booking link", open: ["settings"], settingKeys: ["booking_link"], dir: "settings/booking-link" },
      { key: "assignment", label: "Lead assignment", open: ["settings"], settingKeys: ["lead_assignment"], dir: "settings/lead-assignment" },
    ] },
    { label: "Email sending", href: "/admin/email-sending", open: ["admin"], dir: "settings/signing-email" },
    { label: "Closebook rules", href: "/admin/closebook-rules", tabs: [
      { key: "thresholds", label: "Thresholds", open: ["admin"], dir: "closebook/thresholds" },
      { key: "policy", label: "Note 1 policy", open: ["admin"], dir: "closebook/policy" },
      { key: "due-dates", label: "GST/HST due dates", open: ["admin"], dir: "closebook/gst" },
      // Piece 1 (Hashim, Nov 18, 2026): the CRA's per-km allowance rates and the ITC factors. Admins only.
      { key: "cra-rates", label: "CRA rates", open: ["admin"], dir: "closebook/cra-rates" },
    ] },
    { label: "Connections", href: "/admin/connections", open: ["admin"], dir: "taxdome-import" },
    { label: "Data retention", href: "/admin/retention", open: ["settings"], settingKeys: ["retention_months"], dir: "settings/retention" },
  ]],
  ["Lists", [
    { label: "Price book", href: "/admin/price-book", open: ["pricing"], adminOnly: "apply the price book clean-up", dir: "price-book" },
    { label: "Sales tax rates", href: "/admin/sales-tax", tabs: [
      { key: "rates", label: "Rates we charge", open: ["tax_rates"], adminOnly: "load the CRA table or approve rates", dir: "tax-rates" },
      { key: "quick", label: "Quick method rates", open: ["admin"], dir: "closebook/gst" },
    ] },
    { label: "T1 rule values", href: "/admin/t1-rules", open: ["settings"], settingKeys: ["t1_rules"], adminOnly: "change them", dir: "settings/t1-rules" },
    { label: "Lead sources", href: "/admin/lead-sources", open: ["settings"], settingKeys: ["lead_sources"], dir: "settings/lead-sources" },
    { label: "Chart and GIFI", href: "/admin/chart", tabs: [
      { key: "gifi", label: "GIFI lines", open: ["admin"], dir: "closebook/gifi-lines" },
      { key: "tax-codes", label: "Tax codes", open: ["admin"], dir: "closebook/tax-codes" },
      { key: "lead-sheets", label: "Lead sheets", open: ["admin"], dir: "closebook/lead-sheets" },
    ] },
    { label: "Standard entries", href: "/admin/standard-entries", open: ["admin"], dir: "closebook/standard-entries" },
    { label: "Vendor rules", href: "/admin/vendor-rules", open: ["admin"], dir: "closebook/vendor-rules" },
  ]],
  ["Templates", [
    { label: "Letters and quotes", href: "/admin/templates?tab=letters", open: TEMPLATES, adminOnly: "approve or publish wording", dir: "templates", count: "letters" },
    { label: "Schedules and terms", href: "/admin/templates?tab=schedules", open: TEMPLATES, adminOnly: "approve or publish wording", dir: "templates", count: "schedules" },
    { label: "Emails", href: "/admin/templates?tab=emails", open: TEMPLATES, adminOnly: "approve or publish wording", dir: "templates", count: "emails" },
    { label: "Closebook", href: "/admin/templates?tab=closebook", open: TEMPLATES, adminOnly: "approve or publish wording", dir: "templates", count: "closebook" },
  ]],
  ["Tools", [
    { label: "T1 price check", href: "/admin/t1-price-check", open: ["pricing"], dir: "t1-price-check" },
    // Round 20: bank and card statement PDFs to CSV or Excel, with no client file.
    { label: "Bank statement PDF to CSV", href: "/admin/bank-pdf", open: ["closebook"], dir: "bank-pdf" },
    { label: "Import TaxDome export", href: "/admin/taxdome-import", open: ["admin"], dir: "taxdome-import" },
    { label: "Download full export", href: "/admin/export", open: ["admin"], dir: "export" },
    { label: "Activity log", href: "/admin/activity", open: ["admin"], dir: "activity" },
    { label: "Change log", href: "/admin/changelog", open: ["everyone"], dir: "changelog" },
  ]],
];

export function canOpen(a: Access, open: Open[]) {
  return open.some((o) => o === "everyone" || (o === "admin" ? a.admin : a.permissions[o] === "view" || a.permissions[o] === "edit"));
}

// Who can open an entry: its own rule, or, for a page of tabs, any one of its tabs.
export const entryOpen = (d: GearDef): Open[] => d.open ?? [...new Set((d.tabs ?? []).flatMap((t) => t.open))];
export const gearDef = (href: string): GearDef => GEAR.flatMap(([, d]) => d).find((d) => d.href === href)!;
// The tabs of a page that this person can open, in order.
export const openTabs = (a: Access, href: string): GearTab[] => (gearDef(href).tabs ?? []).filter((t) => canOpen(a, t.open));

// The gear menu for one person. drafts: templates waiting for an Admin, per Templates tab (Admins only).
export function gearMenu(a: Access, drafts: Record<string, number>): GearColumn[] {
  return GEAR.map(([label, defs]) => ({
    label,
    items: defs.filter((d) => canOpen(a, entryOpen(d))).map((d) => ({ label: d.label, href: d.href, count: d.count && a.admin && drafts[d.count] ? drafts[d.count] : undefined })),
  })).filter((g) => g.items.length);
}
