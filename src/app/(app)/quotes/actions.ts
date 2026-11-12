"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";

// Staff record that the client said no. The database checks the permission and the status again.
export async function declineQuote(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = String(formData.get("back") ?? "/quotes");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/quotes";
  const access = await getAccess();
  if (!access || !(canEdit(access, "leads") || canEdit(access, "documents"))) redirect(withMessage(safeBack, "error", "You need Edit on Leads to change a quote."));
  const { error } = await (await createClient()).rpc("mark_quote_declined", { p_id: id });
  revalidatePath("/quotes"); revalidatePath("/leads"); revalidatePath("/engagement-letters"); revalidatePath("/");
  redirect(withMessage(safeBack, error ? "error" : "msg", error ? error.message : "Marked declined."));
}
