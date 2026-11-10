"use server";
// T1 quote actions on a lead (batch sections 6 to 8).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { formatDate } from "@/lib/dates";

export async function prepareQuote(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_t1_quote", { p_lead: leadId });
  if (error) redirect(withMessage(`/leads/${leadId}`, "error", error.message));
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}/quote`);
}

// After the email went out from Outlook: starts the 21-day clock and marks the lead Quote sent.
export async function markQuoteSent(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  const page = `/leads/${leadId}/quote`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_t1_quote_sent", { p_id: String(formData.get("quote_id") ?? "") });
  revalidatePath(page);
  revalidatePath(`/leads/${leadId}`);
  redirect(withMessage(page, error ? "error" : "msg", error ? error.message : `Marked as sent. The quote is valid until ${formatDate(String(data))}.`));
}
