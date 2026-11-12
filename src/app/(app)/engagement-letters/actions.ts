"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { withMessage } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { sendLetterEmail, signingEmailOn } from "@/lib/email/signing";

// Send (or send again) a New letter's signing email from Studio, when Settings has it on.
export async function sendLetterEmailNow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = `/engagement-letters/${id}`;
  const access = await getAccess();
  if (!access || !canEdit(access, "documents")) redirect(withMessage(back, "error", "You need Edit on Documents to send a letter."));
  if (!(await signingEmailOn("letters"))) redirect(withMessage(back, "error", "Sending from Studio is off for New letters (Settings, Signing emails)."));
  // The letter must be one this person can see, still waiting for signature.
  const { data: q } = await (await createClient()).from("quotes").select("id, kind, status").eq("id", id).maybeSingle();
  if (!q || q.kind !== "letter" || !["sent", "viewed"].includes(q.status)) redirect(withMessage(back, "error", "Only a letter waiting for signature can be sent."));
  const r = await sendLetterEmail(id);
  revalidatePath(back);
  redirect(withMessage(back, r.ok ? "msg" : "error", r.ok ? `Sent from ${r.from} to ${r.to.join(", ")}.` : `Not sent: ${r.error}`));
}
