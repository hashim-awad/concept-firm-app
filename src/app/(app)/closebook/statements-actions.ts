"use server";
// Step 9, Statements (round 11): the fields, last year's Schedule 125, and sending the MAL for signing.
// The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";
import { loadPackage } from "@/lib/closebook/fs-server";
import { malHtml } from "@/lib/closebook/fs-text";
import { malDef } from "@/lib/closebook/fs-pdf";
import { MAL_DATE } from "@/lib/letters/server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const done = (back: string, id: string, error: { message: string } | null, ok: string): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : ok));
};
const step9 = (id: string) => `/closebook/${id}?step=statements`;
async function editor(back: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
}

// The fields: saved per client (signing officer, terms, related parties, audit waiver) and per file
// (first year, dividends). Rolled forward because the client's fields are kept for next year.
export async function saveFsFields(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(step9(id));
  const related: Record<string, string> = {};
  for (const k of formData.keys()) if (k.startsWith("related_")) related[k.slice(8)] = s(formData, k);
  const lines = formData.getAll("div_line").map(String);
  const dividends = lines.map((line) => ({ line, cls: s(formData, `div_cls_${line}`), declared: s(formData, `div_declared_${line}`), paid: s(formData, `div_paid_${line}`),
    eligible: formData.has(`div_eligible_${line}`) ? s(formData, `div_eligible_${line}`) === "yes" : null }));
  const fy = s(formData, "first_year");
  const p = { officer_name: s(formData, "officer_name"), officer_position: s(formData, "officer_position"), officer_email: s(formData, "officer_email"),
    sh_terms: s(formData, "sh_terms"), related, audit_waiver: s(formData, "audit_waiver") !== "no", first_year: fy === "yes" ? true : fy === "no" ? false : null, dividends };
  const { error } = await (await createClient()).rpc("cb_save_fs_fields", { p_file: id, p });
  done(step9(id), id, error, "Step 9 fields saved.");
}

// Step 2 on a bank-statement file: last year's Schedule 125, one amount per GIFI code.
export async function saveOpeningS125(formData: FormData) {
  const id = s(formData, "file_id");
  const back = `/closebook/${id}?step=opening`;
  await editor(back);
  const out: { code: string; amount: number }[] = [];
  for (const code of formData.getAll("s125_code").map(String)) {
    const raw = s(formData, `s125_${code}`);
    if (!raw) continue;
    const c = parseAmount(raw);
    if (c === null) redirect(withMessage(back, "error", `GIFI ${code}: type an amount, for example 12,345.67. Nothing was saved.`));
    out.push({ code, amount: c! / 100 });
  }
  for (let i = 0; formData.has(`s125_new_code_${i}`); i++) {
    const code = s(formData, `s125_new_code_${i}`), raw = s(formData, `s125_new_amt_${i}`);
    if (!code && !raw) continue;
    const c = parseAmount(raw);
    if (!/^\d{4}$/.test(code) || c === null) redirect(withMessage(back, "error", "A new line needs a 4-digit GIFI code and an amount. Nothing was saved."));
    out.push({ code, amount: c! / 100 });
  }
  const { error } = await (await createClient()).rpc("cb_save_opening_s125", { p_file: id, p_lines: out });
  done(back, id, error, "Last year's Schedule 125 saved.");
}

// After the reviewer signs step 9: the MAL goes to the signing officer through the signing engine.
// What is signed is built now, from the package; its date is the day the officer signs.
export async function sendMal(formData: FormData) {
  const id = s(formData, "file_id");
  await editor(step9(id));
  const supabase = await createClient();
  const pk = await loadPackage(supabase, id);
  if (!pk) redirect(withMessage(step9(id), "error", "This file was not found."));
  if (pk!.blocked.length) redirect(withMessage(step9(id), "error", `The package is stopped: ${pk!.blocked[0]}`));
  const officer = { name: pk!.fields.officer_name, position: pk!.fields.officer_position };
  const html = malHtml(pk!.m, officer, MAL_DATE);
  const pdf = malDef(pk!.m, { draft: false, reportDate: MAL_DATE, officer }).content;
  const { error } = await supabase.rpc("cb_send_mal", { p_file: id, p_title: `Management Responsibility Acknowledgement ${pk!.data.file.year_end}`, p_html: html, p_pdf: pdf });
  done(step9(id), id, error, "The MAL is out for signing. Copy the signing link below and send it to the signing officer.");
}
