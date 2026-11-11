"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { LEAD_STATUS } from "@/lib/leads/provinces";
import { runLeadAlerts, sendLeadAlertNow } from "@/lib/leads/alerts";

// Staff update a lead: status, source, notes; owners also reassign. What the client entered stays as sent.
export async function updateLead(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const page = `/leads/${id}`;
  const access = await getAccess();
  if (!access || !canEdit(access, "leads")) redirect(withMessage(page, "error", "You do not have permission to change leads."));
  const status = String(formData.get("status") ?? "");
  const patch: Record<string, unknown> = { notes: String(formData.get("notes") ?? "").trim(), source: String(formData.get("source") ?? "Website") };
  if (LEAD_STATUS[status]) patch.status = status;
  if (access!.is_owner && formData.has("assigned_to")) patch.assigned_to = String(formData.get("assigned_to")) || null;
  // Company leads: the legal name and the confirmed year-end staff enter, and the first-year checklist.
  if (formData.has("company_name")) patch.company_name = String(formData.get("company_name") ?? "").trim().slice(0, 200);
  if (formData.has("year_end")) { const ye = String(formData.get("year_end") ?? ""); patch.year_end = /^\d{4}-\d{2}-\d{2}$/.test(ye) ? ye : null; }
  if (formData.has("client_kind")) { const k = String(formData.get("client_kind")); patch.client_kind = ["agent", "team", "other"].includes(k) ? k : null; }
  if (formData.has("company_name") && formData.get("status") === "signed") patch.first_year_tag_done = formData.get("first_year_tag_done") === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  // A draft year-end quote picks up a corrected legal name or year-end (a sent quote never changes).
  if (!error && formData.has("company_name")) {
    const { data: q } = await supabase.from("quotes").select("status").eq("lead_id", id).maybeSingle();
    if (q?.status === "draft") await supabase.rpc("create_corporate_quote", { p_lead: id });
  }
  revalidatePath("/leads"); revalidatePath(page); revalidatePath("/");
  redirect(withMessage(page, error ? "error" : "msg", error ? error.message : "Lead saved."));
}

// Owners: send the new-lead alert email now and see the result (for a failed or missing alert).
export async function sendAlertNow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const page = `/leads/${id}`;
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage(page, "error", "Only an owner can send the alert again."));
  const r = await sendLeadAlertNow(id);
  revalidatePath(page);
  redirect(withMessage(page, r.sent > 0 ? "msg" : "error", r.sent > 0 ? `Alert email sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.${r.problem ? ` Problem with some: ${r.problem}` : ""}` : `Alert email not sent. Reason: ${r.problem || "unknown"}`));
}

// Owners: run the lead alert check now (the same one the scheduler runs) and see what it did.
export async function checkAlertsNow() {
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage("/leads", "error", "Only an owner can run the alert check."));
  let text: string, kind: "msg" | "error";
  try {
    const r = await runLeadAlerts();
    kind = r.problems.length ? "error" : "msg";
    text = `Checked ${r.checked} lead${r.checked === 1 ? "" : "s"}. Reminders due: ${r.due}, sent: ${r.reminders}. First alerts sent: ${r.newSent}.${r.problems.length ? ` Problem: ${r.problems.join(" | ")}` : ""}`;
  } catch (e) {
    kind = "error";
    text = `The check failed: ${e instanceof Error ? e.message : "unknown error"}`;
  }
  revalidatePath("/leads");
  redirect(withMessage("/leads", kind, text));
}
