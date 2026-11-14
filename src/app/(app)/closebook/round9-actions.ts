"use server";
// Step 5, round 9 (Hashim, Nov 27, 2026): the revenue check and expenses paid personally. Every rule is
// checked again in the database; these only carry what the preparer typed and the files attached.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";
import { loadFile } from "@/lib/closebook/server";
import { loadExpenses } from "@/lib/closebook/expenses-server";
import { planExpenses, type ExpenseHead, type ExpenseInput } from "@/lib/closebook/expenses";
import { defaultTaxCode } from "@/lib/closebook/sales-tax";
import { keepsOwnBooks } from "@/lib/closebook/books";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id: string) => `/closebook/${id}?step=entries`;
const done = (id: string, error: { message: string } | null, ok: string): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back(id), error ? "error" : "msg", error ? error.message : ok));
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
  const id = s(formData, "file_id");
  await editor(id);
  const amount = parseAmount(s(formData, "amount"));
  if (amount === null) redirect(withMessage(back(id), "error", "Type the total from the report, for example 152,400.00."));
  const report = fileOf(formData, "report");
  if (!report) redirect(withMessage(back(id), "error", "Attach the report. Nothing was saved."));
  const path = await store(id, "revenue", report!);
  const { error } = await (await createClient()).rpc("cb_add_revenue_source", {
    p_file: id, p_kind: s(formData, "kind"), p_payer: s(formData, "payer"), p_label: s(formData, "label"), p_amount: amount! / 100, p_attachment: path,
  });
  done(id, error, "Source added.");
}

export async function removeRevenueSource(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  const { error } = await (await createClient()).rpc("cb_remove_revenue_source", { p_source: s(formData, "source") });
  done(id, error, "Source removed.");
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
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_accept_revenue_difference", { p_file: id, p_check: s(formData, "check") || "revenue" });
  done(id, error, "Difference accepted.");
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
  done(id, error, "Entry made from the revenue check. It goes to the reviewer.");
}

// B8 to B14: the entry from the Summary. The form sends what was typed; the entry is worked out again here.
const QBO_TYPE: Record<string, string> = { Expense: "Expenses", Asset: "Fixed Assets", Liability: "Other Current Liabilities", Revenue: "Income", Equity: "Equity" };
export async function addPersonalExpenses(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(id);
  let form: { inputs: ExpenseInput[]; head: ExpenseHead };
  try { form = JSON.parse(s(formData, "form")); } catch { redirect(withMessage(back(id), "error", "The entry could not be read. Nothing was saved.")); }
  const supabase = await createClient();
  const f = await loadFile(supabase, id);
  if (!f) redirect(withMessage(back(id), "error", "File not found."));
  const data = await loadExpenses(supabase, f!.file);
  if (!data) redirect(withMessage(back(id), "error", "The \"Expenses paid personally\" standard entry is missing. Ask an owner."));
  if (!data!.shareholders.some((h) => h.value === form!.head.shareholder)) redirect(withMessage(back(id), "error", "Choose the shareholder from the list. Nothing was saved."));
  // Round 9b: an account chosen on a line must be one the form offered (or a named new account on a client
  // who keeps their own books).
  for (const i of form!.inputs) {
    const d = data!.defs.find((x) => x.key === i.key);
    if (!d || d.pick || !i.account) continue;
    const ok = (data!.options[i.key] ?? []).some((o) => o.value === i.account) || i.account === data!.defaults[i.key] || (data!.own && i.account.startsWith("new:"));
    if (!ok) redirect(withMessage(back(id), "error", `${d.name}: choose an account from the list. Nothing was saved.`));
  }
  const sheet = fileOf(formData, "sheet");
  const receipts = new Map(form!.inputs.map((i) => [i.key, formData.getAll(`receipts_${i.key}`).filter((x): x is File => x instanceof File && x.size > 0)]));
  const inputs = form!.inputs.map((i) => ({ ...i, receipts: receipts.get(i.key)?.length ?? 0 }));
  const province = f!.client?.province ?? "ON";
  const plan = planExpenses(data!.defs, inputs, { ...form!.head, sheet: !!sheet, autoEntry: data!.autoEntry },
    { registered: data!.registered, quick: data!.quick, autoTax: data!.autoTax, taxCode: (a) => defaultTaxCode("GST/HST", province, a) });
  if (plan.problems.length) redirect(withMessage(back(id), "error", `Nothing was saved. ${plan.problems[0]}`));
  const files = [...receipts.values()].flat();
  if (files.length + 1 > 10) redirect(withMessage(back(id), "error", "Up to 10 attachments: the sheet and 9 receipts. Nothing was saved."));
  // A client who keeps their own books: their account on the same GIFI line, as any entry; when they have
  // none, a new account in their books named after the standard chart account (round 2 item 2).
  let lines: Record<string, unknown>[] = plan.rpc;
  if (keepsOwnBooks(f!.file)) {
    const chart = new Map(data!.chart.map((c) => [c.number, c]));
    const has = new Set(f!.accounts.filter((a) => a.line_no && a.number && !a.client_new && !a.account_key.startsWith("line:") && !a.account_key.startsWith("gifi:")).map((a) => a.line_no));
    lines = plan.rpc.map((l) => {
      if (!l.chart) return l;   // already the client's own account
      const c = chart.get(l.chart);
      // A new account named on the line (round 9b): on the default's GIFI line, with its QuickBooks type.
      if (l.new_name && c) { const { chart: _c, ...rest } = l; void _c; return { ...rest, line: c.line_no, new_type: QBO_TYPE[c.type] ?? "Expenses" }; }
      if (l.is_tax || !c || has.has(c.line_no)) return l;
      const { chart: _drop, ...rest } = l;
      void _drop;
      return { ...rest, line: c.line_no, new_name: c.name, new_type: QBO_TYPE[c.type] ?? "Expenses" };
    });
  }
  const paths = [await store(id, "entries", sheet!)];
  for (const r of files) paths.push(await store(id, "entries", r));
  const { error } = await supabase.rpc("cb_add_personal_expenses", { p_file: id, p_lines: lines, p_check: plan.check, p_attachments: paths, p_to_reviewer: plan.toReviewer });
  if (error) done(id, { message: `Nothing was saved. ${error.message}` }, "");
  done(id, null, plan.toReviewer ? "Expenses paid personally: entry added. It goes to the reviewer." : "Expenses paid personally: entry added.");
}

// Round 9b: one line's account on this file, saved as soon as it is picked (rolls forward to next year).
export async function saveExpenseLineInline(fileId: string, key: string, value: string): Promise<string | null> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return "You need Edit on Closebook.";
  const supabase = await createClient();
  const f = await loadFile(supabase, fileId);
  if (!f) return "File not found.";
  const data = await loadExpenses(supabase, f.file);
  if (!data) return "The standard entry is missing.";
  let kind = "default", v = "";
  if (value && value !== data.defaults[key]) {
    if (value.startsWith("acct:")) { kind = "client"; v = f.accounts.find((x) => x.id === value.slice(5))?.number ?? ""; if (!v) return "That account is not in this file."; }
    else if (value.startsWith("new:")) { kind = "new"; v = value.slice(4).trim(); }
    else { kind = "chart"; v = value; }
  }
  const { error } = await supabase.rpc("cb_save_expense_line_account", { p_file: fileId, p_key: key, p_kind: kind, p_value: v });
  return error ? error.message : null;
}

// Settings, Closebook, Standard entries: a line's default account, tax and reviewer flag (owners).
export async function saveStandardEntryLine(formData: FormData) {
  const STD = "/admin/closebook/standard-entries";
  const { error } = await (await createClient()).rpc("cb_save_standard_entry_line", {
    p_standard: s(formData, "standard"), p_key: s(formData, "key"), p_account: s(formData, "account"), p_tax: s(formData, "tax"), p_to_reviewer: formData.get("to_reviewer") === "on",
  });
  revalidatePath(STD);
  redirect(withMessage(STD, error ? "error" : "msg", error ? error.message : "Line saved."));
}
