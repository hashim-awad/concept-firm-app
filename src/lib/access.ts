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
  // Round 19: the letter types the person's role may prepare and see (ticked on the role). Owners: both.
  letters: { t1: boolean; corporate: boolean };
};

// The signed-in staff member's access, from the database. Null if not active staff.
export async function getAccess(): Promise<Access | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return null;
  const a = data as Access;
  const l = (a.letters ?? {}) as Partial<Access["letters"]>;
  return { ...a, letters: { t1: l.t1 === true, corporate: l.corporate === true } };
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

// Round 19: the letter types a person may prepare and see. Owners always have both.
export function letterTypes(access: Access): ("corporate" | "t1")[] {
  const t: ("corporate" | "t1")[] = [];
  if (access.is_owner || access.letters?.corporate) t.push("corporate");
  if (access.is_owner || access.letters?.t1) t.push("t1");
  return t;
}
