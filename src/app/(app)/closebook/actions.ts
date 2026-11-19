"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { readXlsx } from "@/lib/closebook/xlsx";
import { parseCsv } from "@/lib/closebook/seed";
import { readAccountList, readTrialBalance } from "@/lib/closebook/tb-import";
import { suggestLine, type Line } from "@/lib/closebook/matching";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFile } from "@/lib/closebook/server";
import { DATA_SOURCE, MONTHLY_READY, fullYearStart, yearPeriod, type DataSource } from "@/lib/closebook/files";
import { loadEntryForm } from "@/lib/closebook/entry-form-server";
import { planEntry, type FormHead, type FormLine } from "@/lib/closebook/entry-form";
import { scheduleSaveArgs, type SchedForm } from "@/lib/closebook/vehicle-save";
import { entryNo } from "@/lib/closebook/reports";
import { STEP_KEYS, stepTitle, type StepKey } from "@/lib/closebook/steps";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// New file (batch section 1): client, year-end, file type and books, preparer and reviewer.
export async function createFile(formData: FormData) {
  const client = s(formData, "client");
  const back = `/closebook/new?client=${client}`;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook to start a file."));
  const yearEnd = s(formData, "year_end");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yearEnd)) redirect(withMessage(back, "error", "Enter the year-end date."));
  // A blank start means a full year: the day after the same date last year.
  const yearStart = s(formData, "year_start") || fullYearStart(yearEnd);
  const period = yearPeriod(yearStart, yearEnd);
  if (period.text === "check the dates") redirect(withMessage(back, "error", "The start must be on or before the year-end."));
  const reason = period.full ? "" : s(formData, "reason");
  if (!period.full && !reason) redirect(withMessage(back, "error", "Enter the reason the year is not 12 months."));
  // Data source (round 21): one question, mapped to how the file works (file type and books).
  const source = s(formData, "data_source") as DataSource;
  if (!(source in DATA_SOURCE) || (source === "ours" && !MONTHLY_READY)) redirect(withMessage(back, "error", "Choose the data source."));
  const type = DATA_SOURCE[source].file_type;
  const books = DATA_SOURCE[source].books;
  const { data, error } = await (await createClient()).rpc("cb_create_file", {
    p_client: client, p_year_end: yearEnd, p_year_start: yearStart, p_reason: reason, p_type: type, p_books: books,
    p_preparer: s(formData, "preparer"), p_reviewer: s(formData, "reviewer"),
  });
  if (error) redirect(withMessage(back, "error", error.message));
  revalidatePath("/closebook"); revalidatePath("/closebook/files");
  redirect(withMessage(`/closebook/${data}`, "msg", "File started. The core documents are in place."));
}

// Import a trial balance (CSV or Excel) into this year's or last year's column (batch F1).
export async function importTrialBalance(formData: FormData) {
  const id = s(formData, "file_id");
  const back = `/closebook/${id}?tab=tb`;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook to import."));
  const upload = formData.get("upload");
  if (!(upload instanceof File) || upload.size === 0) redirect(withMessage(back, "error", "Choose the trial balance file (CSV or Excel)."));
  const f = upload as File;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let table;
  try {
    table = /\.xlsx$/i.test(f.name) ? readXlsx(bytes)[0]?.rows ?? [] : parseCsv(new TextDecoder().decode(bytes));
  } catch {
    redirect(withMessage(back, "error", "The file could not be read. Export it again as CSV or Excel (.xlsx)."));
  }
  const tb = readTrialBalance(table);
  if (tb.error) redirect(withMessage(back, "error", tb.error));
  const { data, error } = await (await createClient()).rpc("cb_import_tb", {
    p_file: id, p_target: s(formData, "target") === "last_year" ? "last_year" : "this_year", p_source: s(formData, "source"), p_file_name: f.name, p_rows: tb.rows,
  });
  if (error) redirect(withMessage(back, "error", error.message));
  // Piece R2 (D5): no automatic matching after the import; step 4 suggests a master account for each account.
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, "msg", `Imported ${data} accounts. Assign them in step 4.`));
}

// ---------- Matching (batch 4.5) ----------

const tbBack = (id: string, extra = "") => `/closebook/${id}?tab=tb${extra}`;
async function editor(back: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
}

// Match every account not yet matched: the client's history first (in the database), then name
// suggestions; anything unclear goes to the reviewer's list. Runs by itself after each import.
async function matchFile(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const [{ data: accounts }, { data: lines }] = await Promise.all([
    supabase.from("cb_accounts").select("id, number, name, account_type").eq("file_id", id).is("line_no", null).eq("needs_reviewer", false),
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, locked"),
  ]);
  const suggestions = ((accounts ?? []) as { id: string; number: string; name: string; account_type: string | null }[]).map((a) => {
    const sg = suggestLine(a, (lines ?? []) as Line[]);
    return { account: a.id, line: sg.line, reason: sg.reason };
  });
  const { data } = await supabase.rpc("cb_apply_matching", { p_file: id, p_suggestions: suggestions });
  return (data ?? { history: 0, suggested: 0, reviewer: 0 }) as { history: number; suggested: number; reviewer: number };
}

// Round 6 item 1: the reviewer keeps an account on a line of another type, with a reason.
export async function confirmTypeInline(fileId: string, account: string, reason: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  if (!reason.trim()) return "Type the reason for keeping this account on a line of another type.";
  const { error } = await (await createClient()).rpc("cb_confirm_type", { p_account: account, p_reason: reason });
  if (error) return error.message;
  revalidatePath(`/closebook/${fileId}`);
  return null;
}

// Round 10 fix 5: the reviewer keeps a balance on the wrong side of its line, with a reason.
export async function confirmSideInline(fileId: string, account: string, reason: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  if (!reason.trim()) return "Type the reason for keeping this balance on this line.";
  const { error } = await (await createClient()).rpc("cb_confirm_side", { p_account: account, p_reason: reason });
  if (error) return error.message;
  revalidatePath(`/closebook/${fileId}`);
  return null;
}

// Round 6 item 2: the QuickBooks Online Account List, for each account's type.
export async function importAccountList(formData: FormData) {
  const id = s(formData, "file_id");
  const want = s(formData, "back");
  const back = want.startsWith(`/closebook/${id}?`) ? want : `/closebook/${id}?step=records`;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook to import."));
  const upload = formData.get("upload");
  if (!(upload instanceof File) || upload.size === 0) redirect(withMessage(back, "error", "Choose the Account List file (CSV or Excel)."));
  const f = upload as File;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let table;
  try {
    table = /\.xlsx$/i.test(f.name) ? readXlsx(bytes)[0]?.rows ?? [] : parseCsv(new TextDecoder().decode(bytes));
  } catch {
    redirect(withMessage(back, "error", "The file could not be read. Export it again as CSV or Excel (.xlsx)."));
  }
  const list = readAccountList(table);
  if (list.error) redirect(withMessage(back, "error", list.error));
  const { data, error } = await (await createClient()).rpc("cb_import_account_list", { p_file: id, p_file_name: f.name, p_rows: list.rows });
  if (error) redirect(withMessage(back, "error", error.message));
  const r = data as { rows: number; matched: number; accounts_without: number };
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, "msg", `Read ${r.rows} accounts from the Account List. ${r.matched} account${r.matched === 1 ? "" : "s"} in the trial balance took their type from it.${r.accounts_without ? ` ${r.accounts_without === 1 ? "1 account still has no type: it shows" : `${r.accounts_without} accounts still have no type: they show`} "Type not checked" in step 8.` : ""}`));
}

// Row actions on the Trial balance tab: they save on the spot and return any problem as text.
export async function matchInline(fileId: string, account: string, line: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_map_account", { p_account: account, p_line: line });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

// Piece R1: step 8's GIFI line for the tax return (bank-statement files). An empty line goes back to the group's line.
export async function overrideInline(fileId: string, account: string, line: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_set_gifi_override", { p_account: account, p_line: line || null });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

export async function askReviewerInline(fileId: string, account: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_send_to_reviewer", { p_account: account, p_reason: "Preparer not sure" });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

export async function taxCodeInline(fileId: string, account: string, code: string): Promise<string | null> {
  const { error } = await (await createClient()).rpc("cb_set_tax_code", { p_account: account, p_code: code || null });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}




// ---------- Entries (batch 5.4, full files) ----------
// Round 15b: entries live on the Entries tab (CaseWare's Adjustments page) and open in a dialog.
const enBack = (id: string) => `/closebook/${id}?area=entries`;
const sameFile = (id: string, v: string) => (v.startsWith(`/closebook/${id}?`) ? v : "");

export async function addEntry(formData: FormData) {
  const id = s(formData, "file_id");
  // Where a refusal lands: the dialog it came from, so the reason shows by its Save button.
  const dialog = sameFile(id, s(formData, "back")) || enBack(id);
  await editor(dialog);
  // The form sends what the preparer typed; the lines and the sales tax are worked out again here, from
  // the database's own rates (round 2 item 11), and the database checks every rule again.
  let form: { head: FormHead; date: string; lines: FormLine[]; standard: string | null; seq?: string; origin?: string; edit?: string };
  try { form = JSON.parse(s(formData, "form")); } catch { redirect(withMessage(dialog, "error", "The entry could not be read. Nothing was saved.")); }
  const supabase = await createClient();
  const f = await loadFile(supabase, id);
  if (!f) redirect(withMessage(dialog, "error", "File not found."));
  const data = await loadEntryForm(supabase, f!.file, f!.client?.province ?? "ON", f!.client?.legal_name ?? "The client");
  // Piece 3: an entry made from a schedule (or one with schedule lines) is saved with its schedule.
  const sf = form! as SchedForm;
  if (sf.schedule || sf.lines.some((l) => l.sched)) return saveScheduleEntry(formData, supabase, f!, sf, data, dialog, id);
  const std = form!.standard ? data.standard.find((x) => x.id === form!.standard) ?? null : null;
  const plan = planEntry({ ...form!.head, reason: undefined }, form!.lines, new Map(data.opts.map((o) => [o.value, o])), new Map(data.codes.map((c) => [c.code, c])), data.ctx,
    new Map(data.gifiLines.map(([no, , type]) => [no, type])), std);
  if (plan.problems.length) redirect(withMessage(dialog, "error", `Nothing was saved. ${plan.problems[0]}`));
  const seq = /^\d{1,3}$/.test(String(form!.seq ?? "").trim()) ? Number(String(form!.seq).trim()) : null;
  // Attachments: kept in the private documents store, listed on the entry.
  const paths: string[] = [];
  const files = formData.getAll("attachments").filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length > 10) redirect(withMessage(dialog, "error", "Up to 10 attachments. Nothing was saved."));
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) redirect(withMessage(dialog, "error", `${file.name} is over 20 MB. Nothing was saved.`));
    const path = `closebook/${id}/entries/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) redirect(withMessage(dialog, "error", `${file.name} was not saved: ${up.error.message}. Nothing was saved.`));
    paths.push(path);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(form!.date) ? form!.date : null;
  const args = { p_kind: form!.head.kind, p_reason: plan.reason, p_note: form!.head.memo, p_reverse: form!.head.reverse, p_lines: plan.rpc, p_wp_ref: form!.head.wpRef,
    p_date: date, p_standard: form!.standard, p_seq: seq };
  let res: { data: unknown; error: { message: string } | null };
  if (form!.edit) {
    // Edit (CaseWare): piece 2, the entry changes in place (same id, number, creator, standard entry link); its
    // attachments are kept and new ones added. History records each change (cb_edit_entry).
    const { data: old } = await supabase.from("cb_entries").select("attachments").eq("id", form!.edit).eq("file_id", id).maybeSingle();
    res = await supabase.rpc("cb_edit_entry", { p_entry: form!.edit, ...args, p_attachments: [...((old?.attachments as string[] | null) ?? []), ...paths].slice(0, 10) });
  } else if (form!.origin === "revenue_check") {
    // Fix with an entry (round 9): an AJE with W/P ref "Revenue check", marked as made from the check.
    res = await supabase.rpc("cb_add_revenue_entry", { p_file: id, p_note: form!.head.memo, p_lines: plan.rpc, p_reverse: form!.head.reverse, p_seq: seq });
  } else {
    res = await supabase.rpc("cb_add_entry", { p_file: id, ...args, p_attachments: paths });
  }
  revalidatePath(`/closebook/${id}`);
  if (res.error) redirect(withMessage(dialog, "error", `Nothing was saved. ${res.error.message}`));
  const { data: e } = await supabase.from("cb_entries").select("needs_review").eq("id", res.data as string).maybeSingle();
  const msg = form!.edit ? "Entry changed. It goes to the reviewer again." : e?.needs_review === false ? "Standard entry added. It is under the review threshold, so no review is needed." : "Entry added. It goes to the reviewer.";
  const after = s(formData, "then") === "new" ? `${enBack(id)}&new=journal` : sameFile(id, s(formData, "done")) || enBack(id);
  redirect(withMessage(after, "msg", msg));
}

async function saveScheduleEntry(formData: FormData, supabase: Awaited<ReturnType<typeof createClient>>, f: NonNullable<Awaited<ReturnType<typeof loadFile>>>,
  form: SchedForm, data: Awaited<ReturnType<typeof loadEntryForm>>, dialog: string, id: string) {
  const paths: string[] = [];
  const files = formData.getAll("attachments").filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length > 10) redirect(withMessage(dialog, "error", "Up to 10 attachments. Nothing was saved."));
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) redirect(withMessage(dialog, "error", `${file.name} is over 20 MB. Nothing was saved.`));
    const path = `closebook/${id}/entries/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) redirect(withMessage(dialog, "error", `${file.name} was not saved: ${up.error.message}. Nothing was saved.`));
    paths.push(path);
  }
  const built = await scheduleSaveArgs(supabase, f, form, data, paths);
  if ("error" in built) redirect(withMessage(dialog, "error", `Nothing was saved. ${built.error}`));
  const res = await supabase.rpc("cb_save_schedule_entry", (built as { args: Record<string, unknown> }).args);
  revalidatePath(`/closebook/${id}`);
  if (res.error) redirect(withMessage(dialog, "error", `Nothing was saved. ${res.error.message}`));
  const { data: e } = await supabase.from("cb_entries").select("kind, number, seq").eq("id", res.data as string).maybeSingle();
  // The green pill (round 27): "Saved AJE 2026-003".
  const no = e ? entryNo(f.file.year_end, e as { kind: string; number: number; seq: number }) : "";
  const msg = e ? `Saved ${e.kind} ${no.split(" ")[0]}` : "Saved.";
  const after = s(formData, "then") === "new" ? `${enBack(id)}&new=journal` : sameFile(id, s(formData, "done")) || enBack(id);
  redirect(withMessage(after, "msg", msg));
}

export async function reviewEntry(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_review_entry", { p_entry: s(formData, "entry") });
  revalidatePath(`/closebook/${id}`);
  // Piece 5: back to the page the list was on (step 5 or the Entries tab).
  redirect(withMessage(sameFile(id, s(formData, "back")) || enBack(id), error ? "error" : "msg", error ? error.message : "Entry approved."));
}

export async function deleteEntry(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_delete_entry", { p_entry: s(formData, "entry") });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(sameFile(id, s(formData, "back")) || enBack(id), error ? "error" : "msg", error ? error.message : "Entry deleted."));
}

// For files imported before matching ran by itself: match the accounts still open.
export async function runMatching(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(tbBack(id));
  const m = await matchFile(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  // Piece 9: back to the page it was run from (step 6, step 4, or the Trial balance tab's GIFI matching), else the tab.
  const from = s(formData, "back");
  const to = (extra: string) => (from.startsWith(`/closebook/${id}?`) ? `${from.replace(/&view=[^&]*/, "")}${extra}` : tbBack(id, extra));
  redirect(withMessage(to(m.reviewer ? "&view=attention" : ""), "msg", `Matched ${m.history + m.suggested}.${m.reviewer ? ` ${m.reviewer} need${m.reviewer === 1 ? "s" : ""} a decision below.` : ""}`));
}

// Explain a flagged lead sheet line (batch 5.5).
export async function explainFlagInline(fileId: string, account: string, reason: string, note: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_explain_flag", { p_account: account, p_reason: reason, p_note: note });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

// ---------- Bank and card statements (part 2b; Hashim, Nov 13, 2026) ----------

// Round 24 (Hashim, Nov 16, 2026): the old CSV upload and "Remove statement" are gone. Statements go in through
// step 3.2 (the upload window) and are never deleted: a wrong one is excluded, with a reason, in View statements.

// ---------- Step 4, coding: src/app/(app)/closebook/feed-actions.ts (round 31, QuickBooks Online's Bank transactions page).

// Step 1: the setup questions. Yes/No answers come as "yes"/"no"; blank leaves an answer as it was.
export async function saveSetup(formData: FormData) {
  const id = s(formData, "file_id");
  const back = `/closebook/${id}?step=setup`;
  await editor(back);
  const answers: Record<string, boolean | string> = {};
  for (const k of ["realtor", "owner_paid", "dividends", "payroll", "holdco", "gst_registered", "quick_method", "gst_year_same"]) {
    const v = s(formData, k);
    if (v === "yes" || v === "no") answers[k] = v === "yes";
  }
  const f = s(formData, "gst_frequency");
  if (f) answers.gst_frequency = f;
  // Round 20: which quick method rate applies (services or goods for resale), kept only on a quick method file.
  const qt = s(formData, "quick_method_type");
  if ((qt === "services" || qt === "goods") && answers.quick_method === true) answers.quick_method_type = qt;
  // Round 13: the GST/HST account, written RT0001.
  const rt = s(formData, "gst_rt").replace(/\s+/g, "").toUpperCase();
  if (rt) answers.gst_rt = rt;
  const { error } = await (await createClient()).rpc("cb_save_setup", { p_file: id, p_setup: answers });
  if (error) redirect(withMessage(back, "error", error.message));
  await rebuildTb(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, "msg", "Saved"));
}

// ---------- Step 2, Opening balances (Hashim, Nov 14, 2026) ----------
// Last year's balance sheet (and income statement when available) typed by GIFI code from the prior T2 or
// the CRA assessment, or filled from last year's Closebook file. A GIFI file is never an input.

// accounts: the standard chart account chosen on a row whose GIFI line has more than one (step 2).
export async function saveOpeningInline(fileId: string, lines: [string, number][], reStatedCents: number | null, niTypedCents: number | null, note: string, accounts: Record<string, string> = {}): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_save_opening", { p_file: fileId, p_codes: lines.map(([code, c]) => ({ code, amount: c / 100, account: accounts[code] ?? null })),
    p_re_stated: reStatedCents === null ? null : reStatedCents / 100, p_ni_typed: niTypedCents === null ? null : niTypedCents / 100, p_note: note });
  if (error) return `Nothing was saved. ${error.message}`;
  const tb = await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  return tb;
}

// Round 21: as signStep does after "Sign as preparer": the next step opens by itself, with a note naming it.
// The screen shows the note and goes to `next` (no redirect, so the note shows from the client).
export async function signOpeningInline(fileId: string): Promise<{ error: string } | { next: string; note: string }> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { error: "You need Edit on Closebook." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_sign_opening", { p_file: fileId });
  if (error) return { error: error.message };
  revalidatePath(`/closebook/${fileId}`);
  const nextKey = STEP_KEYS[STEP_KEYS.indexOf("opening") + 1];
  const { data: f } = await supabase.from("cb_files").select("books").eq("id", fileId).maybeSingle();
  const nextName = stepTitle(nextKey, (f?.books as string) ?? "").replace(/^\d+\.\s*/, "");
  return { next: `/closebook/${fileId}?step=${nextKey}`, note: `${STEP_WORD.opening} signed. Next: ${nextName}` };
}

// The source PDF: the prior T2 or the CRA assessment, kept in the private documents store.
export async function uploadOpeningPdf(formData: FormData) {
  const id = s(formData, "file_id");
  const back = `/closebook/${id}?step=opening`;
  await editor(back);
  const upload = formData.get("pdf");
  if (!(upload instanceof File) || upload.size === 0 || !/\.pdf$/i.test(upload.name)) redirect(withMessage(back, "error", "Choose the PDF of the prior T2 or the CRA assessment."));
  if ((upload as File).size > 20 * 1024 * 1024) redirect(withMessage(back, "error", "The PDF is over 20 MB."));
  const path = `closebook/${id}/opening-${Date.now()}.pdf`;
  const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await (upload as File).arrayBuffer()), { contentType: "application/pdf", upsert: false });
  if (up.error) redirect(withMessage(back, "error", `The PDF was not saved: ${up.error.message}`));
  const { error } = await (await createClient()).rpc("cb_set_opening_pdf", { p_file: id, p_path: path });
  if (error) redirect(withMessage(back, "error", error.message));
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, "msg", "PDF attached."));
}

// Round 21: the same, from step 2's schedule without leaving the page, so what is typed and not yet saved
// stays on screen. Returns an error, or null.
export async function uploadOpeningPdfInline(formData: FormData): Promise<string | null> {
  const id = s(formData, "file_id");
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  if (!/^[0-9a-f-]{36}$/.test(id)) return "This file is missing.";
  const upload = formData.get("pdf");
  if (!(upload instanceof File) || upload.size === 0 || !/\.pdf$/i.test(upload.name)) return "Choose the PDF of the prior T2 or the CRA assessment.";
  if (upload.size > 20 * 1024 * 1024) return "The PDF is over 20 MB.";
  const path = `closebook/${id}/opening-${Date.now()}.pdf`;
  const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await upload.arrayBuffer()), { contentType: "application/pdf", upsert: false });
  if (up.error) return `The PDF was not saved: ${up.error.message}`;
  const { error } = await (await createClient()).rpc("cb_set_opening_pdf", { p_file: id, p_path: path });
  if (error) return error.message;
  revalidatePath(`/closebook/${id}`);
  return null;
}


// The lines of an upload already in the file (round 2 item 5), shown before Upload.

// ---------- Round 8: sign-offs, review notes, the completion checklist (Hashim, Nov 24, 2026) ----------
// Every form names the page to come back to; only a page of the same file is accepted.
const backTo = (f: FormData, id: string) => { const b = s(f, "back"); return b.startsWith(`/closebook/${id}?`) ? b : `/closebook/${id}`; };
const STEP_WORD: Record<string, string> = { setup: "Step 1", opening: "Step 2", records: "Step 3", code: "Step 4", entries: "Step 5", compare: "Step 6", review: "Step 7", t2: "Step 8", statements: "Step 9", lock: "Step 10" };

export async function signStep(formData: FormData) {
  const id = s(formData, "file_id"), step = s(formData, "step"), role = s(formData, "role");
  const back = backTo(formData, id);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_sign_step", { p_file: id, p_step: step, p_role: role });
  revalidatePath(`/closebook/${id}`);
  // Round 34: step 3 on a bank file is signed in its sub-steps. Said as information, never as an error.
  if (error && step === "records" && /signed in its sub-steps/.test(error.message))
    redirect(withMessage(back, "msg", "Step 3 is complete when 3.1, 3.2 and 3.3 are signed."));
  // Round 21 (Hashim): after "Sign as preparer" the next step opens by itself, with a note naming it.
  const i = STEP_KEYS.indexOf(step as StepKey), nextKey = STEP_KEYS[i + 1];
  if (!error && role === "prepared" && i >= 0 && nextKey) {
    const { data: f } = await supabase.from("cb_files").select("books").eq("id", id).maybeSingle();
    const nextName = stepTitle(nextKey, (f?.books as string) ?? "").replace(/^\d+\.\s*/, "");
    redirect(withMessage(`/closebook/${id}?step=${nextKey}`, "msg", `${STEP_WORD[step]} signed. Next: ${nextName}`));
  }
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : role === "prepared" ? `${STEP_WORD[step] ?? "Step"} signed.` : `${STEP_WORD[step] ?? "Step"} signed as reviewed.`));
}

export async function unsignStep(formData: FormData) {
  const id = s(formData, "file_id"), step = s(formData, "step"), role = s(formData, "role");
  const back = backTo(formData, id);
  const { error } = await (await createClient()).rpc("cb_unsign_step", { p_file: id, p_step: step, p_role: role });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Your sign-off is taken back."));
}

export async function addNote(formData: FormData) {
  const id = s(formData, "file_id");
  const back = backTo(formData, id);
  const target = s(formData, "target_type") || "step";
  const { error } = await (await createClient()).rpc("cb_add_note", { p_file: id, p_step: s(formData, "step"), p_target_type: target,
    p_target: target === "step" ? null : s(formData, "target_id"), p_body: s(formData, "body") });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Review note added."));
}

export async function replyNote(formData: FormData) {
  const id = s(formData, "file_id");
  const back = backTo(formData, id);
  const fixed = s(formData, "fixed") === "1";
  const { error } = await (await createClient()).rpc("cb_reply_note", { p_note: s(formData, "note"), p_body: s(formData, "body"), p_fixed: fixed });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : fixed ? "Marked fixed. The step's sign-offs are cleared until it is signed again." : "Reply added."));
}

export async function clearNote(formData: FormData) {
  const id = s(formData, "file_id");
  const back = backTo(formData, id);
  const reopen = s(formData, "reopen") === "1";
  const { error } = await (await createClient()).rpc("cb_clear_note", { p_note: s(formData, "note"), p_reopen_with: reopen ? s(formData, "body") : null });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : reopen ? "Note reopened." : "Note cleared."));
}

export async function saveChecklist(formData: FormData) {
  const id = s(formData, "file_id");
  const back = backTo(formData, id);
  const keys = formData.getAll("question").map(String);
  const answers = keys.filter((k) => s(formData, `a_${k}`)).map((k) => ({ question: k, answer: s(formData, `a_${k}`), note: s(formData, `n_${k}`) }));
  const { error } = await (await createClient()).rpc("cb_save_checklist", { p_file: id, p_answers: answers });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : `Checklist saved: ${answers.length} of ${keys.length} answered.`));
}

// ---------- Piece R2: step 4 "Assign mapping" on trial balance files (one database call per action) ----------

export async function assignInline(fileId: string, items: { account: string; chart: string | null }[], label: string, source = "manual"): Promise<{ action?: string; n?: number; error?: string }> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { error: "You need Edit on Closebook to assign accounts." };
  const { data, error } = await (await createClient()).rpc("cb_assign", { p_file: fileId, p_items: items, p_label: label, p_source: source });
  if (error) return { error: error.message };
  revalidatePath(`/closebook/${fileId}`);
  const r = data as { action: string | null; n: number };
  return { action: r.action ?? undefined, n: r.n };
}

export async function undoAssignInline(fileId: string, action: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook to assign accounts.";
  const { error } = await (await createClient()).rpc("cb_undo_assign", { p_action: action });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

export async function unassignAllInline(fileId: string): Promise<{ action?: string; n?: number; error?: string }> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { error: "You need Edit on Closebook to assign accounts." };
  const { data, error } = await (await createClient()).rpc("cb_unassign_all", { p_file: fileId });
  if (error) return { error: error.message };
  revalidatePath(`/closebook/${fileId}`);
  const r = data as { action: string | null; n: number };
  return { action: r.action ?? undefined, n: r.n };
}

// D12b: the client account entries take when several sit on one master account.
export async function pickChartAccountInline(fileId: string, chart: string, account: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_pick_chart_account", { p_file: fileId, p_chart: chart, p_account: account });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

// D12c: "Booked in QuickBooks".
export async function markBookedInline(fileId: string, entry: string, booked: boolean): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_mark_booked", { p_entry: entry, p_booked: booked });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

// Step 8 (D6): the reviewer keeps a line that changed from last year.
export async function keepLineMoveInline(fileId: string, account: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_keep_line_move", { p_account: account });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}

// Decision 1A (Hashim, Nov 19, 2026): step 2 on a trial balance file, last year's closing retained earnings (T2 line 3849).
export async function saveTbOpeningReInline(fileId: string, amount: number | null): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_save_tb_opening_re", { p_file: fileId, p_amount: amount });
  revalidatePath(`/closebook/${fileId}`);
  return error?.message ?? null;
}
