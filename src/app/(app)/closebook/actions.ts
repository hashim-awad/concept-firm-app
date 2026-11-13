"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { readXlsx } from "@/lib/closebook/xlsx";
import { parseCsv } from "@/lib/closebook/seed";
import { readTrialBalance } from "@/lib/closebook/tb-import";
import { suggestLine, type Line } from "@/lib/closebook/matching";
import { balanceCheck, dollars, flipRows, looksReversed, readBankUpload, REVERSED, typedCents } from "@/lib/closebook/bank-upload";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFile } from "@/lib/closebook/server";
import { loadEntryForm } from "@/lib/closebook/entry-form-server";
import { planEntry, type FormHead, type FormLine } from "@/lib/closebook/entry-form";

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
  const normal = new Date(Date.UTC(+yearEnd.slice(0, 4) - 1, +yearEnd.slice(5, 7) - 1, +yearEnd.slice(8, 10) + 1)).toISOString().slice(0, 10);
  const yearStart = s(formData, "year_start") || normal;
  const type = s(formData, "file_type");
  const books = type === "monthly" ? "concept_qbo" : s(formData, "books");
  const { data, error } = await (await createClient()).rpc("cb_create_file", {
    p_client: client, p_year_end: yearEnd, p_year_start: yearStart, p_reason: s(formData, "reason"), p_type: type, p_books: books,
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
  const m = await matchFile(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  const matched = m.history + m.suggested;
  redirect(withMessage(`${back}${m.reviewer ? "&view=attention" : ""}`, "msg",
    `Imported ${data} accounts, balanced at ${tb.debit.toLocaleString("en-CA", { style: "currency", currency: "CAD" })}. Matched ${matched} to GIFI lines${m.history ? ` (${m.history} from last year)` : ""}.${m.reviewer ? ` ${m.reviewer} need${m.reviewer === 1 ? "s" : ""} a decision below.` : ""}`));
}

// ---------- Matching (batch 4.5) ----------

const tbBack = (id: string, extra = "") => `/closebook/${id}?tab=tb${extra}`;
async function editor(back: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
}

// Match every account not yet matched: the client's history first (in the database), then name
// suggestions; anything unclear goes to the reviewer's list.
// Match every account not yet matched: the client's history first (in the database), then name
// suggestions; anything unclear goes to the reviewer's list. Runs by itself after each import.
async function matchFile(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const [{ data: accounts }, { data: lines }] = await Promise.all([
    supabase.from("cb_accounts").select("id, number, name").eq("file_id", id).is("line_no", null).eq("needs_reviewer", false),
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, locked"),
  ]);
  const suggestions = ((accounts ?? []) as { id: string; number: string; name: string }[]).map((a) => {
    const sg = suggestLine(a, (lines ?? []) as Line[]);
    return { account: a.id, line: sg.line, reason: sg.reason };
  });
  const { data } = await supabase.rpc("cb_apply_matching", { p_file: id, p_suggestions: suggestions });
  return (data ?? { history: 0, suggested: 0, reviewer: 0 }) as { history: number; suggested: number; reviewer: number };
}

// Row actions on the Trial balance tab: they save on the spot and return any problem as text.
export async function matchInline(fileId: string, account: string, line: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_map_account", { p_account: account, p_line: line });
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
const enBack = (id: string) => `/closebook/${id}?tab=entries`;

export async function addEntry(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(enBack(id));
  // The form sends what the preparer typed; the lines and the sales tax are worked out again here, from
  // the database's own rates (round 2 item 11), and the database checks every rule again.
  let form: { head: FormHead; date: string; lines: FormLine[]; standard: string | null };
  try { form = JSON.parse(s(formData, "form")); } catch { redirect(withMessage(enBack(id), "error", "The entry could not be read. Nothing was saved.")); }
  const supabase = await createClient();
  const f = await loadFile(supabase, id);
  if (!f) redirect(withMessage(enBack(id), "error", "File not found."));
  const data = await loadEntryForm(supabase, f!.file, f!.client?.province ?? "ON", f!.client?.legal_name ?? "The client");
  const plan = planEntry(form!.head, form!.lines, new Map(data.opts.map((o) => [o.value, o])), new Map(data.codes.map((c) => [c.code, c])), data.ctx,
    new Map(data.gifiLines.map(([no, , type]) => [no, type])));
  if (plan.problems.length) redirect(withMessage(enBack(id), "error", `Nothing was saved. ${plan.problems[0]}`));
  // Attachments: kept in the private documents store, listed on the entry.
  const paths: string[] = [];
  const files = formData.getAll("attachments").filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length > 10) redirect(withMessage(enBack(id), "error", "Up to 10 attachments. Nothing was saved."));
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) redirect(withMessage(enBack(id), "error", `${file.name} is over 20 MB. Nothing was saved.`));
    const path = `closebook/${id}/entries/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await createAdminClient().storage.from("documents").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) redirect(withMessage(enBack(id), "error", `${file.name} was not saved: ${up.error.message}. Nothing was saved.`));
    paths.push(path);
  }
  const { data: entryId, error } = await supabase.rpc("cb_add_entry", {
    p_file: id, p_kind: form!.head.kind, p_reason: form!.head.reason, p_note: form!.head.memo, p_reverse: form!.head.reverse, p_lines: plan.rpc, p_wp_ref: form!.head.wpRef,
    p_date: /^\d{4}-\d{2}-\d{2}$/.test(form!.date) ? form!.date : null, p_standard: form!.standard, p_attachments: paths,
  });
  revalidatePath(`/closebook/${id}`);
  if (error) redirect(withMessage(enBack(id), "error", `Nothing was saved. ${error.message}`));
  const { data: e } = await supabase.from("cb_entries").select("needs_review").eq("id", entryId as string).maybeSingle();
  redirect(withMessage(enBack(id), "msg", e?.needs_review === false ? "Standard entry added. It is under the review threshold, so no review is needed." : "Entry added. It goes to the reviewer."));
}

export async function reviewEntry(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_review_entry", { p_entry: s(formData, "entry") });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(enBack(id), error ? "error" : "msg", error ? error.message : "Entry approved."));
}

export async function deleteEntry(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_delete_entry", { p_entry: s(formData, "entry") });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(enBack(id), error ? "error" : "msg", error ? error.message : "Entry deleted."));
}

// For files imported before matching ran by itself: match the accounts still open.
export async function runMatching(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(tbBack(id));
  const m = await matchFile(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(tbBack(id, m.reviewer ? "&view=attention" : ""), "msg", `Matched ${m.history + m.suggested}.${m.reviewer ? ` ${m.reviewer} need${m.reviewer === 1 ? "s" : ""} a decision below.` : ""}`));
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

// Upload one statement in Concept's bank upload template. The file is read here (every problem named by
// line), the balance is checked here and again in the database, which refuses anything that does not tie.
export async function uploadBankStatement(formData: FormData) {
  const id = s(formData, "file_id");
  // A problem keeps the side panel open on the same account (or on "Add an account").
  const acct = s(formData, "account") || "new";
  const back = `/closebook/${id}?step=records${acct !== "new" ? `&account=${acct}` : ""}&upload=${acct}`;
  const done = `/closebook/${id}?step=records`;
  await editor(back);
  const upload = formData.get("upload");
  if (!(upload instanceof File) || upload.size === 0) redirect(withMessage(back, "error", "Choose the statement file (CSV, in Concept's bank upload template)."));
  const f = upload as File;
  if (!/\.csv$/i.test(f.name)) redirect(withMessage(back, "error", "Upload a CSV file in Concept's bank upload template (Date, Description, Amount). Save Excel files as CSV first."));
  const read0 = readBankUpload(new TextDecoder().decode(new Uint8Array(await f.arrayBuffer())));
  // "Flip signs and re-check": the signs turned over; the flipped lines must still tie to the cent.
  const read = s(formData, "flip") === "1" ? { ...read0, rows: flipRows(read0.rows) } : read0;
  if (read.errors.length) {
    const more = read.errors.length > 5 ? ` And ${read.errors.length - 5} more.` : "";
    redirect(withMessage(back, "error", `Nothing was uploaded. ${read.errors.slice(0, 5).join(" ")}${more}`));
  }
  const opening = typedCents(s(formData, "opening")), closing = typedCents(s(formData, "closing"));
  if (opening === null || closing === null) redirect(withMessage(back, "error", "Enter the statement's opening and closing balances, as shown on the statement (up to 2 decimals)."));
  const chk = balanceCheck(opening!, closing!, read.rows);
  if (!chk.ok && looksReversed(opening!, closing!, read.rows)) redirect(withMessage(back, "error", `Nothing was uploaded. ${REVERSED}`));
  if (!chk.ok) {
    redirect(withMessage(back, "error", `Nothing was uploaded: the statement does not balance. Opening ${dollars(opening!)} + transactions ${dollars(chk.totalCents)} = ${dollars(chk.expectedCents)}, but the closing balance is ${dollars(closing!)}. Difference: ${dollars(chk.differenceCents)}. Check the balances, the signs (account type) and the file.`));
  }
  const account = s(formData, "account");
  // The same lines already in the file, on any account (round 2 item 5): stop before saving, unless the
  // preparer confirmed they are real (two equal charges on one day happen).
  const rowsJson = read.rows.map((r) => ({ line: r.line, date: r.date, description: r.description, amount: r.cents / 100 }));
  if (s(formData, "dup_ok") !== "1") {
    const { data: dups } = await (await createClient()).rpc("cb_duplicate_lines", { p_file: id, p_rows: rowsJson });
    const list = (dups ?? []) as { row_no: number; account_name: string }[];
    const rowsHit = new Set(list.map((d) => d.row_no)).size;
    if (list.length) redirect(withMessage(back, "error", `Nothing was uploaded: ${rowsHit} of ${read.rows.length} lines are already in this file (${[...new Set(list.map((d) => d.account_name))].join(", ")}). Choose the file again to see them.`));
  }
  // The statement period: as the preparer confirmed it, else the file's first and last dates.
  const dates = read.rows.map((r) => r.date).sort();
  const pStart = /^\d{4}-\d{2}-\d{2}$/.test(s(formData, "period_start")) ? s(formData, "period_start") : dates[0];
  const pEnd = /^\d{4}-\d{2}-\d{2}$/.test(s(formData, "period_end")) ? s(formData, "period_end") : dates[dates.length - 1];
  const { data, error } = await (await createClient()).rpc("cb_upload_bank", {
    p_period_start: pStart, p_period_end: pEnd,
    p_file: id, p_account: account && account !== "new" ? account : null, p_name: s(formData, "name"), p_kind: s(formData, "kind"), p_file_name: f.name,
    p_opening: opening! / 100, p_closing: closing! / 100,
    p_rows: rowsJson,
  });
  if (error) redirect(withMessage(back, "error", `Nothing was uploaded. ${error.message}`));
  const d = data as { statement: string; account: string; account_id: string; lines: number; first: string; last: string; outside_year: number };
  // Uploaded although already in the file (the preparer confirmed): those lines go to the reviewer (round 3 item 4).
  if (s(formData, "dup_ok") === "1") await (await createClient()).rpc("cb_flag_uploaded_duplicates", { p_file: id, p_statement: d.statement });
  await rebuildTb(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(`${done}&account=${encodeURIComponent(d.account_id)}`, "msg",
    `Uploaded ${d.lines} transactions for ${d.account}, ${d.first} to ${d.last}. Balanced: opening ${dollars(opening!)} + transactions ${dollars(chk.totalCents)} = closing ${dollars(closing!)}.${d.outside_year ? ` ${d.outside_year} fall outside the file's year.` : ""}`));
}

export async function deleteBankStatement(formData: FormData) {
  const id = s(formData, "file_id");
  const back = `/closebook/${id}?step=records`;
  await editor(back);
  const { error } = await (await createClient()).rpc("cb_delete_bank_statement", { p_statement: s(formData, "statement") });
  if (error) redirect(withMessage(back, "error", error.message));
  await rebuildTb(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, "msg", "Statement removed, with its transactions."));
}

// ---------- Step 3, coding (Hashim, Nov 13, 2026) ----------

// Code lines on the spot; each may also save a vendor rule for the client. Returns a problem as text.
export async function codeLinesInline(fileId: string, items: { id: string; account: string; tax: string | null; source?: string }[],
  rules: { key: string; account: string; tax: string | null }[]): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook to code transactions.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_code_lines", { p_file: fileId, p_items: items });
  if (error) return error.message;
  for (const r of rules) {
    const { error: re } = await supabase.rpc("cb_save_vendor_rule", { p_file: fileId, p_vendor_key: r.key, p_account: r.account, p_tax: r.tax ?? "" });
    if (re) return `Coded, but the rule was not saved: ${re.message}`;
  }
  const tb = await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  if (tb) return tb;
  return null;
}

export async function undoLinesInline(fileId: string, ids: string[]): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_uncode_lines", { p_file: fileId, p_ids: ids });
  if (error) return error.message;
  await rebuildTb(await createClient(), fileId);
  revalidatePath(`/closebook/${fileId}`);
  return null;
}

export async function askClientInline(fileId: string, ids: string[]): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_ask_client", { p_file: fileId, p_ids: ids });
  if (error) return error.message;
  await rebuildTb(await createClient(), fileId);
  revalidatePath(`/closebook/${fileId}`);
  return null;
}

// Step 1: the setup questions. Yes/No answers come as "yes"/"no"; blank leaves an answer as it was.
export async function saveSetup(formData: FormData) {
  const id = s(formData, "file_id");
  const back = `/closebook/${id}?step=setup`;
  await editor(back);
  const answers: Record<string, boolean | string> = {};
  for (const k of ["realtor", "owner_paid", "dividends", "payroll", "holdco", "gst_registered", "quick_method"]) {
    const v = s(formData, k);
    if (v === "yes" || v === "no") answers[k] = v === "yes";
  }
  const f = s(formData, "gst_frequency");
  if (f) answers.gst_frequency = f;
  const { error } = await (await createClient()).rpc("cb_save_setup", { p_file: id, p_setup: answers });
  if (error) redirect(withMessage(back, "error", error.message));
  await rebuildTb(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, "msg", "Setup answers saved."));
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

export async function signOpeningInline(fileId: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const { error } = await (await createClient()).rpc("cb_sign_opening", { p_file: fileId });
  if (error) return error.message;
  revalidatePath(`/closebook/${fileId}`);
  return null;
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


// The lines of an upload already in the file (round 2 item 5), shown before Upload.
export async function findDuplicatesInline(fileId: string, rows: { line: number; date: string; description: string; cents: number }[]) {
  const { data } = await (await createClient()).rpc("cb_duplicate_lines", { p_file: fileId, p_rows: rows.map((r) => ({ line: r.line, date: r.date, description: r.description, amount: r.cents / 100 })) });
  // One row per statement line, with every account it is already on (the same line can sit on two).
  const byRow = new Map<number, { row_no: number; txn_date: string; description: string; amount: number; account_name: string }>();
  for (const d of (data ?? []) as { row_no: number; txn_date: string; description: string; amount: number; account_name: string }[]) {
    const cur = byRow.get(d.row_no);
    if (!cur) byRow.set(d.row_no, { ...d });
    else if (!cur.account_name.split(", ").includes(d.account_name)) cur.account_name += `, ${d.account_name}`;
  }
  return [...byRow.values()];
}
