"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

const PAGE = "/admin/settings/signing-email";

export async function saveSigningEmail(formData: FormData) {
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage(PAGE, "error", "Only an owner can change how signing emails are sent."));
  const on = (k: string) => formData.get(k) === "on";
  const { error } = await (await createClient()).rpc("set_signing_email", { p_letters: on("letters"), p_quotes: on("quotes"), p_proposals: on("proposals") });
  revalidatePath(PAGE);
  redirect(withMessage(PAGE, error ? "error" : "msg", error ? error.message : "Saved."));
}
