"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { readXlsx } from "@/lib/closebook/xlsx";
import { parseCsv } from "@/lib/closebook/seed";
import { readTrialBalance } from "@/lib/closebook/tb-import";

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
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message
    : `Imported ${data} accounts. Debits and credits both ${tb.debit.toLocaleString("en-CA", { style: "currency", currency: "CAD" })}.${tb.skipped.length ? ` Left out: ${tb.skipped.length} total, blank or zero rows.` : ""}`));
}
