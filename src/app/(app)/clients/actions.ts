"use server";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { todayToronto } from "@/lib/dates";
import { clientErrors, type ClientForm } from "@/lib/clients";

// Studio's client editor save: same checks, and the registry check is dated when ticked.
export async function saveClientRecord(id: string | null, form: ClientForm, wasVerified: boolean, oldName: string, reticked: boolean) {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return { ok: false as const, error: "You do not have permission to change clients." };
  const errors = clientErrors(form, { wasVerified, oldName, retickedAfterChange: reticked });
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
    province: form.province, year_end_md: form.year_end_md.trim(), basis: form.basis, custom_basis_wording: form.custom_basis_wording.trim(),
    third_party_user: form.third_party_user.trim(), third_party_basis: form.third_party_basis, status: form.status, notes: form.notes.trim(),
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
