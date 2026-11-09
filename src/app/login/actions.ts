"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(withMessage("/login", "error", "Email or password is not correct."));
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
