"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

const MIN_PASSWORD_LENGTH = 12;

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(withMessage("/set-password", "error", `Use at least ${MIN_PASSWORD_LENGTH} characters.`));
  }
  if (password !== confirm) {
    redirect(withMessage("/set-password", "error", "The two passwords do not match."));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(withMessage("/set-password", "error", "Could not save the password. Try a different one."));
  }
  redirect(withMessage("/", "msg", "Password saved."));
}
