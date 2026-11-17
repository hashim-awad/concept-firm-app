import "server-only";
// Round 32 (Hashim, Nov 18, 2026): the client's own page for questions about their transactions (/cq/<token>).
// Firm decision (Hashim, Nov 17, 2026): no code. The link opens the questions directly, as DocuSign's default link does.
// One live link per file, unguessable (32 random bytes; only its hash is stored); it ends after 30 days, at the next good
// send or copy, or when the file is locked. Opening it changes nothing; each opening is logged in History with the device.
// Nothing on the client side sends an email. Never shows chart numbers, GIFI, staff names or the word "Closebook".
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountForClient, clientLineVisible, clientThread, ANSWER_EXT, ANSWER_FILES, ANSWER_MAX, ANSWER_TYPES, deviceOf, linkRefusal, type LinkRefusal } from "./questions";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Link = { id: string; file_id: string; active: boolean; sent: boolean; expires_at: string; reply_by: string | null; to_emails: string[]; line_ids: string[]; created_by: string | null };
// live: the link works. reason: why it does not (round 32 fix: the reply-by date plays no part).
export type CqLink = { link: Link; legalName: string; yearEnd: string; live: boolean; reason: LinkRefusal | null; email: string };

// The database could not be read (a missing right, an outage): never shown to the client as "no longer active".
export class CqReadError extends Error {}
const fail = (where: string, e: { message: string; code?: string }) => {
  console.error(`[client questions] ${where}: ${e.code ?? ""} ${e.message}`);
  return new CqReadError(`${where}: ${e.message}`);
};

// Round 32 fix: what the client sees on any database problem, never "no longer active".
export const ERROR_TEXT = "Something went wrong on our side. Please try again later, or contact Concept Accounting.";
// A database problem on the client page: History on the file and a bell notice to its preparer and reviewer.
export async function reportLinkError(token: string, reason: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  try {
    const { error } = await createAdminClient().rpc("cb_question_link_error", { p_token_hash: sha(token), p_reason: reason.slice(0, 200) });
    if (error) console.error(`[client questions] could not record the error (${reason}): ${error.message}`);
  } catch (e) { console.error(`[client questions] could not record the error (${reason}): ${e instanceof Error ? e.message : e}`); }
}

export async function findLink(token: string): Promise<CqLink | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const db = createAdminClient();
  const hash = sha(token);
  const { data: link, error } = await db.from("cb_question_links").select("id, file_id, active, sent, expires_at, reply_by, to_emails, line_ids, created_by").eq("token_hash", hash).maybeSingle();
  if (error) throw fail("read the link", error);
  if (!link) { console.warn(`[client questions] no link for token hash ${hash.slice(0, 12)}`); return null; }
  const { data: f, error: e2 } = await db.from("cb_files").select("year_end, phase, client:client_id(legal_name)").eq("id", link.file_id).maybeSingle();
  if (e2) throw fail("read the file", e2);
  const reason = f ? linkRefusal(link as Link, f.phase as string) : "locked";
  if (reason) {
    const { error: e3 } = await db.rpc("cb_question_link_refused", { p_link: link.id, p_reason: reason });
    if (e3) console.error(`[client questions] log the refusal: ${e3.message}`);
  }
  // Who answered, for History: the link's first contact (anyone with the link can answer; there is no sign-in).
  const email = (link.to_emails as string[])[0] ?? "client (copied link)";
  return { link: link as Link, legalName: (f?.client as unknown as { legal_name: string } | null)?.legal_name ?? "", yearEnd: (f?.year_end as string) ?? "", live: !reason, reason, email };
}

// Each opening of a live link, in History: phone, tablet, computer, or an automatic link check (a mail scanner).
export async function recordOpen(cq: CqLink, userAgent: string) {
  const { error } = await createAdminClient().rpc("cb_question_link_opened", { p_link: cq.link.id, p_device: deviceOf(userAgent) });
  if (error) throw fail("log the opening", error);
}

// What the client sees: each line on the link, its thread (our questions as the firm, never a staff name), and its files.
export type CqEntry = { kind: "q" | "a"; body: string; at: string; files: string[] };
export type CqCard = { id: string; date: string; account: string; description: string; cents: number; out: boolean; waiting: boolean; answered: boolean; thread: CqEntry[] };
export async function clientCards(cq: CqLink): Promise<CqCard[]> {
  const db = createAdminClient();
  const ids = cq.link.line_ids;
  if (!ids.length) return [];
  const [{ data: lines, error: x1 }, { data: accs, error: x2 }, { data: entries, error: x3 }, { data: files, error: x4 }] = await Promise.all([
    db.from("cb_bank_lines").select("id, account_id, txn_date, description, amount, status, chart_account, is_split, transfer_account, q_status").eq("file_id", cq.link.file_id).in("id", ids).order("txn_date").order("row_no"),
    db.from("cb_bank_accounts").select("id, bank, account_type, kind, last4").eq("file_id", cq.link.file_id),
    db.from("cb_line_questions").select("id, line_id, kind, body, created_at, sent_at, closed_at").eq("file_id", cq.link.file_id).in("line_id", ids).order("created_at"),
    db.from("cb_line_files").select("question_id, name").eq("file_id", cq.link.file_id).in("line_id", ids).not("question_id", "is", null),
  ]);
  const bad = x1 ?? x2 ?? x3 ?? x4;
  if (bad) throw fail("read the questions", bad);
  const acc = new Map(((accs ?? []) as { id: string; bank: string | null; account_type: string | null; kind: "bank" | "card"; last4: string | null }[]).map((a) => [a.id, a]));
  const fileNames = new Map<string, string[]>();
  for (const f of (files ?? []) as { question_id: string; name: string }[]) fileNames.set(f.question_id, [...(fileNames.get(f.question_id) ?? []), f.name]);
  // Round 33 / 35b: only lines that are Waiting or Answered, and only open questions that went out (never a note,
  // never a question not sent yet or closed by posting, never an excluded line). A posted line shows too.
  const out: CqCard[] = [];
  for (const l of (lines ?? []) as { id: string; account_id: string; txn_date: string; description: string; amount: number; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null; q_status: string }[]) {
    const thread = clientThread(((entries ?? []) as { id: string; line_id: string; kind: "q" | "a"; body: string; created_at: string; sent_at: string | null; closed_at: string | null }[]).filter((e) => e.line_id === l.id))
      .map((e) => ({ kind: e.kind, body: e.body, at: e.kind === "q" ? e.sent_at ?? e.created_at : e.created_at, files: fileNames.get(e.id) ?? [] }));
    if (!clientLineVisible(l, thread)) continue;
    const a = acc.get(l.account_id);
    const cents = Math.round(Number(l.amount) * 100);
    out.push({ id: l.id, date: l.txn_date, account: a ? accountForClient(a.bank, a.account_type, a.kind, a.last4) : "", description: l.description, cents,
      out: a?.kind === "card" ? cents > 0 : cents < 0, waiting: l.q_status === "waiting", answered: l.q_status === "answered", thread });
  }
  return out;
}

// Signed upload places for the client's files; checked again when the answer is sent.
export type CqUpload = { name: string; size: number; type: string };
export async function prepareUploads(cq: CqLink, lineId: string, files: CqUpload[]): Promise<{ ok: true; uploads: { path: string; token: string; name: string; size: number; contentType: string }[] } | { ok: false; error: string }> {
  if (!cq.link.line_ids.includes(lineId)) return { ok: false, error: "This question is not on your list." };
  if (files.length > ANSWER_FILES) return { ok: false, error: `Up to ${ANSWER_FILES} files per answer.` };
  for (const f of files) {
    if (!ANSWER_EXT.test(f.name) || (f.type && !ANSWER_TYPES.test(f.type))) return { ok: false, error: `${f.name}: only PDF, JPG, PNG or HEIC files.` };
    if (f.size > ANSWER_MAX) return { ok: false, error: `${f.name} is over 10 MB.` };
  }
  const store = createAdminClient().storage.from("documents");
  const out = [];
  for (const f of files) {
    const ext = f.name.split(".").pop()!.toLowerCase();
    const path = `closebook/${cq.link.file_id}/lines/${lineId}/client/${randomBytes(12).toString("hex")}.${ext}`;
    const { data, error } = await store.createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: "We could not get the upload ready. Please try again." };
    out.push({ path, token: data.token, name: f.name.slice(0, 200), size: f.size, contentType: f.type || (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext.startsWith("hei") ? "image/heic" : "image/jpeg") });
  }
  return { ok: true, uploads: out };
}

export async function submitAnswer(cq: CqLink, email: string, lineId: string, text: string, files: { path: string; name: string; size: number }[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cq.link.line_ids.includes(lineId)) return { ok: false, error: "This question is not on your list." };
  const db = createAdminClient();
  // Each file must be in the line's client folder, and there.
  const folder = `closebook/${cq.link.file_id}/lines/${lineId}/client`;
  if (files.length) {
    const { data: there } = await db.storage.from("documents").list(folder, { limit: 100 });
    const names = new Set((there ?? []).map((o) => `${folder}/${o.name}`));
    if (files.some((f) => !names.has(f.path))) return { ok: false, error: "A file did not finish uploading. Remove it and attach it again." };
  }
  const { error } = await db.rpc("cb_client_answer", { p_link: cq.link.id, p_line: lineId, p_email: email, p_text: text.slice(0, 2000), p_files: files });
  if (error) return { ok: false, error: error.message || "Your answer was not sent. Please try again." };
  return { ok: true };
}
