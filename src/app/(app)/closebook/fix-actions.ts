"use server";
// Round 26 (Hashim, Nov 17, 2026): the fix screen before import. The person can add a missing line, remove a line
// read wrongly (with a reason), take in lines the reader put under another cardholder's card, and have the same
// file read again. Each is saved to the working copy at once and logged with who and the values ("Added before
// import"). After import nothing about a line's amount or description changes (round 24).
// Benchmark: QuickBooks Online "Verify details" and Dext's line editing before publishing.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { kickRunner, removeStored } from "@/lib/statements/server";
import { resultProblem, statementStatus, statementSummary } from "@/lib/statements/checks";
import { typeLabel, type ReadResult, type StatementAccount, type StatementLine } from "@/lib/statements/types";
import { parseAmount } from "@/lib/closebook/amount";
import { plainError } from "@/lib/plain-error";
import { formatDate } from "@/lib/dates";

type Fail = { ok: false; error: string };
type Done = { ok: true; data: ReadResult } | Fail;
const fail = (error: string): Fail => ({ ok: false, error: plainError(error) });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (s: string, n: number) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)).toISOString().slice(0, 10);
const dollars = (c: number) => (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lineText = (kind: StatementAccount["kind"], l: Pick<StatementLine, "date" | "description" | "dir" | "amountCents">) =>
  `${l.date} · ${l.description} · ${typeLabel(kind, l.dir)} · ${dollars(l.amountCents)}`;
const refOf = (a: StatementAccount) => `${a.name}${a.last4 ? ` ••• ${a.last4}` : ""} · ${a.periodStart} to ${a.periodEnd}`;

// The statement's working copy, for a file statement not imported yet.
async function working(id: string) {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return { error: "You need Edit on Closebook." } as const;
  const supabase = await createClient();
  const { data: row } = await supabase.from("cb_statement_imports").select("id, file_id, status, result, edited").eq("id", id).maybeSingle();
  if (!row?.file_id) return { error: "Statement not found." } as const;
  if (!["ready", "needs_look"].includes(row.status as string)) return { error: "This statement is already imported, or still being read: its lines cannot change here." } as const;
  const data = (row.edited ?? row.result) as ReadResult | null;
  if (!data?.accounts?.length) return { error: "This statement has no lines yet." } as const;
  return { supabase, fileId: row.file_id as string, data: structuredClone(data) } as const;
}

async function save(supabase: Awaited<ReturnType<typeof createClient>>, id: string, fileId: string, data: ReadResult,
  note: { action: string; detail: string; ref: string; reason?: string; old?: string; now?: string }): Promise<Done> {
  const problem = resultProblem(data);
  if (problem) return fail(`Not saved. ${problem}`);
  const { error } = await supabase.rpc("statement_save_edits", { p_id: id, p_edited: data, p_summary: statementSummary(data), p_status: statementStatus(data) });
  if (error) return fail(error.message);
  const { error: e2 } = await supabase.rpc("cb_statement_note", { p_import: id, p_action: note.action, p_detail: note.detail, p_ref: note.ref, p_reason: note.reason ?? "",
    p_old: note.old ?? "", p_new: note.now ?? "" });
  if (e2) return fail(e2.message);
  revalidatePath(`/closebook/${fileId}`);
  return { ok: true, data };
}

// "Add missing line": placed in date order (after the lines of the same day); the checks run again on the page.
export async function addMissingLine(id: string, accKey: string, v: { date: string; description: string; dir: "in" | "out"; amount: string }): Promise<Done> {
  const w = await working(id);
  if ("error" in w) return fail(w.error!);
  const acc = w.data.accounts.find((a) => a.key === accKey);
  if (!acc) return fail("That account is not on this statement.");
  const date = v.date.trim(), description = v.description.replace(/\s+/g, " ").trim(), cents = parseAmount(v.amount);
  if (!DATE.test(date) || date < shift(acc.periodStart, -40) || date > acc.periodEnd) return fail(`Enter the date as printed, inside the statement period (${formatDate(acc.periodStart)} to ${formatDate(acc.periodEnd)}).`);
  if (!description || description.length > 500) return fail("Enter the description as printed.");
  if (v.dir !== "in" && v.dir !== "out") return fail("Choose the type.");
  if (cents === null || cents <= 0) return fail("Enter the amount as printed, for example 25.40.");
  const used = new Set(w.data.accounts.flatMap((a) => a.lines.map((l) => l.id)));
  let n = 1; while (used.has(`a${n}`)) n++;
  const at = acc.lines.findIndex((l) => l.date > date);
  const near = acc.lines[at === -1 ? acc.lines.length - 1 : at];
  const line: StatementLine = { id: `a${n}`, date, postedDate: null, description, amountCents: cents, dir: v.dir, balanceCents: null, page: near?.page ?? 1,
    unsure: false, unsureReason: "", source: "added", cardKind: acc.kind === "card" ? (v.dir === "in" ? "purchase" : "payment") : null, holder: null };
  acc.lines.splice(at === -1 ? acc.lines.length : at, 0, line);
  return save(w.supabase, id, w.fileId, w.data, { action: "line_added_before_import", detail: "Added before import", ref: refOf(acc), now: lineText(acc.kind, line) });
}

// "Remove line": a line read wrongly (read twice, or not on the statement), with a reason.
export async function removeReadLine(id: string, accKey: string, lineId: string, reason: string): Promise<Done> {
  const w = await working(id);
  if ("error" in w) return fail(w.error!);
  const acc = w.data.accounts.find((a) => a.key === accKey);
  const line = acc?.lines.find((l) => l.id === lineId);
  if (!acc || !line) return fail("That line is not on this statement.");
  const why = reason.replace(/\s+/g, " ").trim();
  if (why.length < 3) return fail("Say why the line is removed.");
  acc.lines = acc.lines.filter((l) => l.id !== lineId);
  return save(w.supabase, id, w.fileId, w.data, { action: "line_removed_before_import", detail: "Removed before import", ref: refOf(acc), reason: why, old: lineText(acc.kind, line) });
}

// The lines the reader put under another card number of the same statement (another cardholder's section): the person
// adds them to this account. Each keeps that card's last digits as information.
export async function takeHolderLines(id: string, accKey: string, fromKey: string): Promise<Done> {
  const w = await working(id);
  if ("error" in w) return fail(w.error!);
  const acc = w.data.accounts.find((a) => a.key === accKey), from = w.data.accounts.find((a) => a.key === fromKey);
  if (!acc || !from || acc === from) return fail("Those lines are not on this statement.");
  if (acc.kind !== "card" || from.kind !== "card" || from.periodStart !== acc.periodStart || from.periodEnd !== acc.periodEnd) return fail("Only another cardholder's lines on the same card statement can be added.");
  const moved = from.lines.map((l) => ({ ...l, holder: l.holder || from.last4 || null }));
  acc.lines = [...acc.lines, ...moved].sort((a, b) => a.date.localeCompare(b.date));
  w.data.accounts = w.data.accounts.filter((a) => a !== from);
  const total = moved.reduce((n, l) => n + (l.dir === "in" ? l.amountCents : -l.amountCents), 0);
  return save(w.supabase, id, w.fileId, w.data, { action: "line_added_before_import", detail: "Added before import", ref: refOf(acc),
    reason: `Cardholder section ••• ${from.last4 || "?"} on the same statement`, now: `${moved.length} line${moved.length === 1 ? "" : "s"}, ${dollars(total)}` });
}

// "Read again": the same stored files go back to the reader; when each is read, its lines replace the lines read
// before and any changes made before import. Imported statements are never read again.
export async function readStatementsAgain(ids: string[]): Promise<{ ok: true; queued: number } | Fail> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return fail("You need Edit on Closebook.");
  if (!ids.length || ids.length > 60) return fail("Choose the statements to read again.");
  const supabase = await createClient();
  let queued = 0;
  for (const id of ids) {
    const { error } = await supabase.rpc("statement_read_again", { p_id: id });
    if (error) return fail(queued ? `${queued} sent to be read again; then: ${error.message}` : error.message);
    queued++;
  }
  after(() => kickRunner());
  const { data: f } = await supabase.from("cb_statement_imports").select("file_id").eq("id", ids[0]).maybeSingle();
  if (f?.file_id) revalidatePath(`/closebook/${f.file_id}`);
  return { ok: true, queued };
}

// Round 29 (Hashim, Nov 17, 2026): a refused upload goes to the file's History ("Upload refused", with the file and
// the reason). discard: also remove the upload (a statement for nothing in this file, already in, or outside the
// year); otherwise it stays waiting (a statement that read but did not import).
export async function refuseUpload(id: string, reason: string, discard = true): Promise<{ ok: true } | Fail> {
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) return fail("You need Edit on Closebook.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("statement_refuse", { p_id: id, p_reason: reason, p_discard: discard });
  if (error) return fail(error.message);
  if (discard) await removeStored([data as string | null]);
  return { ok: true };
}
