import "server-only";
// Round 32 (Hashim, Nov 18, 2026): the client's own page for questions about their transactions (/cq/<token>).
// One live link per file; a 6-digit code to the first To address (10 minutes); 5 wrong codes lock the link for 15 minutes;
// the browser stays signed in until the link expires. Never shows chart numbers, GIFI, staff names or the word "Closebook".
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/email/graph";
import { emailAllowed } from "@/lib/email/safety";
import { FIRM } from "@/components/ds/brand";
import { accountForClient, ANSWER_EXT, ANSWER_FILES, ANSWER_MAX, ANSWER_TYPES, linkRefusal, maskEmail, type LinkRefusal } from "./questions";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const CODE_MINUTES = 10, LOCK_MINUTES = 15, MAX_TRIES = 5, RESEND_SECONDS = 30;
export const cookieName = (linkId: string) => `cq_${linkId.replace(/-/g, "").slice(0, 16)}`;

type Link = { id: string; file_id: string; active: boolean; sent: boolean; expires_at: string; reply_by: string | null; to_emails: string[]; line_ids: string[]; failed_codes: number; locked_until: string | null; created_by: string | null };
// live: the link works. reason: why it does not (round 32 fix: the reply-by date plays no part).
export type CqLink = { link: Link; legalName: string; yearEnd: string; live: boolean; reason: LinkRefusal | null; email: string; masked: string };

// The database could not be read (a missing right, an outage): never shown to the client as "no longer active".
export class CqReadError extends Error {}
const fail = (where: string, e: { message: string; code?: string }) => {
  console.error(`[client questions] ${where}: ${e.code ?? ""} ${e.message}`);
  return new CqReadError(`${where}: ${e.message}`);
};

export async function findLink(token: string): Promise<CqLink | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const db = createAdminClient();
  const hash = sha(token);
  const { data: link, error } = await db.from("cb_question_links").select("id, file_id, active, sent, expires_at, reply_by, to_emails, line_ids, failed_codes, locked_until, created_by").eq("token_hash", hash).maybeSingle();
  if (error) throw fail("read the link", error);
  if (!link) { console.warn(`[client questions] no link for token hash ${hash.slice(0, 12)}`); return null; }
  const { data: f, error: e2 } = await db.from("cb_files").select("year_end, phase, client:client_id(legal_name)").eq("id", link.file_id).maybeSingle();
  if (e2) throw fail("read the file", e2);
  const reason = f ? linkRefusal(link as Link, f.phase as string) : "locked";
  if (reason) {
    const { error: e3 } = await db.rpc("cb_question_link_refused", { p_link: link.id, p_reason: reason });
    if (e3) console.error(`[client questions] log the refusal: ${e3.message}`);
  }
  const email = (link.to_emails as string[])[0] ?? "";
  return { link: link as Link, legalName: (f?.client as unknown as { legal_name: string } | null)?.legal_name ?? "", yearEnd: (f?.year_end as string) ?? "", live: !reason, reason, email, masked: maskEmail(email) };
}

// The browser's session for this link, from its cookie.
export async function sessionOk(linkId: string, cookie: string | undefined): Promise<string | null> {
  if (!cookie || !/^[0-9a-f]{64}$/.test(cookie)) return null;
  const { data, error } = await createAdminClient().from("cb_question_sessions").select("email, expires_at").eq("link_id", linkId).eq("session_hash", sha(cookie)).maybeSingle();
  if (error) throw fail("read the session", error);
  return data && new Date(data.expires_at) > new Date() ? (data.email as string) : null;
}

const lockedFor = (l: Link) => (l.locked_until && new Date(l.locked_until) > new Date() ? Math.ceil((new Date(l.locked_until).getTime() - Date.now()) / 60_000) : 0);
const lockedText = (m: number) => `Too many wrong codes. Try again in ${m} minute${m === 1 ? "" : "s"}.`;
const GONE_TEXT = "This link is no longer active.";

// A new code, emailed to the first To address. A second request within 30 seconds sends nothing new. An earlier code
// still works until its 10 minutes end, so a page opened twice (or by a mail scanner) never spoils the code in the email.
export async function requestCode(cq: CqLink): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cq.live || !cq.email) return { ok: false, error: GONE_TEXT };
  const m = lockedFor(cq.link); if (m) return { ok: false, error: lockedText(m) };
  const db = createAdminClient();
  const { data: last, error: e0 } = await db.from("cb_question_codes").select("created_at").eq("link_id", cq.link.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (e0) { fail("read the codes", e0); return { ok: false, error: "We could not make a code. Please try again in a few minutes." }; }
  if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_SECONDS * 1000) return { ok: true };
  if (!emailAllowed(cq.email)) return { ok: false, error: "The Test app only emails the firm's own test addresses." };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db.from("cb_question_codes").insert({ link_id: cq.link.id, email: cq.email, code_hash: sha(`${cq.link.id}:${code}`), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString() });
  if (error) { fail("save the code", error); return { ok: false, error: "We could not make a code. Please try again in a few minutes." }; }
  try {
    await sendMail({ to: cq.email, subject: `Your code is ${code}`, html: codeEmail(code) });
  } catch (e) { console.error(`[client questions] send the code: ${e instanceof Error ? e.message : e}`); return { ok: false, error: "We could not send the code. Please try again in a few minutes." }; }
  return { ok: true };
}
export const codeEmail = (code: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2933;line-height:1.5">
<p>Your code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:8px 0">${code}</p>
<p>Enter it on the page to see your questions. It works for ${CODE_MINUTES} minutes.</p>
<p>If you did not ask for this code, you can ignore this email.</p>
<p style="color:#555">${FIRM.legalName}</p></div>`;

// Check the code against every unused code of the last 10 minutes. Right: a session until the link ends. Wrong 5 times: locked 15 minutes.
export async function verifyCode(cq: CqLink, code: string): Promise<{ ok: true; session: string; expires: Date } | { ok: false; error: string }> {
  if (!cq.live) return { ok: false, error: GONE_TEXT };
  const m = lockedFor(cq.link); if (m) return { ok: false, error: lockedText(m) };
  const db = createAdminClient();
  const busy = { ok: false as const, error: "We could not check the code just now. Please try again in a few minutes." };
  const { data: codes, error: e0 } = await db.from("cb_question_codes").select("id, code_hash, expires_at").eq("link_id", cq.link.id).is("used_at", null).order("created_at", { ascending: false }).limit(5);
  if (e0) { fail("read the codes", e0); return busy; }
  const given = Buffer.from(sha(`${cq.link.id}:${code.replace(/\D/g, "")}`));
  const now = new Date();
  const fresh = (codes ?? []).filter((c) => new Date(c.expires_at) > now);
  const right = fresh.find((c) => timingSafeEqual(Buffer.from(c.code_hash), given));
  if (!right) {
    const tries = cq.link.failed_codes + 1;
    if (tries >= MAX_TRIES) {
      const { error } = await db.from("cb_question_links").update({ failed_codes: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() }).eq("id", cq.link.id);
      if (error) { fail("lock the link", error); return busy; }
      return { ok: false, error: lockedText(LOCK_MINUTES) };
    }
    const { error } = await db.from("cb_question_links").update({ failed_codes: tries }).eq("id", cq.link.id);
    if (error) { fail("count the try", error); return busy; }
    if (!fresh.length && (codes ?? []).length) return { ok: false, error: "That code has expired. Send a new code." };
    return { ok: false, error: `That code is not right. You have ${MAX_TRIES - tries} more ${MAX_TRIES - tries === 1 ? "try" : "tries"}.` };
  }
  const session = randomBytes(32).toString("hex");
  const expires = new Date(cq.link.expires_at);
  const { error: e1 } = await db.from("cb_question_sessions").insert({ link_id: cq.link.id, session_hash: sha(session), email: cq.email, expires_at: expires.toISOString() });
  if (e1) { fail("start the session", e1); return busy; }
  await db.from("cb_question_codes").update({ used_at: now.toISOString() }).eq("link_id", cq.link.id).is("used_at", null);
  await db.from("cb_question_links").update({ failed_codes: 0, locked_until: null }).eq("id", cq.link.id);
  return { ok: true, session, expires };
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
    db.from("cb_line_questions").select("id, line_id, kind, body, created_at").eq("file_id", cq.link.file_id).in("line_id", ids).order("created_at"),
    db.from("cb_line_files").select("question_id, name").eq("file_id", cq.link.file_id).in("line_id", ids).not("question_id", "is", null),
  ]);
  const bad = x1 ?? x2 ?? x3 ?? x4;
  if (bad) throw fail("read the questions", bad);
  const acc = new Map(((accs ?? []) as { id: string; bank: string | null; account_type: string | null; kind: "bank" | "card"; last4: string | null }[]).map((a) => [a.id, a]));
  const fileNames = new Map<string, string[]>();
  for (const f of (files ?? []) as { question_id: string; name: string }[]) fileNames.set(f.question_id, [...(fileNames.get(f.question_id) ?? []), f.name]);
  return ((lines ?? []) as { id: string; account_id: string; txn_date: string; description: string; amount: number; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null; q_status: string }[]).map((l) => {
    const a = acc.get(l.account_id);
    const cents = Math.round(Number(l.amount) * 100);
    const thread = ((entries ?? []) as { id: string; line_id: string; kind: "q" | "a"; body: string; created_at: string }[]).filter((e) => e.line_id === l.id)
      .map((e) => ({ kind: e.kind, body: e.body, at: e.created_at, files: fileNames.get(e.id) ?? [] }));
    const pending = !l.chart_account && !l.is_split && !l.transfer_account && ["new", "ask_client", "reviewer"].includes(l.status);
    return { id: l.id, date: l.txn_date, account: a ? accountForClient(a.bank, a.account_type, a.kind, a.last4) : "", description: l.description, cents,
      out: a?.kind === "card" ? cents > 0 : cents < 0, waiting: l.q_status === "waiting" && pending, answered: thread.some((e) => e.kind === "a"), thread };
  });
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
