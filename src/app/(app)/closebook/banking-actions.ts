"use server";
// Step 3 "Banking" (round 23, Hashim, Nov 16, 2026): signing a sub-step (3.1, 3.2, 3.3), and one CSV for an
// account from the upload window. The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { balanceCheck, dollars, looksReversed, readBankUpload, REVERSED, typedCents } from "@/lib/closebook/bank-upload";
import { discardStatement } from "../statements/actions";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const PAPER: Record<string, string> = { "3.1": "accounts", "3.2": "feeds", "3.3": "reconcile" };

export async function signSubstep(f: FormData) {
  const id = s(f, "file_id"), sub = s(f, "sub"), role = s(f, "role");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `/closebook/${id}?step=records`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cb_sign_substep", { p_file: id, p_sub: sub, p_role: role });
  revalidatePath(`/closebook/${id}`);
  if (error) redirect(withMessage(back, "error", error.message));
  // After the preparer signs, the next sub-step opens (step 4 after 3.3).
  if (role === "prepared") {
    const next = sub === "3.1" ? "3.2" : sub === "3.2" ? "3.3" : null;
    redirect(withMessage(next ? `/closebook/${id}?step=records&paper=${PAPER[next]}` : `/closebook/${id}?step=code`, "msg", `${sub} signed.${next ? ` Next: ${next}.` : " Next: step 4."}`));
  }
  redirect(withMessage(back, "msg", `${sub} signed as reviewed.`));
}

export async function unsignSubstep(f: FormData) {
  const id = s(f, "file_id");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `/closebook/${id}?step=records`;
  const { error } = await (await createClient()).rpc("cb_unsign_substep", { p_file: id, p_sub: s(f, "sub"), p_role: s(f, "role") });
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Your sign-off is taken back."));
}

// One CSV (Concept's template: Date, Description, Amount) for an account, with the statement's opening and
// closing balances. Refused unless opening + lines = closing, to the cent.
export async function importCsv(fileId: string, account: string, fileName: string, text: string, opening: string, closing: string): Promise<
  { ok: true; lines: number; outside: number } | { ok: false; error: string }> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { ok: false, error: "You need Edit on Closebook to import." };
  const read = readBankUpload(text);
  if (read.errors.length) return { ok: false, error: `Refused: ${read.errors.slice(0, 3).join(" ")}` };
  const o = typedCents(opening), c = typedCents(closing);
  if (o === null || c === null) return { ok: false, error: "Enter the opening and closing balances from the statement." };
  const chk = balanceCheck(o, c, read.rows);
  if (!chk.ok) return { ok: false, error: looksReversed(o, c, read.rows) ? `Refused. ${REVERSED}`
    : `Refused: opening ${dollars(o)} + lines ${dollars(chk.totalCents)} = ${dollars(chk.expectedCents)}, but the closing balance is ${dollars(c)} (${dollars(chk.differenceCents)} off).` };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_import_csv", { p_file: fileId, p_account: account, p_file_name: fileName, p_opening: o / 100, p_closing: c / 100,
    p_rows: read.rows.map((r) => ({ line: r.line, date: r.date, description: r.description, amount: r.cents / 100 })) });
  if (error) return { ok: false, error: `Refused: ${error.message}` };
  await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  const d = data as { lines: number; outside: number };
  return { ok: true, lines: Number(d.lines), outside: Number(d.outside) };
}

// "View statements" > Delete: the statement and its lines go (their coding in step 4 with them); the upload goes
// too, so it is not imported again by itself.
export async function deleteStatement(f: FormData) {
  const id = s(f, "file_id");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `/closebook/${id}?step=records&paper=feeds`;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
  const supabase = await createClient();
  const { data: st } = await supabase.from("cb_bank_statements").select("statement_import_id").eq("id", s(f, "statement")).maybeSingle();
  const { error } = await supabase.rpc("cb_delete_bank_statement", { p_statement: s(f, "statement") });
  if (!error && st?.statement_import_id) await discardStatement(st.statement_import_id as string);
  if (!error) await rebuildTb(supabase, id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : "Statement deleted, with its lines."));
}
