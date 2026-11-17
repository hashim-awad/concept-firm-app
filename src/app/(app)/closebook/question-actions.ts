"use server";
// Round 32 (Hashim, Nov 18, 2026): asking the client about lines, and notifying them. Firm decision: staff and owners can
// both ask and notify. Benchmarks: TaxDome's transaction questions; CaseWare Cloud's Queries (due date, contacts, history).
import { createHash, randomBytes } from "node:crypto";
import { getAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { plainError } from "@/lib/plain-error";
import { env } from "@/lib/env";
import { todayToronto } from "@/lib/dates";
import { mailReady, sendMail } from "@/lib/email/graph";
import { emailAllowed } from "@/lib/email/safety";
import { loadWordingState } from "@/lib/studio/wording-state";
import { CB_QUESTIONS_EMAIL } from "@/lib/closebook/client-wording";
import { addDays, questionsMessage, questionsXlsx, renderQuestionsEmail, xlsxName } from "@/lib/closebook/questions";
import { clientRows, loadQuestions, openRows, questionsPdf, senderProfile } from "@/lib/closebook/questions-server";
import { FIRM } from "@/components/ds/brand";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const no = (e: string): { ok: false; error: string } => ({ ok: false, error: plainError(e) });
const ID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
async function editor() { const a = await getAccess(); return a && canEdit(a, "closebook") ? a : null; }

export async function savedQuestions(): Promise<R<{ list: { id: string; body: string }[] }>> {
  const a = await getAccess(); if (!a || !canView(a, "closebook")) return no("You need Closebook.");
  const { data, error } = await (await createClient()).rpc("cb_my_saved_questions");
  return error ? no(error.message) : { ok: true, list: ((data ?? []) as { id: string; body: string }[]).map(({ id, body }) => ({ id, body })) };
}
export async function addSavedQuestion(text: string): Promise<R<{ id: string }>> {
  const a = await getAccess(); if (!a || !canView(a, "closebook")) return no("You need Closebook.");
  const { data, error } = await (await createClient()).rpc("cb_saved_question_add", { p_text: text });
  return error ? no(error.message) : { ok: true, id: data as string };
}
export async function removeSavedQuestion(id: string): Promise<R> {
  const a = await getAccess(); if (!a || !canView(a, "closebook")) return no("You need Closebook.");
  const { error } = await (await createClient()).rpc("cb_saved_question_remove", { p_id: id });
  return error ? no(error.message) : { ok: true };
}

export async function askQuestions(fileId: string, lineIds: string[], text: string): Promise<R<{ asked: number }>> {
  if (!(await editor())) return no("You need Edit on Closebook.");
  const { data, error } = await (await createClient()).rpc("cb_ask_questions", { p_file: fileId, p_ids: lineIds.filter((x) => ID.test(x)), p_text: text });
  return error ? no(error.message) : { ok: true, asked: Number(data ?? 0) };
}

export async function markQuestionsSent(fileId: string, lineIds: string[], date: string): Promise<R<{ n: number }>> {
  if (!(await editor())) return no("You need Edit on Closebook.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return no("Enter the date they were sent.");
  const { data, error } = await (await createClient()).rpc("cb_mark_questions_sent", { p_file: fileId, p_ids: lineIds.filter((x) => ID.test(x)), p_date: date });
  return error ? no(error.message) : { ok: true, n: Number(data ?? 0) };
}

// What the Notify client window starts with.
export type NotifyDraft = {
  count: number; lineIds: string[]; contacts: { name: string; first: string; email: string }[]; replyBy: string; subject: string; message: string;
  linkText: string; signature: { name: string; credentials: string; title: string; firm: string }; canSend: boolean; missing: string[];
};
export async function notifyDraft(fileId: string, lineIds: string[] | null): Promise<R<{ draft: NotifyDraft }>> {
  const a = await editor(); if (!a) return no("You need Edit on Closebook.");
  const supabase = await createClient();
  const q = await loadQuestions(supabase, fileId);
  if (!q) return no("File not found.");
  if (q.locked) return no("This file is locked.");
  // Ticked rows, or every Not sent and Waiting row.
  const pick = (lineIds?.length ? q.rows.filter((r) => lineIds.includes(r.id)) : q.rows).filter((r) => r.status === "not_sent" || r.status === "waiting");
  const replyBy = addDays(todayToronto(), 7);
  const texts = (await loadWordingState(supabase)).live?.texts ?? {};
  const m = questionsMessage(texts, CB_QUESTIONS_EMAIL, { first: q.contacts[0]?.first ?? "", legalName: q.legalName, count: pick.length, replyBy });
  const me = await senderProfile(supabase, a.staff_id);
  const ready = mailReady();
  const missing = ready.ok ? (me.email ? [] : ["your staff record's email address"]) : ready.missing;
  return { ok: true, draft: { count: pick.length, lineIds: pick.map((r) => r.id), contacts: q.contacts, replyBy, subject: m.subject, message: m.message,
    linkText: texts[CB_QUESTIONS_EMAIL.link.key] ?? CB_QUESTIONS_EMAIL.link.text,
    signature: { name: me.name, credentials: me.credentials, title: me.title, firm: texts[CB_QUESTIONS_EMAIL.firm.key] ?? CB_QUESTIONS_EMAIL.firm.text }, canSend: missing.length === 0, missing } };
}

// Send: a new link for the file (the old one switches off), the email from the signed-in person's mailbox through Microsoft 365.
export async function notifyClient(fileId: string, v: { lineIds: string[]; to: string[]; cc: string; replyBy: string; subject: string; message: string; attachExcel: boolean }): Promise<R<{ sentTo: string; n: number }>> {
  const a = await editor(); if (!a) return no("You need Edit on Closebook.");
  const supabase = await createClient();
  const q = await loadQuestions(supabase, fileId);
  if (!q) return no("File not found.");
  const to = [...new Set(v.to.map((e) => e.trim().toLowerCase()))].filter((e) => q.contacts.some((c) => c.email === e));
  const cc = [...new Set(v.cc.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return no("Tick at least one contact.");
  if (cc.some((e) => !EMAIL.test(e))) return no("Check the Cc addresses.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.replyBy) || v.replyBy < todayToronto()) return no("Enter a reply-by date from today on.");
  if (!v.subject.trim() || !v.message.trim()) return no("Write the subject and the message.");
  const rows = q.rows.filter((r) => v.lineIds.includes(r.id) && (r.status === "not_sent" || r.status === "waiting"));
  if (!rows.length) return no("No open questions to send.");
  const ready = mailReady();
  const me = await senderProfile(supabase, a.staff_id);
  if (!ready.ok || !me.email) return no(`Sending is not set up here: ${ready.ok ? "your staff record has no email address" : `missing ${ready.missing.join(", ")}`}. Use Download.`);
  const blocked = [...to, ...cc].filter((e) => !emailAllowed(e));
  if (blocked.length) return no(`Not sent: the Test app only emails the firm's own test addresses (${blocked.join(", ")}).`);
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { data: linkId, error } = await supabase.rpc("cb_question_link_create", { p_file: fileId, p_token_hash: hash, p_ids: rows.map((r) => r.id), p_to: to, p_cc: cc, p_reply_by: v.replyBy, p_expires: expires });
  if (error) return no(error.message);
  const texts = (await loadWordingState(supabase)).live?.texts ?? {};
  const mail = renderQuestionsEmail(texts, CB_QUESTIONS_EMAIL, { subject: v.subject.trim(), message: v.message.trim() }, me, `${env.siteUrl()}/cq/${token}`);
  const attachments = v.attachExcel ? [{ name: xlsxName(q.legalName, q.yearEnd), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: questionsXlsx({ legalName: q.legalName, yearEnd: q.yearEnd, preparedOn: todayToronto(), firm: FIRM.legalName }, clientRows(rows)).toString("base64") }] : undefined;
  // Round 32 fix: the link is pending until the email has gone. A failed send removes it and changes no other link.
  try {
    await sendMail({ from: me.email, to, cc, subject: mail.subject, html: mail.html, attachments });
  } catch (e) {
    const { error: ce } = await supabase.rpc("cb_question_link_cancel", { p_link: linkId });
    if (ce) console.error(`[notify client] remove the pending link: ${ce.message}`);
    return no(`Not sent. ${e instanceof Error ? e.message : "Microsoft 365 did not accept the email."}`);
  }
  // The email went: switch this link on (and the earlier one off). Tried twice; the client's link depends on it.
  let r = await supabase.rpc("cb_question_link_sent", { p_link: linkId });
  if (r.error) r = await supabase.rpc("cb_question_link_sent", { p_link: linkId });
  if (r.error) {
    console.error(`[notify client] switch the link on: ${r.error.message}`);
    return no(`The email went, but its link could not be switched on, so it will not open. Send again. (${r.error.message})`);
  }
  const n = r.data;
  const names = to.map((e) => q.contacts.find((c) => c.email === e)?.name || e);
  return { ok: true, sentTo: names.join(", "), n: Number(n ?? 0) };
}

// "Copy link" (firm decision, Nov 17, 2026): the live link without an email, for staff to paste into a TaxDome message or
// their own Outlook when Microsoft 365 cannot send. It switches off any earlier link, sets the rows to Waiting with today's
// date and goes in History.
export async function copyQuestionsLink(fileId: string, v: { lineIds: string[]; to: string[]; replyBy: string }): Promise<R<{ url: string; n: number }>> {
  const a = await editor(); if (!a) return no("You need Edit on Closebook.");
  const supabase = await createClient();
  const q = await loadQuestions(supabase, fileId);
  if (!q) return no("File not found.");
  if (q.locked) return no("This file is locked.");
  const rows = q.rows.filter((r) => v.lineIds.includes(r.id) && (r.status === "not_sent" || r.status === "waiting"));
  if (!rows.length) return no("No open questions to send.");
  const replyBy = /^\d{4}-\d{2}-\d{2}$/.test(v.replyBy) && v.replyBy >= todayToronto() ? v.replyBy : addDays(todayToronto(), 7);
  const to = [...new Set(v.to.map((e) => e.trim().toLowerCase()))].filter((e) => q.contacts.some((c) => c.email === e));
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: linkId, error } = await supabase.rpc("cb_question_link_create", { p_file: fileId, p_token_hash: hash, p_ids: rows.map((r) => r.id),
    p_to: to.length ? to : q.contacts.slice(0, 1).map((c) => c.email), p_cc: [], p_reply_by: replyBy, p_expires: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  if (error) return no(error.message);
  const r = await supabase.rpc("cb_question_link_copied", { p_link: linkId });
  if (r.error) { await supabase.rpc("cb_question_link_cancel", { p_link: linkId }); return no(r.error.message); }
  return { ok: true, url: `${env.siteUrl()}/cq/${token}`, n: Number(r.data ?? 0) };
}

// Export ▾ (Excel, PDF), and Download when sending is not set up.
export async function downloadQuestions(fileId: string, kind: "xlsx" | "pdf", lineIds: string[] | null): Promise<R<{ base64: string; name: string }>> {
  const a = await getAccess(); if (!a || !canView(a, "closebook")) return no("You need Closebook.");
  const q = await loadQuestions(await createClient(), fileId);
  if (!q) return no("File not found.");
  const rows = clientRows(lineIds?.length ? q.rows.filter((r) => lineIds.includes(r.id)) : openRows(q.rows));
  if (!rows.length) return no("No questions to export.");
  const meta = { legalName: q.legalName, yearEnd: q.yearEnd, preparedOn: todayToronto(), firm: FIRM.legalName };
  if (kind === "xlsx") return { ok: true, base64: questionsXlsx(meta, rows).toString("base64"), name: xlsxName(q.legalName, q.yearEnd) };
  return { ok: true, base64: (await questionsPdf(meta, rows)).toString("base64"), name: xlsxName(q.legalName, q.yearEnd).replace(/\.xlsx$/, ".pdf") };
}

// The bell: the signed-in person's notices.
export async function myNotices(): Promise<R<{ list: { id: string; title: string; href: string; at: string; unread: boolean }[] }>> {
  const a = await getAccess(); if (!a) return no("Sign in again.");
  const supabase = await createClient();
  const { data } = await supabase.from("staff_notices").select("id, title, href, updated_at, read_at").order("updated_at", { ascending: false }).limit(20);
  await supabase.rpc("staff_notices_read");
  return { ok: true, list: ((data ?? []) as { id: string; title: string; href: string; updated_at: string; read_at: string | null }[]).map((n) => ({ id: n.id, title: n.title, href: n.href, at: n.updated_at, unread: !n.read_at })) };
}

// Step 4: the threads of some lines again, after asking.
export async function getThreads(fileId: string, lineIds: string[]): Promise<R<{ threads: Record<string, import("@/lib/closebook/feed-server").FeedQ[]> }>> {
  const a = await getAccess(); if (!a || !canView(a, "closebook")) return no("You need Closebook.");
  const { readThreads } = await import("@/lib/closebook/feed-server");
  return { ok: true, threads: await readThreads(await createClient(), fileId, lineIds.filter((x) => ID.test(x))) };
}
