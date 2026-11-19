import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Level = "none" | "view" | "edit";
export type Area =
  | "leads" | "clients" | "documents" | "vault" | "price_book" | "pricing" | "tax_rates"
  | "engagement_terms" | "custom_line" | "staff_accounts" | "exports" | "settings" | "closebook";

export type Access = {
  staff_id: string;
  full_name: string;
  role_name: string;
  // Piece R3a-1 (Hashim, Nov 19, 2026): there is no Owner role. Admin is Edit on Staff accounts and Settings.
  admin: boolean;
  permissions: Record<Area, Level>;
  // Round 19: the letter types the person's role may prepare and see (ticked on the role). R3a-1: "final" is the
  // Letters box "Can issue Final and send for signing".
  letters: { t1: boolean; corporate: boolean; final: boolean };
  // R3a-1: the Closebook switches on the person's role.
  closebook: CbRights;
};
export type CbRights = { prepare: boolean; review: boolean; partner: boolean; lock: boolean; remove_signoffs: boolean };

// The signed-in staff member's access, from the database. Null if not active staff.
export async function getAccess(): Promise<Access | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return null;
  const a = data as Access & { is_owner?: unknown };
  const l = (a.letters ?? {}) as Partial<Access["letters"]>;
  const c = (a.closebook ?? {}) as Partial<CbRights>;
  // Default deny: anything missing is false (strict === true).
  return {
    staff_id: a.staff_id, full_name: a.full_name, role_name: a.role_name, permissions: a.permissions, admin: a.admin === true,
    letters: { t1: l.t1 === true, corporate: l.corporate === true, final: l.final === true },
    closebook: { prepare: c.prepare === true, review: c.review === true, partner: c.partner === true, lock: c.lock === true, remove_signoffs: c.remove_signoffs === true },
  };
}

export function canView(access: Access, area: Area) {
  return access.permissions[area] === "view" || access.permissions[area] === "edit";
}

export function canEdit(access: Access, area: Area) {
  return access.permissions[area] === "edit";
}

// For pages: send the person away if they lack access. The database checks again on every
// read and change, so this only decides what is shown.
export async function requireAccess(area?: Area, level: "view" | "edit" = "view"): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/no-access");
  if (area && !(level === "edit" ? canEdit(access, area) : canView(access, area))) redirect("/?error=no-permission");
  return access;
}

// Pages that show prices (price book, quotes, letters and proposals with fees) also need Pricing
// (Phase 2 batch, section 2). The database enforces the same rule.
export async function requireAccessWithPricing(area: Area, level: "view" | "edit" = "view"): Promise<Access> {
  const access = await requireAccess(area, level);
  if (!canView(access, "pricing")) redirect("/?error=pricing-needed");
  return access;
}

// Admin: Edit on Staff accounts and Settings (piece R3a-1). Optionally also Edit on the area the page changes.
export function isAdmin(access: Access, area?: Area) {
  return access.admin && (!area || canEdit(access, area));
}
export async function requireAdmin(area?: Area): Promise<Access> {
  const access = await requireAccess();
  if (!isAdmin(access, area)) redirect("/?error=admin-only");
  return access;
}

// Round 19: the letter types a person may prepare and see (the Letters boxes on their role).
export function letterTypes(access: Access): ("corporate" | "t1")[] {
  const t: ("corporate" | "t1")[] = [];
  if (access.letters?.corporate) t.push("corporate");
  if (access.letters?.t1) t.push("t1");
  return t;
}
