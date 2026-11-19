"use server";
import { revalidatePath } from "next/cache";
import { withMessage } from "@/lib/messages";
import { redirect } from "next/navigation";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { todayToronto } from "@/lib/dates";
import { clientErrors, THIRD_PARTY_BASIS, type ClientForm } from "@/lib/clients";

// Studio's client editor save: same checks, and the registry check is dated when ticked.
export async function saveClientRecord(id: string | null, form: ClientForm, wasVerified: boolean, oldName: string, reticked: boolean) {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return { ok: false as const, error: "You do not have permission to change clients." };
  // Round 18: the basis and the users of the statements have their own form (saveClientStatements), so
  // the details form does not check or write them on an existing client. A new client still starts with them.
  const errors = clientErrors(id ? { ...form, basis: "standard" } : form, { wasVerified, oldName, retickedAfterChange: reticked });
  if (errors.length) return { ok: false as const, error: errors.join(" ") };
  const supabase = await createClient();
  // Hashim, Nov 12: a blank salutation defaults to the first name of the person who signs (the signing
  // officer, or the individual), so a Final letter is never stopped by it.
  const who = (form.kind === "individual" ? form.legal_name : form.signing_officer).trim();
  const salutation = form.salutation.trim() || (who.split(/\s+/)[0] ?? "");
  const row = {
    kind: form.kind, legal_name: form.legal_name.trim(), entity_type: form.kind === "individual" ? "Individual" : form.entity_type,
    signing_officer: form.signing_officer.trim(), signer_title: form.signer_title.trim(), salutation, email: form.email.trim(),
    street_address: form.street_address.trim(), address_line2: form.address_line2.trim(), city: form.city.trim(), postal_code: form.postal_code.trim().toUpperCase(),
    province: form.province, year_end_md: form.year_end_md.trim(), status: form.status, notes: form.notes.trim(),
    ...(id ? {} : { basis: form.basis, custom_basis_wording: form.custom_basis_wording.trim(), third_party_user: form.third_party_user.trim(), third_party_basis: form.third_party_basis }),
  };
  const nameChanged = row.legal_name !== oldName.trim();
  const verify = form.name_verified
    ? (!wasVerified || nameChanged ? { name_verified: true, name_verified_by: access.staff_id, name_verified_on: todayToronto() } : {})
    : { name_verified: false, name_verified_by: null, name_verified_on: null };
  const q = id
    ? supabase.from("clients").update({ ...row, ...verify }).eq("id", id).select("id").single()
    : supabase.from("clients").insert({ ...row, ...verify }).select("id").single();
  const { data, error } = await q;
  if (error || !data) return { ok: false as const, error: error?.message ?? "Could not save the client." };
  revalidatePath("/clients");
  return { ok: true as const, id: data.id as string };
}

// Round 18: the Financial statements card on the client page. The basis of accounting and the users of the
// statements (up to 5, each a lender or other, with the basis it needs). The older third_party_user and
// third_party_basis columns are filled by the database from the first user: never written here. The
// activity log records the change, and saving the users clears an owner's "users differ" warning.
export type StatementUser = { kind: "lender" | "other"; name: string; basis_needed: string };
export async function saveClientStatements(id: string, input: { basis: string; custom_basis_wording: string; users: StatementUser[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return { ok: false, error: "You do not have permission to change clients." };
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "Client not found." };
  const errors: string[] = [];
  const basis = String(input?.basis ?? "");
  const wording = String(input?.custom_basis_wording ?? "").trim();
  if (!["standard", "cash", "custom"].includes(basis)) errors.push("Choose the basis of accounting.");
  if (basis === "custom" && wording.length < 40) errors.push("Write the custom basis wording: at least 40 characters.");
  const list = Array.isArray(input?.users) ? input.users : [];
  if (list.length > 5) errors.push("List up to 5 users of the statements.");
  const users: StatementUser[] = [];
  const seen = new Set<string>();
  list.slice(0, 5).forEach((u, i) => {
    const n = i + 1;
    const kind = u?.kind, name = String(u?.name ?? "").trim(), need = String(u?.basis_needed ?? "");
    if (kind !== "lender" && kind !== "other") errors.push(`User ${n}: choose A lender or Other.`);
    if (name.length < 2 || name.length > 120) errors.push(`User ${n}: the name must be 2 to 120 characters.`);
    if (need !== "" && !THIRD_PARTY_BASIS.includes(need)) errors.push(`User ${n}: choose the basis it needs from the list.`);
    if (name && seen.has(name.toLowerCase())) errors.push(`User ${n}: ${name} is listed twice.`);
    seen.add(name.toLowerCase());
    users.push({ kind: kind === "lender" ? "lender" : "other", name, basis_needed: need });
  });
  if (errors.length) return { ok: false, error: errors.join(" ") };
  const supabase = await createClient();
  const { data: c } = await supabase.from("clients").select("kind").eq("id", id).maybeSingle();
  if (!c) return { ok: false, error: "Client not found." };
  if (c.kind !== "corporation") return { ok: false, error: "Financial statements are set for corporations only." };
  const { data, error } = await supabase.from("clients").update({ basis, custom_basis_wording: wording, statement_users: users }).eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  if (!data) return { ok: false, error: "Could not save. You need Edit on Clients." };
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { ok: true };
}

// Per client, set by staff: balance-due period (2 or 3 months) and "Exclude from deadlines" (decision 43).
export async function saveT2Settings(formData: FormData): Promise<void> {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return;
  const id = String(formData.get("id") ?? "");
  const months = formData.get("months") === "3" ? 3 : 2;
  const supabase = await createClient();
  await supabase.from("clients").update({ t2_balance_due_months: months, t2_exclude_deadlines: formData.get("exclude") === "on" }).eq("id", id);
  revalidatePath(`/clients/${id}`);
  revalidatePath("/");
}

// The Letter Builder's Client step (Hashim, Nov 12): tick the legal name as checked against the registry
// (corporations) or ID/CRA records (individuals) without leaving the letter. Recorded on the client
// with who and when, as on the client page.
export async function verifyClientName(id: string): Promise<{ ok: boolean; error?: string }> {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return { ok: false, error: "You need Edit on Clients to confirm a legal name." };
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "Client not found." };
  const { error } = await (await createClient()).from("clients").update({ name_verified: true, name_verified_by: access.staff_id, name_verified_on: todayToronto() }).eq("id", id);
  return error ? { ok: false, error: "Could not save. You need Edit on Clients." } : { ok: true };
}

// People are not in the TaxDome import (it reads T2 companies): an Admin marks a waiting client matched.
export async function markInTaxDome(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { error } = await (await createClient()).rpc("mark_client_in_taxdome", { p_client: id });
  revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
  redirect(withMessage(`/clients/${id}`, error ? "error" : "msg", error ? error.message : "Marked as matched in TaxDome. The client is Active."));
}
