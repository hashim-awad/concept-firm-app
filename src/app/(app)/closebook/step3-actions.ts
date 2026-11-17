"use server";
// Closebook step 3 (round 22, Hashim, Nov 16, 2026): accounts, coverage reasons, outstanding items, "Not ours",
// the upload window's target account and Skip, and the import of a checked statement (only its
// lines inside the year; the whole statement checked). The database checks every rule again.
import { plainError } from "@/lib/plain-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withMessage } from "@/lib/messages";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { autoPostRules } from "@/lib/closebook/feed-server";
import { parseAmount } from "@/lib/closebook/amount";
import { storedBytes } from "@/lib/statements/server";
import { checkAccount, closebookWarnings, loanWords, money } from "@/lib/statements/checks";
import { printedCents, type ReadResult, type StatementAccount } from "@/lib/statements/types";
import { accountFor, digitsOnly, yearCut, type FileAccount } from "@/lib/closebook/step3";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const base = (id: string) => `/closebook/${id}?step=records`;
async function editor(back: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
}
const done = async (id: string, back: string, error: { message: string } | null, msg: string, rebuild = false) => {
  if (!error && rebuild) await rebuildTb(await createClient(), id);
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? plainError(error.message) : msg));
};

// ---------- Add or change an account (point 6). Round 25 (Hashim, Nov 17, 2026): a change that removes a 3.1, 3.2 or
// 3.3 sign-off asks first (round 24 rule G17): the first call returns { confirm }, the second goes ahead.
type Asked = { ok: true; then: string } | { ok: false; error: string; confirm?: string };
const askOrFail = (message: string): { ok: false; error: string; confirm?: string } =>
  /^This removes the sign-off on/.test(message) ? { ok: false, error: message, confirm: message } : { ok: false, error: plainError(message) };
export async function saveAccount(f: FormData, confirm: boolean): Promise<Asked> {
  const id = s(f, "file_id"), acc = s(f, "account") || null;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { ok: false, error: "You need Edit on Closebook." };
  const c = parseAmount(s(f, "balance") || "0");
  if (c === null || c < 0) return { ok: false, error: "Enter the balance as a positive number, for example 1,957.62." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cb_save_bank_account", { p_file: id, p_id: acc, p_type: s(f, "type"), p_bank: s(f, "bank"), p_last4: s(f, "last4"),
    p_balance: c / 100, p_negative: s(f, "negative") === "on", p_long_term: s(f, "long_term") === "on", p_confirm: confirm, p_t2_line: s(f, "t2_line") || null });
  if (error) return askOrFail(error.message);
  // Back where it was opened from (the main page, or the check stage after "Add it").
  // "__new__" in the address stands for the account just added (the upload window's "+ Add account").
  const then = s(f, "then").startsWith(`/closebook/${id}?`) ? s(f, "then").replaceAll("__new__", String(data ?? acc ?? "")) : `${base(id)}&account=${data ?? acc ?? ""}`;
  await rebuildTb(supabase, id);
  revalidatePath(`/closebook/${id}`);
  return { ok: true, then: withMessage(then, "msg", acc ? "Account saved." : "Account added.") };
}

export async function removeBankAccount(f: FormData) {
  const id = s(f, "file_id");
  await editor(base(id));
  const { error } = await (await createClient()).rpc("cb_remove_bank_account", { p_id: s(f, "account"), p_confirm: s(f, "confirm") === "1" });
  await done(id, base(id), error, "Account removed.", true);
}

// ---------- Coverage reason (point 23): the account's months; asks first when 3.2 or 3.3 is signed.
export async function setAccountCoverage(fileId: string, account: string, opened: string, closed: string, note: string, clear: boolean, confirm: boolean): Promise<Asked> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { ok: false, error: "You need Edit on Closebook." };
  const { error } = await (await createClient()).rpc("cb_set_bank_coverage", { p_id: account, p_opened: clear ? null : opened || null, p_closed: clear ? null : closed || null,
    p_note: clear ? "" : note, p_confirm: confirm });
  if (error) return askOrFail(error.message);
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true, then: "" };
}

// ---------- Outstanding items at the year edges (point 22)
export async function addOutstanding(f: FormData) {
  const id = s(f, "file_id"), acc = s(f, "account");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `${base(id)}&account=${acc}`;
  await editor(back);
  // Rounding (round 22 fixes): the T2 is in whole dollars; the database takes the whole difference left, under 1.00.
  if (s(f, "kind") === "rounding") {
    const { error } = await (await createClient()).rpc("cb_add_outstanding", { p_account: acc, p_edge: s(f, "edge"), p_date: null, p_description: null,
      p_dir: null, p_amount: null, p_cleared_line: null, p_kind: "rounding" });
    return done(id, back, error, "Rounding added.");
  }
  const c = parseAmount(s(f, "amount"));
  if (c === null || c <= 0) redirect(withMessage(back, "error", "Enter the amount as a positive number."));
  const { error } = await (await createClient()).rpc("cb_add_outstanding", { p_account: acc, p_edge: s(f, "edge"), p_date: s(f, "date") || null, p_description: s(f, "description"),
    p_dir: s(f, "dir"), p_amount: c! / 100, p_cleared_line: s(f, "cleared_line") || null, p_kind: "item" });
  // Round 24: an item that names its line takes that line's posting out (it is last year's): the trial balance
  // changes only then.
  await done(id, back, error, "Outstanding item added.", !!s(f, "cleared_line"));
}
export async function removeOutstanding(f: FormData) {
  const id = s(f, "file_id"), acc = s(f, "account");
  const back = s(f, "back").startsWith(`/closebook/${id}?`) ? s(f, "back") : `${base(id)}&account=${acc}`;
  await editor(back);
  const supabase = await createClient();
  const { data: item } = await supabase.from("cb_bank_outstanding").select("cleared_line").eq("id", s(f, "item")).maybeSingle();
  const { error } = await supabase.rpc("cb_remove_outstanding", { p_id: s(f, "item") });
  // Its line gets its coding back: the posting returns.
  await done(id, back, error, "Outstanding item removed.", !!item?.cleared_line);
}

// ---------- "Possible account not set up" (point 18): Not ours
export async function setNotOurs(f: FormData) {
  const id = s(f, "file_id");
  await editor(base(id));
  const { error } = await (await createClient()).rpc("cb_set_not_ours", { p_file: id, p_last4: s(f, "last4"), p_label: s(f, "label"), p_not_ours: s(f, "undo") !== "1" });
  await done(id, base(id), error, s(f, "undo") === "1" ? "Not ours taken back." : `${s(f, "label")} marked Not ours.`);
}

// ---------- The upload window
type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error: plainError(error) });

export async function setStatementTarget(ids: string[], account: string | null): Promise<{ ok: true } | Fail> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return fail("You need Edit on Closebook.");
  const { error } = await (await createClient()).rpc("cb_statement_target", { p_ids: ids, p_account: account });
  return error ? fail(error.message) : { ok: true };
}

export async function skipStatement(id: string, skip: boolean, status: "ready" | "needs_look" | null): Promise<{ ok: true } | Fail> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return fail("You need Edit on Closebook.");
  const { error } = await (await createClient()).rpc("cb_skip_statement", { p_id: id, p_skip: skip, p_status: status });
  return error ? fail(error.message) : { ok: true };
}

// Import one checked statement into the file: each account found goes to the file's account it is for (the
// upload window's account, or the one its last digits match). Every line is sent; the database keeps only
// those inside the year and checks the whole statement. The first call without confirmation returns the
// lines already in the file and imports nothing. Round 24: an import goes to the bank feed only; nothing posts,
// so the trial balance is not rebuilt. confirm: the person agreed to remove a 3.2 or 3.3 sign-off (rule 17).
export async function importChecked(id: string, target: string | null, confirmDuplicates: boolean, confirm = false): Promise<
  { ok: true; imported: true; lines: number; outside: number; accounts: string[]; warnings: string[] } | { ok: true; imported: false; duplicates: { accountKey: string; lineIds: string[] }[] } | Fail> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return fail("You need Edit on Closebook to import.");
  const supabase = await createClient();
  const { data: row } = await supabase.from("cb_statement_imports").select("id, file_id, status, media_type, storage_path, result, edited").eq("id", id).maybeSingle();
  if (!row?.file_id) return fail("Statement not found.");
  const fileId = row.file_id as string;
  if (!["ready", "needs_look"].includes(row.status as string)) return fail("This statement is not ready to import.");
  const data = (row.edited ?? row.result) as ReadResult | null;
  if (!data) return fail("This statement has no lines yet.");
  const asRead = row.result as ReadResult | null;
  const [{ data: f }, { data: accts }] = await Promise.all([
    supabase.from("cb_files").select("year_start, year_end").eq("id", fileId).maybeSingle(),
    supabase.from("cb_bank_accounts").select("id, number, name, kind, last4").eq("file_id", fileId),
  ]);
  if (!f) return fail("File not found.");
  const file = { yearStart: f.year_start as string, yearEnd: f.year_end as string };
  const fileAccounts = (accts ?? []) as FileAccount[];
  const tgt = fileAccounts.find((x) => x.id === target) ?? null;
  // Round 28 (Hashim, Nov 17, 2026): no account checks, as QuickBooks Online. Uploaded to an account, the statement
  // goes to it. A file that holds several accounts (chequing and savings together) sends the section whose digits
  // match the account picked, else its first section with lines; the digits only choose, they never refuse.
  const withLines = data.accounts.filter((x) => x.lines.length);
  const td = digitsOnly(tgt?.last4);
  const pick = tgt ? (withLines.find((x) => { const d = digitsOnly(x.last4); return !!d && !!td && (td.endsWith(d) || d.endsWith(td)); }) ?? withLines[0]) : null;
  const chosen: { acc: StatementAccount; to: FileAccount }[] = [];
  for (const acc of withLines) {
    const to = tgt ? (acc === pick ? tgt : null) : accountFor(acc.last4, fileAccounts);
    if (!to) continue;
    const diff = checkAccount(acc).differenceCents;
    if (diff !== 0) return fail(`${to.number} ${to.name}: the statement does not balance yet. The difference is ${money(diff)}. It must be 0.00 to import.`);
    if (yearCut(acc, file.yearStart, file.yearEnd).outside) continue;
    chosen.push({ acc, to });
  }
  if (!chosen.length) return fail("No account on this statement is in this file, or the statement is outside the year. Add the account, or Skip the statement.");
  // Round 28: a line with no effect on the balance goes as information (no_effect), with its amount as printed; a
  // loan line's Transaction Date goes beside its Effective Date (printed).
  const rowsOf = (acc: StatementAccount) => acc.lines.map((l, i) => ({ line: i + 1, date: l.date, posted: l.postedDate ?? null, printed: l.printedDate ?? null,
    description: l.description.replace(/\s+/g, " ").trim(), amount: printedCents(l) / 100, holder: l.holder ?? null, no_effect: !!l.noEffect }));

  if (!confirmDuplicates) {
    const duplicates: { accountKey: string; lineIds: string[] }[] = [];
    for (const c of chosen) {
      const inYear = new Set(yearCut(c.acc, file.yearStart, file.yearEnd).inYear.map((l) => l.id));
      const rows = rowsOf(c.acc).filter((_, i) => inYear.has(c.acc.lines[i].id) && !c.acc.lines[i].noEffect);
      const { data: dups, error } = await supabase.rpc("cb_duplicate_lines", { p_file: fileId, p_rows: rows });
      if (error) return fail(error.message);
      const hit = new Set(((dups ?? []) as { row_no: number }[]).map((x) => x.row_no));
      if (hit.size) duplicates.push({ accountKey: c.acc.key, lineIds: c.acc.lines.filter((_, i) => hit.has(i + 1)).map((l) => l.id) });
    }
    if (duplicates.length) return { ok: true, imported: false, duplicates };
  }

  const bytes = await storedBytes(row.storage_path as string);
  if (!bytes) return fail("The uploaded file is missing. Upload it again.");
  const ext = (row.storage_path as string).split(".").pop() ?? "pdf";
  const attachment = `closebook/${fileId}/statements/${id}.${ext}`;
  const docs = createAdminClient().storage.from("documents");
  const up = await docs.upload(attachment, bytes, { contentType: row.media_type as string, upsert: true });
  if (up.error) return fail(`The statement was not imported: the PDF could not be attached (${up.error.message}).`);

  const warnings: string[] = [];
  const payload = chosen.map(({ acc, to }) => {
    const c = checkAccount(acc), cut = yearCut(acc, file.yearStart, file.yearEnd);
    const w = closebookWarnings(acc, { ...file, chosen: { last4: to.last4, kind: to.kind, name: to.name } }).filter((x) => !/outside the file's year/.test(x));
    warnings.push(...w);
    const ids = new Set(acc.lines.map((l) => l.id)), asReadAcc = asRead?.accounts.find((x) => x.key === acc.key);
    return {
      key: acc.key, account: to.id, last4: digitsOnly(acc.last4), opening: acc.opening / 100, closing: acc.closing / 100, period_start: acc.periodStart, period_end: acc.periodEnd,
      at_start: cut.atStart === null ? null : cut.atStart / 100, at_end: cut.atEnd === null ? null : cut.atEnd / 100, rows: rowsOf(acc),
      check: { differenceCents: c.differenceCents, inTotal: c.inTotal, inCount: c.inCount, outTotal: c.outTotal, outCount: c.outCount, summaryOk: c.summaryOk,
        runningBreak: c.runningBreak, review: c.review.length, ok: c.ok, warnings: w, loan: loanWords(acc), inYear: cut.inYear.length, outsideYear: acc.lines.length - cut.inYear.length },
      edits: { edited: acc.lines.filter((l) => l.source === "edited").length, added: acc.lines.filter((l) => l.source === "added").length,
        deleted: asReadAcc ? asReadAcc.lines.filter((l) => !ids.has(l.id)).length : 0 },
    };
  });
  const { data: res, error } = await supabase.rpc("cb_import_statement", { p_import: id, p_accounts: payload, p_confirm_dups: confirmDuplicates, p_attachment: attachment, p_confirm: confirm });
  if (error) { await docs.remove([attachment]); return fail(`Nothing was imported. ${error.message}`); }
  // Round 31 (step 4): bank rules with Auto-post run on the new Pending lines (QuickBooks Online runs rules as lines come in).
  if (await autoPostRules(supabase, fileId)) await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  const out = (res ?? []) as { lines: number; outside: number; account: string }[];
  return { ok: true, imported: true, lines: out.reduce((n, r) => n + Number(r.lines), 0), outside: out.reduce((n, r) => n + Number(r.outside), 0),
    accounts: chosen.map((c) => `${c.to.number} ${c.to.name}`), warnings };
}

