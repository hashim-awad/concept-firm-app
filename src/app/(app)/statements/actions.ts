"use server";
// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026): upload, poll, retry, discard, save edits and
// import. Each returns { ok: true, ... } or { ok: false, error } with the problem in plain words.
// Reads and changes go through the signed-in person's client (the database checks Closebook view or edit);
// files are stored with the secret key, after that check, as the other Closebook uploads are.

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rebuildTb } from "@/lib/closebook/tb-build-server";
import { BUCKET, kickRunner, listStatementsWithKick, removeStored, storedBytes, type StatementRow } from "@/lib/statements/server";
import { EXTENSION, MAX_UPLOAD_BYTES, mediaTypeOf } from "@/lib/statements/prepare";
import { checkAccount, closebookWarnings, money, resultProblem, statementStatus, statementSummary } from "@/lib/statements/checks";
import { signedCents, type ReadResult, type StatementAccount } from "@/lib/statements/types";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const MAX_FILES = 50;

// Upload one or many statements: FormData "files" (many), "fileId" (a Closebook file; none = the
// standalone tool). Each file is its own job; the reader starts after the response.
export async function uploadStatements(fd: FormData): Promise<{ ok: true; ids: string[] } | Fail> {
  const a = await getAccess();
  const fileId = String(fd.get("fileId") ?? "").trim() || null;
  if (!a || !canView(a, "closebook")) return fail("You need Closebook to use this tool.");
  if (fileId && !canEdit(a, "closebook")) return fail("You need Edit on Closebook to upload.");
  if (fileId && !/^[0-9a-f-]{36}$/i.test(fileId)) return fail("File not found.");
  const files = fd.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) return fail("Choose the statements to upload (PDF, or photos: JPG, PNG or HEIC).");
  if (files.length > MAX_FILES) return fail(`Up to ${MAX_FILES} files at a time.`);
  for (const f of files) {
    if (!mediaTypeOf(f.name, f.type)) return fail(`${f.name} is not a PDF or a photo (JPG, PNG or HEIC). Nothing was uploaded.`);
    if (f.size > MAX_UPLOAD_BYTES) return fail(`${f.name} is over 30 MB. Split it, or scan it again at a lower resolution. Nothing was uploaded.`);
  }
  const supabase = await createClient();
  const store = createAdminClient().storage.from(BUCKET);
  const ids: string[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const type = mediaTypeOf(f.name, f.type)!;
    const id = randomUUID();
    const path = fileId ? `file/${fileId}/${id}.${EXTENSION[type]}` : `tool/${a.staff_id}/${id}.${EXTENSION[type]}`;
    const up = await store.upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: type, upsert: false });
    if (up.error) { problems.push(`${f.name} was not saved: ${up.error.message}`); continue; }
    const { error } = await supabase.rpc("statement_create_job", { p_id: id, p_file: fileId, p_file_name: f.name.slice(0, 200), p_media_type: type, p_storage_path: path });
    if (error) { await store.remove([path]); problems.push(`${f.name}: ${error.message}`); continue; }
    ids.push(id);
  }
  if (ids.length) after(() => kickRunner());
  if (fileId) revalidatePath(`/closebook/${fileId}`);
  if (!ids.length) return fail(problems.join(" ") || "Nothing was uploaded.");
  if (problems.length) return fail(`${ids.length} uploaded. ${problems.join(" ")}`);
  return { ok: true, ids };
}

// Direct upload, for files over the 4.5 MB a request to the server can carry (scans, phone photos):
// 1. createStatementUploads makes the jobs (status "uploading", not read yet) and a signed upload link per
//    file in the private bucket. 2. The browser sends each file with
//    supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType }).
// 3. confirmStatementUploads checks each file arrived (and its size), queues it and wakes the reader.
export async function createStatementUploads(fileId: string | null, files: { name: string; size: number; type: string }[]): Promise<
  { ok: true; bucket: string; uploads: { id: string; name: string; path: string; token: string; contentType: string }[] } | Fail> {
  const a = await getAccess();
  if (!a || !canView(a, "closebook")) return fail("You need Closebook to use this tool.");
  if (fileId && !canEdit(a, "closebook")) return fail("You need Edit on Closebook to upload.");
  if (fileId && !/^[0-9a-f-]{36}$/i.test(fileId)) return fail("File not found.");
  if (!Array.isArray(files) || !files.length) return fail("Choose the statements to upload (PDF, or photos: JPG, PNG or HEIC).");
  if (files.length > MAX_FILES) return fail(`Up to ${MAX_FILES} files at a time.`);
  for (const f of files) {
    if (!f || typeof f.name !== "string" || !mediaTypeOf(f.name, String(f.type ?? ""))) return fail(`${f?.name ?? "A file"} is not a PDF or a photo (JPG, PNG or HEIC). Nothing was uploaded.`);
    if (!(Number(f.size) > 0)) return fail(`${f.name} is empty. Nothing was uploaded.`);
    if (Number(f.size) > MAX_UPLOAD_BYTES) return fail(`${f.name} is over 30 MB. Split it, or scan it again at a lower resolution. Nothing was uploaded.`);
  }
  const supabase = await createClient();
  const store = createAdminClient().storage.from(BUCKET);
  const uploads: { id: string; name: string; path: string; token: string; contentType: string }[] = [];
  for (const f of files) {
    const type = mediaTypeOf(f.name, String(f.type ?? ""))!;
    const id = randomUUID();
    const path = fileId ? `file/${fileId}/${id}.${EXTENSION[type]}` : `tool/${a.staff_id}/${id}.${EXTENSION[type]}`;
    const { error } = await supabase.rpc("statement_begin_upload", { p_id: id, p_file: fileId, p_file_name: f.name.slice(0, 200), p_media_type: type, p_storage_path: path });
    if (error) return fail(`${f.name}: ${error.message}`);
    const signed = await store.createSignedUploadUrl(path);
    if (signed.error || !signed.data) return fail(`${f.name} could not be prepared for upload: ${signed.error?.message ?? "no link"}.`);
    uploads.push({ id, name: f.name, path: signed.data.path, token: signed.data.token, contentType: type });
  }
  return { ok: true, bucket: BUCKET, uploads };
}

// The browser's uploads are done. Each file must be in storage, up to 30 MB; then it is queued for reading.
// A file that did not arrive is reported by name and stays out of the list (it is removed after 24 hours).
export async function confirmStatementUploads(ids: string[]): Promise<{ ok: true; ids: string[] } | Fail> {
  const a = await getAccess();
  if (!a || !canView(a, "closebook")) return fail("You need Closebook to use this tool.");
  if (!Array.isArray(ids) || !ids.length) return fail("Nothing to confirm.");
  const supabase = await createClient();
  const { data } = await supabase.from("cb_statement_imports").select("id, file_id, file_name, storage_path, status").in("id", ids.slice(0, MAX_FILES));
  const rows = (data ?? []) as { id: string; file_id: string | null; file_name: string; storage_path: string; status: string }[];
  const store = createAdminClient().storage.from(BUCKET);
  const done: string[] = [], problems: string[] = [];
  for (const r of rows) {
    if (r.status !== "uploading") { if (r.status !== "discarded") done.push(r.id); continue; }
    const info = await store.info(r.storage_path);
    if (info.error || !info.data) { problems.push(`${r.file_name} did not arrive. Upload it again.`); continue; }
    if ((info.data.size ?? 0) > MAX_UPLOAD_BYTES) {
      await supabase.rpc("statement_discard", { p_id: r.id });
      await store.remove([r.storage_path]);
      problems.push(`${r.file_name} is over 30 MB and was not kept.`);
      continue;
    }
    const { error } = await supabase.rpc("statement_confirm_upload", { p_id: r.id });
    if (error) { problems.push(`${r.file_name}: ${error.message}`); continue; }
    done.push(r.id);
  }
  if (rows.length < ids.length) problems.push("Some uploads were not found.");
  if (done.length) after(() => kickRunner());
  for (const f of new Set(rows.map((r) => r.file_id).filter((x): x is string => !!x))) revalidatePath(`/closebook/${f}`);
  if (problems.length) return fail(`${done.length ? `${done.length} uploaded. ` : ""}${problems.join(" ")}`);
  return { ok: true, ids: done };
}

// The list, for the screen to refresh. Wakes the runner when a job waits and none is reading, so a job
// whose runner stopped carries on.
export async function pollStatements(fileId: string | null): Promise<{ ok: true; rows: StatementRow[] } | Fail> {
  const a = await getAccess();
  if (!a || !canView(a, "closebook")) return fail("You need Closebook to see statements.");
  const { rows, kick } = await listStatementsWithKick(fileId);
  if (kick) after(() => kickRunner());
  return { ok: true, rows };
}

async function fileOf(id: string): Promise<string | null> {
  const { data } = await (await createClient()).from("cb_statement_imports").select("file_id").eq("id", id).maybeSingle();
  return (data?.file_id as string | null) ?? null;
}

export async function retryStatement(id: string): Promise<{ ok: true } | Fail> {
  const { error } = await (await createClient()).rpc("statement_retry", { p_id: id });
  if (error) return fail(error.message);
  after(() => kickRunner());
  const f = await fileOf(id);
  if (f) revalidatePath(`/closebook/${f}`);
  return { ok: true };
}

// A file's statement stays listed as discarded in its history; a standalone one is deleted (a log row stays).
export async function discardStatement(id: string): Promise<{ ok: true } | Fail> {
  const f = await fileOf(id);
  const { data, error } = await (await createClient()).rpc("statement_discard", { p_id: id });
  if (error) return fail(error.message);
  await removeStored([data as string | null]);
  if (f) revalidatePath(`/closebook/${f}`);
  return { ok: true };
}

// Bank statement PDF to CSV, "Done" (fix, Hashim, Nov 15, 2026): deletes every statement on the person's
// page at once. The log keeps only who, when, pages and cost.
export async function doneStatements(): Promise<{ ok: true; deleted: number } | Fail> {
  const { data, error } = await (await createClient()).rpc("statement_done_standalone");
  if (error) return fail(error.message);
  const paths = (data ?? []) as string[];
  await removeStored(paths);
  revalidatePath("/admin/bank-pdf");
  return { ok: true, deleted: paths.length };
}

// The verify screen's working copy. The status follows the checks: all good is "Ready to check".
export async function saveStatementEdits(id: string, data: ReadResult): Promise<{ ok: true; status: "ready" | "needs_look" } | Fail> {
  const problem = resultProblem(data);
  if (problem) return fail(`Not saved. ${problem}`);
  const status = statementStatus(data);
  const { error } = await (await createClient()).rpc("statement_save_edits", { p_id: id, p_edited: data, p_summary: statementSummary(data), p_status: status });
  if (error) return fail(error.message);
  return { ok: true, status };
}

// Lines edited, added and deleted before import, against the lines as read.
function editsOf(acc: StatementAccount, asRead: StatementAccount | undefined) {
  const ids = new Set(acc.lines.map((l) => l.id));
  return {
    edited: acc.lines.filter((l) => l.source === "edited").length,
    added: acc.lines.filter((l) => l.source === "added").length,
    deleted: asRead ? asRead.lines.filter((l) => !ids.has(l.id)).length : 0,
  };
}

type Assign = Record<string, string>; // account key -> bank account id | "skip" | "new:<bank|card>:<name>"

// Import into the file: per account, the CSV path (cb_upload_bank, then cb_flag_uploaded_duplicates when
// confirmed), all in one step; then the trial balance is rebuilt. The first call without confirmation
// returns the lines already in the file, if any, and imports nothing.
export async function importStatement(id: string, assign: Assign, confirmDuplicates: boolean): Promise<
  { ok: true; imported: true; statements: number; lines: number; warnings: string[]; duplicates?: undefined } |
  { ok: true; imported: false; duplicates: { accountKey: string; lineIds: string[] }[] } | Fail> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return fail("You need Edit on Closebook to import.");
  const supabase = await createClient();
  const { data: row } = await supabase.from("cb_statement_imports").select("id, file_id, status, file_name, media_type, storage_path, result, edited").eq("id", id).maybeSingle();
  if (!row) return fail("Statement not found.");
  const fileId = row.file_id as string | null;
  if (!fileId) return fail("This statement does not belong to a file.");
  if (!["ready", "needs_look"].includes(row.status as string)) return fail("This statement is not ready to import.");
  const data = ((row.edited ?? row.result) as ReadResult | null);
  if (!data) return fail("This statement has no lines yet.");
  const asRead = row.result as ReadResult | null;

  const [{ data: f }, { data: accts }] = await Promise.all([
    supabase.from("cb_files").select("year_start, year_end").eq("id", fileId).maybeSingle(),
    supabase.from("cb_bank_accounts").select("id, name, kind, last4").eq("file_id", fileId),
  ]);
  const bankAccounts = (accts ?? []) as { id: string; name: string; kind: "bank" | "card"; last4: string | null }[];

  const chosen: { acc: StatementAccount; target: { account: string | null; name: string; kind: string } }[] = [];
  for (const acc of data.accounts) {
    const label = `${acc.name || "An account"}${acc.last4 ? ` ending ${acc.last4}` : ""}`;
    const pick = assign[acc.key];
    if (!pick) {
      if (acc.lines.length) return fail(`Choose an account for ${label}, or Skip it.`);
      continue;
    }
    if (pick === "skip") continue;
    const diff = checkAccount(acc).differenceCents;
    if (diff !== 0) return fail(`${label} does not balance yet: the difference is ${money(diff)}. It must be 0.00 to import.`);
    if (!acc.lines.length) return fail(`${label} has no lines to import. Skip it.`);
    const m = /^new:(bank|card):(.+)$/.exec(pick);
    if (m) chosen.push({ acc, target: { account: null, kind: m[1], name: m[2].trim() } });
    else if (bankAccounts.some((b) => b.id === pick)) chosen.push({ acc, target: { account: pick, kind: "", name: "" } });
    else return fail(`Choose an account on this file for ${label}.`);
  }
  if (!chosen.length) return fail("Choose an account for at least one statement, or discard it.");

  const rowsOf = (acc: StatementAccount) => acc.lines.map((l, i) => ({ line: i + 1, date: l.date, description: l.description.replace(/\s+/g, " ").trim(), amount: signedCents(l) / 100 }));

  // Lines already in the file (same date, description and amount), as the CSV upload checks.
  if (!confirmDuplicates) {
    const duplicates: { accountKey: string; lineIds: string[] }[] = [];
    for (const c of chosen) {
      const { data: dups, error } = await supabase.rpc("cb_duplicate_lines", { p_file: fileId, p_rows: rowsOf(c.acc) });
      if (error) return fail(error.message);
      const hit = new Set(((dups ?? []) as { row_no: number }[]).map((d) => d.row_no));
      if (hit.size) duplicates.push({ accountKey: c.acc.key, lineIds: c.acc.lines.filter((_, i) => hit.has(i + 1)).map((l) => l.id) });
    }
    if (duplicates.length) return { ok: true, imported: false, duplicates };
  }

  // The PDF (or photo) becomes the statement's attachment, in the private documents store.
  const bytes = await storedBytes(row.storage_path as string);
  if (!bytes) return fail("The uploaded file is missing. Upload it again.");
  const ext = (row.storage_path as string).split(".").pop() ?? "pdf";
  const attachment = `closebook/${fileId}/statements/${id}.${ext}`;
  const docs = createAdminClient().storage.from("documents");
  const up = await docs.upload(attachment, bytes, { contentType: row.media_type as string, upsert: true });
  if (up.error) return fail(`The statement was not imported: the PDF could not be attached (${up.error.message}).`);

  const warnings: string[] = [];
  const payload = chosen.map(({ acc, target }) => {
    const c = checkAccount(acc);
    const b = target.account ? bankAccounts.find((x) => x.id === target.account)! : null;
    const w = f ? closebookWarnings(acc, { yearStart: f.year_start as string, yearEnd: f.year_end as string, chosen: b ? { last4: b.last4, kind: b.kind, name: b.name } : null }) : [];
    warnings.push(...w);
    return {
      key: acc.key, account: target.account, name: target.name, kind: target.kind, last4: acc.last4,
      opening: acc.opening / 100, closing: acc.closing / 100, period_start: acc.periodStart, period_end: acc.periodEnd,
      rows: rowsOf(acc),
      check: { differenceCents: c.differenceCents, inTotal: c.inTotal, inCount: c.inCount, outTotal: c.outTotal, outCount: c.outCount,
        summaryOk: c.summaryOk, runningBreak: c.runningBreak, review: c.review.length, ok: c.ok, warnings: w },
      edits: editsOf(acc, asRead?.accounts.find((x) => x.key === acc.key)),
    };
  });
  const { data: res, error } = await supabase.rpc("cb_import_statement", { p_import: id, p_accounts: payload, p_confirm_dups: confirmDuplicates, p_attachment: attachment });
  if (error) {
    await docs.remove([attachment]);
    return fail(`Nothing was imported. ${error.message}`);
  }
  await rebuildTb(supabase, fileId);
  revalidatePath(`/closebook/${fileId}`);
  const out = (res ?? []) as { lines: number }[];
  return { ok: true, imported: true, statements: out.length, lines: out.reduce((n, r) => n + Number(r.lines), 0), warnings };
}
