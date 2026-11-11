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
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line"),
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
  const lines: { account?: string; line?: string; amount: number; memo: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const target = s(formData, `t${i}`);
    const dr = Number(s(formData, `dr${i}`).replace(/[$,\s]/g, "") || 0), cr = Number(s(formData, `cr${i}`).replace(/[$,\s]/g, "") || 0);
    if (!target && !dr && !cr) continue;
    if (!target) redirect(withMessage(enBack(id), "error", `Line ${i + 1}: choose an account or a GIFI line.`));
    if (!Number.isFinite(dr) || !Number.isFinite(cr) || (dr && cr) || (!dr && !cr)) redirect(withMessage(enBack(id), "error", `Line ${i + 1}: enter a debit or a credit, not both.`));
    const amount = Math.round((dr - cr) * 100) / 100;
    lines.push({ ...(target.startsWith("line:") ? { line: target.slice(5) } : { account: target }), amount, memo: s(formData, `m${i}`) });
  }
  const { error } = await (await createClient()).rpc("cb_add_entry", {
    p_file: id, p_kind: s(formData, "kind"), p_reason: s(formData, "reason"), p_note: s(formData, "note"), p_reverse: formData.get("reverse") === "on", p_lines: lines,
  });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(enBack(id), error ? "error" : "msg", error ? error.message : "Entry added. It goes to the reviewer."));
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
