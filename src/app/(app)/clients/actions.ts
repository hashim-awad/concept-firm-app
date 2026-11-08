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
  const row = {
    kind: form.kind, legal_name: form.legal_name.trim(), entity_type: form.kind === "individual" ? "Individual" : form.entity_type,
    signing_officer: form.signing_officer.trim(), signer_title: form.signer_title.trim(), salutation: form.salutation.trim(), email: form.email.trim(),
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
