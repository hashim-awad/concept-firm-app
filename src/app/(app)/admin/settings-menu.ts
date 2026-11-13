import type { Access, Area } from "@/lib/access";

// The Settings menu (decision 47): grouped like Stripe, QuickBooks Online and Xero.
//
// Locks come from the permission rules, not set by hand (decision 48). Each item states:
// - open: who can open the page. Any one of these is enough: an area (needs View), "owner", or "everyone".
//   The menu shows the item only to people who can open it.
// - ownerOnly: what only an owner can do on the page, as the database or the page enforces it.
// - settingKeys: for pages that save to the settings table, the keys they save.
// tests/settings-menu.test.ts checks these against the code: each page's own access check must match
// "open", and a page's settingKeys must be owner-only in update_setting exactly when "ownerOnly" is set.
// The lock then follows: owners-only pages, pages that need the Pricing permission, and pages where
// only an owner can change something.
export type Open = Area | "owner" | "everyone";
export type SettingsDef = { label: string; href: string; open: Open[]; ownerOnly?: string; settingKeys?: string[]; soon?: boolean; also?: string[] };
export type SettingsItem = { label: string; href: string; lock?: string; soon?: boolean; also?: string[] };
export type SettingsGroup = { label: string; items: SettingsItem[] };

// Permissions that are restricted on purpose and get a lock (Phase 2 batch, section 2: Pricing).
export const RESTRICTED_AREAS: Area[] = ["pricing"];
const AREA_NAMES: Partial<Record<Area, string>> = { pricing: "Pricing" };

export const SETTINGS: [string, SettingsDef[]][] = [
  ["Firm", [
    { label: "Firm profile", href: "", open: ["owner"], soon: true },
    { label: "Team and roles", href: "/admin/team", open: ["staff_accounts", "owner"], also: ["/admin/staff", "/admin/roles"] },
    { label: "Business hours", href: "/admin/settings/business-hours", open: ["settings"], settingKeys: ["business_hours"] },
  ]],
  ["Sales and quotes", [
    { label: "Public start page", href: "/admin/settings/start-page", open: ["settings"], settingKeys: ["start_page_open"], ownerOnly: "open or close it" },
    { label: "Lead assignment", href: "/admin/settings/lead-assignment", open: ["settings"], settingKeys: ["lead_assignment"] },
    { label: "Lead sources", href: "/admin/settings/lead-sources", open: ["settings"], settingKeys: ["lead_sources"] },
    { label: "Booking link", href: "/admin/settings/booking-link", open: ["settings"], settingKeys: ["booking_link"] },
    { label: "Screening questions", href: "/admin/screening", open: ["price_book"] },
  ]],
  ["Pricing", [
    { label: "Price book", href: "/admin/price-book", open: ["pricing"], ownerOnly: "apply the price book clean-up" },
    { label: "T1 price check", href: "/admin/t1-price-check", open: ["pricing"] },
    { label: "GST/HST rates", href: "/admin/tax-rates", open: ["tax_rates"], ownerOnly: "load the CRA table or approve rates" },
  ]],
  ["Letters and signing", [
    { label: "Signer names", href: "/admin/settings/signers", open: ["settings"], settingKeys: ["signer_engagement_letter", "signer_proposal", "signer_other"], ownerOnly: "change signer names" },
    { label: "Signature image", href: "/admin/settings/signature", open: ["owner"], settingKeys: ["signature_image"], ownerOnly: "change the signature" },
    { label: "Templates", href: "/admin/templates", open: ["engagement_terms"], ownerOnly: "approve or publish wording" },
    { label: "Signing emails", href: "/admin/settings/signing-email", open: ["owner"] },
  ]],
  ["Tax rules", [
    { label: "T1 rule values", href: "/admin/settings/t1-rules", open: ["settings"], settingKeys: ["t1_rules"], ownerOnly: "change them" },
  ]],
  // Closebook setup (Phase 3 batch, section 7): owners only.
  ["Closebook", [
    { label: "GIFI lines", href: "/admin/closebook/gifi-lines", open: ["owner"] },
    { label: "Tax codes", href: "/admin/closebook/tax-codes", open: ["owner"] },
    { label: "Lead sheets", href: "/admin/closebook/lead-sheets", open: ["owner"] },
    { label: "Firm chart matching", href: "", open: ["owner"], soon: true },
    { label: "Standard entries", href: "/admin/closebook/standard-entries", open: ["owner"] },
    { label: "Vendor rules", href: "/admin/closebook/vendor-rules", open: ["owner"] },
    { label: "Bank CSV formats", href: "", open: ["owner"], soon: true },
    { label: "Thresholds", href: "/admin/closebook/thresholds", open: ["owner"] },
    { label: "Accounting policy (Note 1)", href: "/admin/closebook/policy", open: ["owner"] },
  ]],
  ["Connections", [
    { label: "Import from TaxDome", href: "/admin/taxdome-import", open: ["owner"] },
    { label: "Import from Studio", href: "/admin/import", open: ["owner"] },
    { label: "Email", href: "", open: ["owner"], soon: true },
  ]],
  ["Data and security", [
    { label: "Retention", href: "/admin/settings/retention", open: ["settings"], settingKeys: ["retention_months"] },
    { label: "Download full export", href: "/admin/export", open: ["owner"] },
    { label: "Activity log", href: "/admin/activity", open: ["owner"] },
    { label: "Change log", href: "/admin/changelog", open: ["everyone"] },
  ]],
];

export function canOpen(a: Access, open: Open[]) {
  return open.some((o) => o === "everyone" || (o === "owner" ? a.is_owner : a.permissions[o] === "view" || a.permissions[o] === "edit"));
}

// The lock text, worked out from the rules above. No lock when nothing on the page is restricted.
export function lockFor(d: SettingsDef): string | undefined {
  if (d.open.length === 1 && d.open[0] === "owner") return "Owners only";
  const parts: string[] = [];
  const restricted = d.open.filter((o): o is Area => RESTRICTED_AREAS.includes(o as Area));
  if (restricted.length === d.open.length && restricted.length) parts.push(`Needs the ${restricted.map((r) => AREA_NAMES[r] ?? r).join(" or ")} permission`);
  if (d.ownerOnly) parts.push(`Only an owner can ${d.ownerOnly}`);
  return parts.length ? parts.join(". ") : undefined;
}

export function settingsMenu(a: Access): SettingsGroup[] {
  return SETTINGS.map(([label, defs]) => ({
    label,
    items: defs.filter((d) => canOpen(a, d.open)).map((d) => ({ label: d.label, href: d.href, soon: d.soon, also: d.also, lock: lockFor(d) })),
  })).filter((g) => g.items.length);
}
