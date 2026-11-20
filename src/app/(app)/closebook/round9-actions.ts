"use server";
// Step 5, round 9 (Hashim, Nov 27, 2026): the revenue check (expenses paid personally retired in piece 4b). Every rule is
// checked again in the database; these only carry what the preparer typed and the files attached.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// Round 15b: each action lands back on its own paper of step 5.
const back = (id: string, paper = "revenue") => `/closebook/${id}?step=entries&paper=${paper}`;
// Piece 7: step 8's GST/HST revenue box sends its own page back (same file only).
const dest = (id: string, to: string, paper = "revenue") => (to.startsWith(`/closebook/${id}?`) ? to : back(id, paper));
const done = (id: string, error: { message: string } | null, ok: string, paper = "revenue", to = ""): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(dest(id, to, paper), error ? "error" : "msg", error ? error.message : ok));
};
async function editor(id: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back(id), "error", "You need Edit on Closebook."));
}
// A file kept in the private documents store, under the file's folder.
async function store(id: string, folder: string, file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) redirect(withMessage(back(id), "error", `${file.name} is over 20 MB. Nothing was saved.`));
  const path = `closebook/${id}/${folder}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) redirect(withMessage(back(id), "error", `${file.name} was not saved: ${up.error.message}. Nothing was saved.`));
  return path;
}
const fileOf = (f: FormData, k: string) => { const x = f.get(k); return x instanceof File && x.size > 0 ? x : null; };

// A1: a source, its total typed and its report attached.
export async function addRevenueSource(formData: FormData) {
  const id = s(formData, "file_id"), to = s(formData, "back");
  await editor(id);
  const amount = parseAmount(s(formData, "amount"));
  if (amount === null) redirect(withMessage(dest(id, to), "error", "Type the total from the report, for example 152,400.00."));
  const report = fileOf(formData, "report");
  if (!report) redirect(withMessage(dest(id, to), "error", "Attach the report. Nothing was saved."));
  const path = await store(id, "revenue", report!);
  const { error } = await (await createClient()).rpc("cb_add_revenue_source", {
    p_file: id, p_kind: s(formData, "kind"), p_payer: s(formData, "payer"), p_label: s(formData, "label"), p_amount: amount! / 100, p_attachment: path,
  });
  done(id, error, "Source added.", "revenue", to);
}

export async function removeRevenueSource(formData: FormData) {
  const id = s(formData, "file_id"), to = s(formData, "back");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_remove_revenue_source", { p_source: s(formData, "source") });
  done(id, error, "Source removed.", "revenue", to);
}

export async function saveRevenueCheck(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_save_revenue_check", {
    p_file: id, p_explanation: s(formData, "explanation"), p_gst_explanation: s(formData, "gst_explanation"), p_t4a_explanation: s(formData, "t4a_explanation"),
    p_t4a_none: formData.get("t4a_none") === "on",
  });
  done(id, error, "Saved.");
}

export async function acceptRevenueDifference(formData: FormData) {
  const id = s(formData, "file_id"), to = s(formData, "back");
  const { error } = await (await createClient()).rpc("cb_accept_revenue_difference", { p_file: id, p_check: s(formData, "check") || "revenue" });
  done(id, error, "Difference accepted.", "revenue", to);
}

// Piece 7: "+ Add revenue check" on step 5, and step 8's note on the GST/HST revenue difference.
export async function addRevenueCheck(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_add_revenue_check", { p_file: id });
  done(id, error, "Revenue check added.");
}
export async function saveGstRevenueNote(formData: FormData) {
  const id = s(formData, "file_id"), to = s(formData, "back");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_save_gst_revenue_note", { p_file: id, p_note: s(formData, "note") });
  done(id, error, "Saved.", "revenue", to);
}

// A4: the fix, made from the check: one debit and one credit for the same amount.
const target = (v: string) => (v.startsWith("chart:") ? { chart: v.slice(6) } : v.startsWith("line:") ? { line: v.slice(5) } : { account: v });
export async function addRevenueEntry(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const amount = parseAmount(s(formData, "amount"));
  const dr = s(formData, "debit"), cr = s(formData, "credit"), memo = s(formData, "memo");
  if (!amount || amount < 0) redirect(withMessage(back(id), "error", "Type the amount of the fix. Nothing was saved."));
  if (!dr || !cr || dr === cr) redirect(withMessage(back(id), "error", "Choose two different accounts. Nothing was saved."));
  const { error } = await (await createClient()).rpc("cb_add_revenue_entry", {
    p_file: id, p_note: memo, p_reverse: false,
    p_lines: [{ ...target(dr), amount: amount! / 100, memo }, { ...target(cr), amount: -amount! / 100, memo }],
  });
  done(id, error, "Entry made from the revenue check. It is on the reviewer's list in step 7.");
}

// Piece 4b (Hashim, Nov 18, 2026): the round 9 "Expenses paid personally" form, its line-account choice and its
// settings are retired; the schedule in the entry window replaces them (src/lib/closebook/vehicle-save.ts).
