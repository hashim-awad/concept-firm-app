"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { createStudioEngine } from "@/lib/studio/engine.generated";

// Owner approves a trial template for client use at the current wording version.
export async function approveTemplate(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const e = createStudioEngine({});
  const t = (e.TEMPLATES as { k: string; name: string; basis: string; status: string }[]).find((x) => x.k === key);
  const back = "/admin/price-book/templates";
  if (!t || t.status !== "Trial") redirect(withMessage(back, "error", "Only a trial template can be approved."));
  const supabase = await createClient();
  const { error } = await supabase.from("template_approvals").insert({ template_key: t!.k, template_name: t!.name, el_version: e.EL_VERSION, basis: t!.basis ?? "" });
  revalidatePath(back);
  redirect(withMessage(back, error ? "error" : "msg", error ? (error.message.includes("row-level") ? "Only an owner can approve templates." : error.message) : `Approved for client use at ${e.EL_VERSION}.`));
}
