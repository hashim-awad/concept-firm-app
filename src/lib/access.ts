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
  is_owner: boolean;
  permissions: Record<Area, Level>;
};

// The signed-in staff member's access, from the database. Null if not active staff.
export async function getAccess(): Promise<Access | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return null;
  return data as Access;
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

export async function requireOwner(): Promise<Access> {
  const access = await requireAccess();
  if (!access.is_owner) redirect("/?error=owners-only");
  return access;
}
