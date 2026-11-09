"use server";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type StartState = { error: string } | null;

// Submits the "About you" answers as a lead. Spam: a hidden trap field and a minimum fill time here;
// the database adds a submission limit per visitor (address kept only as a keyed hash).
export async function submitStart(_prev: StartState, formData: FormData): Promise<StartState> {
  const route = formData.get("route") === "company" ? "company" : "personal";
  const elapsed = Date.now() - Number(formData.get("t") ?? 0);
  if (String(formData.get("website") ?? "") !== "" || !(elapsed > 3000)) redirect(`/start/thanks?r=${route}`);
  const contact = {
    first_name: String(formData.get("first_name") ?? "").trim(), last_name: String(formData.get("last_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(), phone: route === "personal" ? String(formData.get("phone") ?? "").trim() : "",
    province: String(formData.get("province") ?? ""),
  };
  if (!contact.first_name || !contact.last_name) return { error: "Enter your first and last name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return { error: "Enter a valid email address." };
  if (route === "personal" && !/^[0-9 ()+.-]{7,25}$/.test(contact.phone)) return { error: "Enter your phone number, for example 226-789-9591." };
  if (!contact.province) return { error: "Choose your province or territory." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const ipHash = createHmac("sha256", env.supabaseSecretKey()).update(ip).digest("hex");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_lead", { p_route: route, p_contact: contact, p_answers: {}, p_ip_hash: ipHash });
  if (error) return { error: error.message };
  redirect(`/start/thanks?r=${route}`);
}
