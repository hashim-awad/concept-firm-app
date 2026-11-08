"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { withMessage } from "@/lib/messages";

export async function requestReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.siteUrl()}/auth/confirm?next=/set-password`,
  });
  // Same message whether or not the email exists, so the page does not reveal who has a login.
  redirect(withMessage("/login", "msg", "If that email has a login, a reset link is on its way."));
}
