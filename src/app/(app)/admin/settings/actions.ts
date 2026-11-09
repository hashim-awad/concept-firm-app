"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

const PAGE = "/admin/settings";

export async function saveLeadAssignment(formData: FormData) {
  const mode = String(formData.get("mode") ?? "unassigned");
  const staffIds =
    mode === "single" ? [String(formData.get("single_staff_id") ?? "")].filter(Boolean)
    : mode === "rotate" ? formData.getAll("rotate_staff_ids").map(String)
    : [];
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", {
    p_key: "lead_assignment",
    p_value: { mode, staff_ids: staffIds },
  });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Lead assignment saved."));
}

export async function saveRetention(formData: FormData) {
  const months = Number(formData.get("months"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", { p_key: "retention_months", p_value: months });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Retention period saved."));
}

// Signer names per document type (decision 25). Owners only; the database checks again.
export async function saveSigner(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", {
    p_key: key,
    p_value: { name: String(formData.get("name") ?? ""), title: String(formData.get("title") ?? "") },
  });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Signer name saved."));
}

// The signature image goes to private storage (owners only), never into the code.
export async function uploadSignature(formData: FormData) {
  const file = formData.get("signature");
  const fail = (m: string) => redirect(withMessage(PAGE, "error", m));
  if (!(file instanceof File) || file.size === 0) fail("Choose the signature image (PNG).");
  const f = file as File;
  if (f.size > 1024 * 1024) fail("The image must be under 1 MB.");
  const bytes = Buffer.from(await f.arrayBuffer());
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(PNG)) fail("The signature must be a PNG image, ideally with a clear background.");
  const supabase = await createClient();
  const up = await supabase.storage.from("brand-private").upload("signature/signature.png", bytes, { contentType: "image/png", upsert: true });
  if (up.error) fail("Only an owner can upload the signature.");
  const { error } = await supabase.rpc("update_setting", { p_key: "signature_image", p_value: { uploaded: true } });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Signature saved. It appears only on Final letters."));
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// Business hours (Toronto time): each day open with a start and end, or closed.
export async function saveBusinessHours(formData: FormData) {
  const value = Object.fromEntries(DAYS.map((d) => [d, formData.get(`${d}_open`) === "on" ? [String(formData.get(`${d}_start`) ?? ""), String(formData.get(`${d}_end`) ?? "")] : null]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", { p_key: "business_hours", p_value: value });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Business hours saved."));
}

export async function saveBookingLink(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", { p_key: "booking_link", p_value: String(formData.get("url") ?? "").trim() });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Booking link saved."));
}

export async function saveT1Rules(formData: FormData) {
  const num = (k: string) => String(formData.get(k) ?? "").replace(/[$,\s]/g, "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", { p_key: "t1_rules", p_value: {
    moving_km: num("moving_km"), t1135_simple_over: num("t1135_simple_over"), t1135_detailed_from: num("t1135_detailed_from"), checked_on: String(formData.get("checked_on") ?? ""),
  } });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "T1 rule values saved."));
}
