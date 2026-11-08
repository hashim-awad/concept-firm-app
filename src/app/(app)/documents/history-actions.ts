"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { todayToronto } from "@/lib/dates";

// Studio: mark a sent proposal Accepted (with the option chosen), Declined or Expired.
export async function markProposal(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const result = String(formData.get("result") ?? "");
  const supabase = await createClient();
  const { data: p } = await supabase.from("proposals").select("options_data, status").eq("id", id).maybeSingle();
  const back = "/documents?tab=proposals";
  if (!p) redirect(withMessage(back, "error", "Proposal not found."));
  let patch: Record<string, string>;
  if (result === "decl") patch = { status: "Declined" };
  else if (result === "exp") patch = { status: "Expired" };
  else if (/^acc:\d$/.test(result)) {
    const o = (p!.options_data as { o?: { n: string }[] } | null)?.o?.[Number(result.slice(4))];
    if (!o) redirect(withMessage(back, "error", "That option was not found."));
    patch = { status: "Accepted", chosen_option: o!.n };
  } else redirect(withMessage(back, "error", "Choose a result."));
  const { error } = await supabase.from("proposals").update(patch!).eq("id", id);
  revalidatePath("/documents");
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Proposal updated."));
}

const ENG_DATES = ["el_issued", "el_signed"] as const;

// Studio engagement editor (Phase 1 part): dates, payment method, AB/BC confirmation,
// CRA authorization for T1, cancelled, notes. Status follows the dates (Studio deriveStatus).
export async function updateEngagement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = `/documents/engagements/${id}`;
  const d: Record<string, string> = {};
  for (const k of ENG_DATES) d[k] = String(formData.get(k) ?? "");
  const t = todayToronto();
  const E: string[] = [];
  for (const k of ENG_DATES) if (d[k] && d[k] > t) E.push(`${k === "el_issued" ? "EL issued" : "EL signed"} cannot be a future date.`);
  if (d.el_signed && d.el_issued && d.el_signed < d.el_issued) E.push("EL signed cannot be before EL issued.");
  if (d.el_signed && !d.el_issued) E.push("Enter the EL issued date before the EL signed date.");
  if (E.length) redirect(withMessage(back, "error", E.join(" ")));
  const supabase = await createClient();
  const { data: cur } = await supabase.from("engagements").select("status, type").eq("id", id).maybeSingle();
  if (!cur) redirect(withMessage("/documents", "error", "Engagement not found."));
  const cancelled = formData.get("cancelled") === "on";
  // Later stages (draft package, MAL, issued) belong to Phase 3; keep them if already set.
  const later = ["Draft package sent", "MAL signed", "Issued"].includes(cur!.status);
  const status = cancelled ? "Cancelled" : later ? cur!.status : d.el_signed ? "EL signed" : d.el_issued ? "EL sent" : "EL drafted";
  const patch: Record<string, unknown> = {
    status, el_issued: d.el_issued || null, el_signed: d.el_signed || null, notes: String(formData.get("notes") ?? "").trim(),
  };
  if (formData.has("registration_confirmed")) patch.registration_confirmed = formData.get("registration_confirmed") === "on";
  else if (formData.has("has_registration")) patch.registration_confirmed = false;
  if (cur!.type === "T1 personal") {
    patch.cra_authorization = String(formData.get("cra_authorization") ?? "Requested");
    patch.cra_request_date = String(formData.get("cra_request_date") ?? "") || null;
  } else patch.payment_method = String(formData.get("payment_method") ?? "");
  const { error } = await supabase.from("engagements").update(patch).eq("id", id);
  revalidatePath("/documents");
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : `Saved. Status: ${status}.`));
}
