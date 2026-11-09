import "server-only";
import { canView, type Access } from "@/lib/access";

// The Settings menu (Hashim, 2026-11-10): grouped like Stripe, QuickBooks Online and Xero. Each item
// shows only to people who can open its page; the page checks again, and the database checks on every
// read and change. lock: "owner" = only owners can open it; "change" = everyone with access can see it,
// only an owner can change it. soon = not built yet.
export type SettingsItem = { label: string; href: string; lock?: "owner" | "change"; soon?: boolean; also?: string[] };
export type SettingsGroup = { label: string; items: SettingsItem[] };

export function settingsMenu(a: Access): SettingsGroup[] {
  const s = canView(a, "settings"), o = a.is_owner;
  const groups: [string, (SettingsItem | false)[]][] = [
    ["Firm", [
      o && { label: "Firm profile", href: "", soon: true },
      (canView(a, "staff_accounts") || o) && { label: "Team and roles", href: "/admin/team", also: ["/admin/staff", "/admin/roles"] },
      s && { label: "Business hours", href: "/admin/settings/business-hours" },
    ]],
    ["Sales and quotes", [
      s && { label: "Public start page", href: "/admin/settings/start-page", lock: "change" },
      s && { label: "Lead assignment", href: "/admin/settings/lead-assignment" },
      s && { label: "Lead sources", href: "/admin/settings/lead-sources" },
      s && { label: "Booking link", href: "/admin/settings/booking-link" },
      canView(a, "price_book") && { label: "Screening questions", href: "/admin/screening" },
    ]],
    ["Pricing", [
      canView(a, "pricing") && { label: "Price book", href: "/admin/price-book" },
      canView(a, "tax_rates") && { label: "GST/HST rates", href: "/admin/tax-rates" },
    ]],
    ["Letters and signing", [
      s && { label: "Signer names", href: "/admin/settings/signers", lock: "change" },
      o && s && { label: "Signature image", href: "/admin/settings/signature", lock: "owner" },
      canView(a, "engagement_terms") && { label: "Templates", href: "/admin/templates" },
    ]],
    ["Tax rules", [
      s && { label: "T1 rule values", href: "/admin/settings/t1-rules", lock: "change" },
    ]],
    ["Connections", [
      o && { label: "Import from TaxDome", href: "/admin/taxdome-import", lock: "owner" },
      o && { label: "Import from Studio", href: "/admin/import", lock: "owner" },
      o && { label: "Email", href: "", soon: true },
    ]],
    ["Data and security", [
      s && { label: "Retention", href: "/admin/settings/retention" },
      o && { label: "Download full export", href: "", soon: true, lock: "owner" },
      o && { label: "Activity log", href: "/admin/activity", lock: "owner" },
      { label: "Change log", href: "/admin/changelog" },
    ]],
  ];
  return groups.map(([label, items]) => ({ label, items: items.filter(Boolean) as SettingsItem[] })).filter((g) => g.items.length);
}
