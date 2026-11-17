// Round 32 (Hashim, Nov 18, 2026): questions to the client about bank and card lines. Pure and tested
// (tests/closebook-questions.test.ts). Benchmarks: TaxDome's transaction questions (attached screenshots, docs/round32),
// QuickBooks Online's comment icon, CaseWare Cloud's Queries (due date, contacts, "Awaiting response", history).
// Never on anything the client sees: chart numbers, GIFI, "Closebook", staff names.
import { ZipWriter } from "../export/zip.ts";
import { hfText } from "./xlsx-hf.ts";

export type QStatus = "not_sent" | "waiting" | "answered" | "closed";
export const Q_LABEL: Record<QStatus, string> = { not_sent: "Not sent", waiting: "Waiting", answered: "Answered", closed: "Closed" };
// Not sent grey, Waiting amber, Answered blue, Closed green.
export const Q_TONE: Record<QStatus, string> = { not_sent: "bg-sand-100 text-ink-2", waiting: "bg-warning-soft text-warning", answered: "bg-navy-50 text-navy-700", closed: "bg-success-soft text-success" };

// A line's status (round 35b): what the line holds ('' = no question). Posting closes the questions still waiting on
// it (the database sets 'closed'); a question asked after posting stays open. An excluded line is closed.
export function qStatusOf(l: { q_status: string; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null }): QStatus | null {
  if (!l.q_status) return null;
  if (l.status === "excluded") return "closed";
  return l.q_status as QStatus;
}
// Round 32 fix (Hashim, Nov 17, 2026): why a client's link does not open. A link ends only at 30 days, at the next good
// send (replaced) or when the file is locked in step 10. The reply-by date plays no part.
export type LinkRefusal = "not_sent" | "replaced" | "expired" | "locked";
export function linkRefusal(l: { active: boolean; sent: boolean; expires_at: string }, filePhase: string | null, now: Date = new Date()): LinkRefusal | null {
  if (!l.sent) return "not_sent";
  if (!l.active) return "replaced";
  if (new Date(l.expires_at).getTime() <= now.getTime()) return "expired";
  if (filePhase === "locked") return "locked";
  return null;
}
export function deviceOf(ua: string): string {
  const u = ua || "";
  if (!u || /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|headless|python|curl|wget|node-fetch|undici|go-http|java\//i.test(u)) return "automatic link check";
  if (/iPad|Tablet/i.test(u) || (/Android/i.test(u) && !/Mobile/i.test(u))) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(u)) return "phone";
  return "computer";
}

// Round 33 (Hashim, Nov 17, 2026): what the client may see. Only questions that went out in a Notify client or Copy link
// (sent_at set), and the client's own answers; never a question not sent yet. Round 35b: a line shows while it is
// Waiting or Answered with at least one open sent question, posted or not; never an excluded line.
// Round 35b: only open questions (never one closed by posting), posted line or not.
export function clientThread<T extends { kind: "q" | "a"; sent_at: string | null; closed_at?: string | null }>(entries: T[]): T[] {
  return entries.filter((e) => e.kind === "a" || (e.kind === "q" && !!e.sent_at && !e.closed_at));
}
export function clientLineVisible(l: { q_status: string; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null }, thread: { kind: "q" | "a" }[]): boolean {
  const s = qStatusOf(l);
  return l.status !== "excluded" && (s === "waiting" || s === "answered") && thread.some((e) => e.kind === "q");
}

export const isOpen = (s: QStatus | null) => s === "not_sent" || s === "waiting" || s === "answered";

// "h•••@hotmail.com"
export function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  return d ? `${u.slice(0, 1)}•••@${d}` : email;
}

// "RBC Chq ••• 7509" (staff report) and "RBC Chequing ••• 7509" (the client's page): never a chart number.
const KIND_SHORT: Record<string, string> = { chequing: "Chq", savings: "Sav", card: "Card", loc: "LOC", loan: "Loan" };
export const accountShort = (bank: string | null, name: string, last4: string | null, accountType: string | null = null) => {
  const b = (bank ?? "").trim().split(/\s+/)[0] ?? "";
  const k = KIND_SHORT[accountType ?? ""] ?? "";
  const head = b ? `${b}${k ? ` ${k}` : ""}` : (name.split(" · ").pop() || name).replace(/\s*•••\s*\d+$/, "");
  return `${head}${last4 ? ` ••• ${last4}` : ""}`;
};
const KIND_WORD: Record<string, string> = { chequing: "Chequing", savings: "Savings", card: "Credit card", loc: "Line of credit", loan: "Loan" };
export function accountForClient(bank: string | null, accountType: string | null, kind: "bank" | "card", last4: string | null): string {
  const b = (bank ?? "").trim().split(/\s+/)[0] ?? "";
  const w = KIND_WORD[accountType ?? ""] ?? (kind === "card" ? "Credit card" : "Bank account");
  return `${b ? `${b} ` : ""}${w}${last4 ? ` ••• ${last4}` : ""}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const shortDate = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;          // "Mar 19, 2026"
export const longDate = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;         // "August 31, 2026"
export const money = (cents: number) => (Math.abs(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const addDays = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

// ---------- The email (Templates: "Closebook · Client questions email")
export type QPieceLike = { key: string; text: string };
export type QEmailPieces = { subject: QPieceLike; hi: QPieceLike; working: QPieceLike; answerBy: QPieceLike; link: QPieceLike; firm: QPieceLike;
  working1?: QPieceLike; answerBy1?: QPieceLike };   // round 36: the wording for one question
export type QSender = { name: string; credentials: string; title: string };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fill = (t: string, f: string[]) => t.replace(/\{(\d+)\}/g, (m, i) => f[Number(i) - 1] ?? m);
export const questionsWord = (n: number) => `${n} question${n === 1 ? "" : "s"}`;

// The editable part of the email (the window shows it; "for this email only").
export function questionsMessage(texts: Record<string, string>, P: QEmailPieces, d: { first: string; legalName: string; count: number }): { subject: string; message: string } {
  // A legal name ending in "Inc." before a full stop: one full stop, not two.
  const t = (p: QPieceLike, ...f: string[]) => fill(texts[p.key] ?? p.text, f).replace(/\.\.(?=\s|$)/g, ".");
  return {
    subject: t(P.subject),
    // Round 33: the reply-by sentence is not in the editable text; it comes from the Reply by date (one stored value).
    message: [t(P.hi, d.first || "there"), "", d.count === 1 && P.working1 ? t(P.working1, d.legalName) : t(P.working, d.legalName, questionsWord(d.count))].join("\n"),
  };
}

// The email as sent: the message, the link (bold and underlined), the sender's signature.
// The reply-by sentence, from the stored date: the window, the email and the client page show the same date.
// Round 36: one question reads "answer it ... to your answer"; two or more, "answer them ... to any answer".
export const answerByPiece = (P: QEmailPieces, count: number) => (count === 1 && P.answerBy1 ? P.answerBy1 : P.answerBy);
export const answerByText = (texts: Record<string, string>, P: QEmailPieces, replyBy: string, count = 2) => {
  const p = answerByPiece(P, count);
  return fill(texts[p.key] ?? p.text, [longDate(replyBy)]).replace(/\.\.(?=\s|$)/g, ".");
};
export function renderQuestionsEmail(texts: Record<string, string>, P: QEmailPieces, m: { subject: string; message: string }, sender: QSender, link: string, replyBy: string, count = 2) {
  const t = (p: QPieceLike) => texts[p.key] ?? p.text;
  const body = `${m.message.trimEnd()}\n\n${answerByText(texts, P, replyBy, count)}`;
  const paras = body.split(/\n{2,}/).map((p) => `<p style="margin: 0 0 14px;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const who = `<b>${esc(sender.name)}</b>${sender.credentials ? `, ${esc(sender.credentials)}` : ""}`;
  const firmLine = [sender.title, t(P.firm)].filter(Boolean).map(esc).join(" | ");
  const html = `<div style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1f1e;">${paras}`
    + `<p style="margin: 18px 0;"><a href="${esc(link)}" style="color: #0000ee; font-weight: bold; text-decoration: underline;">${esc(t(P.link))}</a></p>`
    + `<p style="margin: 18px 0 0;">${who}<br>${firmLine}</p></div>`;
  const text = `${body}\n\n${t(P.link)}: ${link}\n\n${sender.name}${sender.credentials ? `, ${sender.credentials}` : ""}\n${[sender.title, t(P.firm)].filter(Boolean).join(" | ")}`;
  return { subject: m.subject, html, text };
}

// ---------- The client's Excel file (H.1): "<Legal name> - Questions - <year-end>.xlsx", sheet "Questions"
export type QRow = { n: number; date: string; account: string; description: string; out: boolean; cents: number; question: string };
export const xlsxName = (legalName: string, yearEnd: string) => `${legalName.replace(/[\\/:*?"<>|]/g, "")} - Questions - ${yearEnd}.xlsx`;

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => String.fromCharCode(65 + i);
// Styles: 0 plain, 1 title (bold 14), 2 plain, 3 header (bold, light grey, thin borders, wrap), 4 text cell (wrap, thin borders),
// 5 amount (#,##0.00, thin borders), 6 answer (light yellow, thin borders, wrap), 7 note (italic), 8 date (mmm d, yyyy), 9 whole number.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="mmm d, yyyy"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><i/><sz val="10"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E7E7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF6CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFB0B0B0"/></left><right style="thin"><color rgb="FFB0B0B0"/></right><top style="thin"><color rgb="FFB0B0B0"/></top><bottom style="thin"><color rgb="FFB0B0B0"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
export const XLSX_COLUMNS = ["#", "Date", "Account", "Description", "Paid out", "Received", "Our question", "Your answer"];
const WIDTHS = [5, 13, 22, 36, 13, 13, 40, 50];

export function questionsXlsx(meta: { legalName: string; yearEnd: string; preparedOn: string; firm: string }, rows: QRow[]): Buffer {
  const out: string[] = [];
  const text = (r: number, c: number, v: string, s: number) => `<c r="${colName(c)}${r}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  const num = (r: number, c: number, cents: number) => `<c r="${colName(c)}${r}" s="5"><v>${(cents / 100).toFixed(2)}</v></c>`;
  const blank = (r: number, c: number, s: number) => `<c r="${colName(c)}${r}" s="${s}"/>`;
  // Dates are real dates (Excel's serial number), so the filter sorts them by date.
  const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const day = (r: number, c: number, iso: string) => `<c r="${colName(c)}${r}" s="8"><v>${serial(iso)}</v></c>`;
  const int = (r: number, c: number, n: number) => `<c r="${colName(c)}${r}" s="9"><v>${n}</v></c>`;
  out.push(`<row r="1">${text(1, 0, meta.legalName, 1)}</row>`);
  out.push(`<row r="2">${text(2, 0, "Questions about your bank and card transactions", 2)}</row>`);
  out.push(`<row r="3">${text(3, 0, `Year ended ${longDate(meta.yearEnd)}`, 2)}</row>`);
  out.push(`<row r="4">${text(4, 0, `Prepared by ${meta.firm} on ${shortDate(meta.preparedOn)}`, 2)}</row>`);
  out.push(`<row r="5">${text(5, 0, "Please answer each question in the yellow column. If you have a receipt or invoice, send it with your reply.", 7)}</row>`);
  out.push(`<row r="7">${XLSX_COLUMNS.map((h, i) => text(7, i, h, 3)).join("")}</row>`);
  rows.forEach((q, i) => {
    const r = 8 + i;
    out.push(`<row r="${r}">${[int(r, 0, q.n), day(r, 1, q.date), text(r, 2, q.account, 4), text(r, 3, q.description, 4),
      q.out ? num(r, 4, Math.abs(q.cents)) : blank(r, 4, 5), q.out ? blank(r, 5, 5) : num(r, 5, Math.abs(q.cents)), text(r, 6, q.question, 4), blank(r, 7, 6)].join("")}</row>`);
  });
  const last = 7 + Math.max(rows.length, 1);
  const cols = WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="H8" sqref="H8"/></sheetView></sheetViews>`
    + `<cols>${cols}</cols><sheetData>${out.join("")}</sheetData>`
    + `<autoFilter ref="A7:H${last}"/>`
    + `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>`
    + `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>`
    + `<headerFooter><oddFooter>&amp;L${x(hfText(meta.firm))}&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter></worksheet>`;
  const chunks: Buffer[] = [];
  const z = new ZipWriter((c) => chunks.push(Buffer.from(c)));
  z.add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  z.add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  // The header row repeats on every printed page (print titles), as a defined name.
  z.add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets>`
    + `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Questions!$A$7:$H$${last}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">Questions!$7:$7</definedName></definedNames></workbook>`);
  z.add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.add("xl/styles.xml", STYLES);
  z.add("xl/worksheets/sheet1.xml", sheet);
  z.finish();
  return Buffer.concat(chunks);
}

// Client answer files: PDF, JPG, PNG, HEIC; up to 10 MB each; up to 5 per answer.
export const ANSWER_TYPES = /^(application\/pdf|image\/jpeg|image\/png|image\/heic|image\/heif)$/;
export const ANSWER_EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
export const ANSWER_MAX = 10 * 1024 * 1024;
export const ANSWER_FILES = 5;
