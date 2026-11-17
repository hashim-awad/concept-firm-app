import "server-only";
// Round 32 (Hashim, Nov 18, 2026): what the Client questions report, the Notify client window and the client's files read.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIRM } from "@/components/ds/brand";
import { renderWpPdf, generatedAt } from "./wp-pdf";
import { accountForClient, accountShort, isOpen, longDate, money, qStatusOf, shortDate, type QRow, type QStatus } from "./questions";
import { todayToronto } from "@/lib/dates";

export type QEntry = { id: string; kind: "q" | "a"; body: string; at: string; by: string; files: { id: string; name: string }[]; sentAt: string | null; closedAt?: string | null };
export type QReportRow = {
  id: string; n: number; date: string; accountId: string; account: string; accountClient: string; description: string; cents: number; out: boolean;
  question: string; status: QStatus; sentOn: string | null; answer: string; files: number; thread: QEntry[];
};
export type QContact = { name: string; first: string; email: string };
export type QReport = {
  fileId: string; clientId: string; legalName: string; yearEnd: string; generated: string; rows: QReportRow[];
  accounts: { id: string; label: string }[]; contacts: QContact[]; locked: boolean;
};

const first = (name: string) => (name.trim().split(/\s+/)[0] ?? "");

export async function loadQuestions(supabase: SupabaseClient, fileId: string): Promise<QReport | null> {
  const { data: f } = await supabase.from("cb_files").select("id, client_id, year_end, phase, client:client_id(legal_name, email, signing_officer, salutation)").eq("id", fileId).maybeSingle();
  if (!f) return null;
  const client = (f.client as unknown as { legal_name: string; email: string; signing_officer: string; salutation: string } | null);
  const [{ data: lines }, { data: accs }, { data: entries }, { data: files }, { data: staff }, { data: links }] = await Promise.all([
    supabase.from("cb_bank_lines").select("id, account_id, txn_date, description, amount, status, chart_account, is_split, transfer_account, q_status, q_sent_on").eq("file_id", fileId).neq("q_status", "").order("txn_date").order("row_no"),
    supabase.from("cb_bank_accounts").select("id, number, name, bank, kind, last4, account_type").eq("file_id", fileId).order("number"),
    supabase.from("cb_line_questions").select("id, line_id, kind, body, asked_by, answered_by, created_at, sent_at, closed_at").eq("file_id", fileId).order("created_at"),
    supabase.from("cb_line_files").select("id, line_id, name, question_id").eq("file_id", fileId).not("question_id", "is", null),
    supabase.from("staff").select("id, full_name"),
    supabase.from("client_links").select("relationship, linked:linked_id(legal_name, email, signing_officer)").eq("client_id", f.client_id as string),
  ]);
  const acc = new Map(((accs ?? []) as { id: string; number: string; name: string; bank: string | null; kind: "bank" | "card"; last4: string | null; account_type: string | null }[]).map((a) => [a.id, a]));
  const initials = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase()]));
  const filesBy = new Map<string, { id: string; name: string }[]>();
  for (const x of (files ?? []) as { id: string; line_id: string; name: string; question_id: string }[]) filesBy.set(x.question_id, [...(filesBy.get(x.question_id) ?? []), { id: x.id, name: x.name }]);
  const thread = new Map<string, QEntry[]>();
  for (const e of (entries ?? []) as { id: string; line_id: string; kind: "q" | "a"; body: string; asked_by: string | null; answered_by: string; created_at: string; sent_at: string | null; closed_at: string | null }[]) {
    thread.set(e.line_id, [...(thread.get(e.line_id) ?? []), { id: e.id, kind: e.kind, body: e.body, at: e.created_at, by: e.kind === "q" ? initials.get(e.asked_by ?? "") ?? "" : e.answered_by, files: filesBy.get(e.id) ?? [], sentAt: e.sent_at, closedAt: e.closed_at }]);
  }
  const rows: QReportRow[] = [];
  for (const l of (lines ?? []) as { id: string; account_id: string; txn_date: string; description: string; amount: number; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null; q_status: string; q_sent_on: string | null }[]) {
    const s = qStatusOf(l);
    if (!s) continue;
    const a = acc.get(l.account_id);
    const t = thread.get(l.id) ?? [];
    const lastQ = [...t].reverse().find((e) => e.kind === "q"), lastA = [...t].reverse().find((e) => e.kind === "a");
    const cents = Math.round(Number(l.amount) * 100);
    rows.push({ id: l.id, n: rows.length + 1, date: l.txn_date, accountId: l.account_id, account: a ? accountShort(a.bank, a.name, a.last4, a.account_type) : "",
      accountClient: a ? accountForClient(a.bank, a.account_type, a.kind, a.last4) : "", description: l.description, cents,
      out: a?.kind === "card" ? cents > 0 : cents < 0, question: lastQ?.body ?? "", status: s, sentOn: l.q_sent_on, answer: lastA ? lastA.body || (lastA.files.length ? "(file attached)" : "") : "",
      files: t.filter((e) => e.kind === "a").reduce((n, e) => n + e.files.length, 0), thread: t });
  }
  // The client record's contacts: the client's own email, then linked owners, directors and shareholders with one.
  const contacts: QContact[] = [];
  if (client?.email) contacts.push({ name: client.signing_officer || client.legal_name, first: first(client.signing_officer || client.salutation || ""), email: client.email.trim().toLowerCase() });
  for (const k of (links ?? []) as unknown as { relationship: string; linked: { legal_name: string; email: string; signing_officer: string } | null }[]) {
    const e = k.linked?.email?.trim().toLowerCase();
    if (e && !contacts.some((c) => c.email === e) && ["owner", "director", "shareholder", "other"].includes(k.relationship)) contacts.push({ name: k.linked!.legal_name, first: first(k.linked!.legal_name), email: e });
  }
  return {
    fileId, clientId: f.client_id as string, legalName: client?.legal_name ?? "", yearEnd: f.year_end as string, generated: generatedAt(), rows, contacts, locked: f.phase === "locked",
    accounts: [...acc.values()].map((a) => ({ id: a.id, label: accountShort(a.bank, a.name, a.last4, a.account_type) })),
  };
}

// The rows a client file shows: never a chart number, never a staff name.
export const clientRows = (rows: QReportRow[]): QRow[] => rows.map((r, i) => ({ n: i + 1, date: r.date, account: r.accountClient, description: r.description, out: r.out, cents: r.cents, question: r.question }));

// The sender's signature (Studio profile): full name, credentials, title, mailbox.
export async function senderProfile(supabase: SupabaseClient, staffId: string): Promise<{ name: string; credentials: string; title: string; email: string }> {
  const { data } = await supabase.from("staff").select("full_name, email, credentials, title").eq("id", staffId).maybeSingle();
  return { name: (data?.full_name as string) ?? "", credentials: (data?.credentials as string) ?? "", title: (data?.title as string) ?? "", email: (data?.email as string) ?? "" };
}

// H.2: the PDF, landscape, the firm's name on each page, "Page 1 of 2", empty answer boxes.
export async function questionsPdf(meta: { legalName: string; yearEnd: string }, rows: QRow[]): Promise<Buffer> {
  const head = ["#", "Date", "Account", "Description", "Paid out", "Received", "Our question", "Your answer"].map((t) => ({ text: t, bold: true, fillColor: "#E7E7E7" }));
  const body = rows.map((r) => [String(r.n), shortDate(r.date), r.account, r.description, { text: r.out ? money(r.cents) : "", alignment: "right" }, { text: r.out ? "" : money(r.cents), alignment: "right" },
    r.question, { text: "\n\n\n", fillColor: "#FFF6CC" }]);
  return renderWpPdf({
    pageSize: "LETTER", pageOrientation: "landscape", pageMargins: [36, 40, 36, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    header: { text: FIRM.legalName, margin: [36, 18, 36, 0], fontSize: 8, color: "#555555" },
    footer: (page: number, pages: number) => ({ text: `Page ${page} of ${pages}`, alignment: "right", margin: [36, 12, 36, 0], fontSize: 8, color: "#555555" }),
    content: [
      { text: meta.legalName, bold: true, fontSize: 14 },
      { text: "Questions about your bank and card transactions", margin: [0, 2, 0, 0] },
      { text: `Year ended ${longDate(meta.yearEnd)}` },
      { text: `Prepared by ${FIRM.legalName} on ${shortDate(todayToronto())}` },
      { text: "Please answer each question in the yellow column. If you have a receipt or invoice, send it with your reply.", italics: true, margin: [0, 6, 0, 10] },
      { table: { headerRows: 1, widths: [16, 52, 78, "*", 52, 52, 150, 170], body: [head, ...body] }, layout: { hLineColor: "#B0B0B0", vLineColor: "#B0B0B0", hLineWidth: () => 0.5, vLineWidth: () => 0.5 } },
    ],
  });
}

export const openRows = (rows: QReportRow[]) => rows.filter((r) => isOpen(r.status));
