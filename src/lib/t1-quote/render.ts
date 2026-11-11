// Builds the T1 quote and engagement letter (Appendix A) and the quote emails (section 8) from the
// wording pieces, as HTML. Pure: the staff preview, the client page, the Templates editor and the
// tests all use it. The client sees the services included and one total, never a line price.
import { A, B, C, EMAIL, ITEM_LINES, SELF_EMPLOYED_WITH, type QPiece } from "./wording.ts";

export type QuoteLine = { code: string; person: number | null; quantity: number };
export type QuoteData = {
  taxYear: number;
  client: { first: string; last: string };
  spouse?: { first: string; last: string } | null;
  lines: QuoteLine[];
  totalCents: number;
  preparedBy: string;
  preparedOn: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  signer: { name: string; title: string };
  emails?: string[]; // the addressee block: each signer's email (the form collects no mailing address)
};
export type Sender = { name: string; phone: string; email: string };
// letterhead: the image to show at the top of Part A (the firm name and address are on it).
// signature: the firm signer's signature image (data URL), shown under "Yours truly,".
export type Opts = { mark?: boolean; watermark?: boolean; letterhead?: string; signature?: string | null };
export const LETTERHEAD_URL = "/studio/letterhead.jpg";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const longDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? DATE.format(new Date(`${iso}T00:00:00Z`)) : iso);
export const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
export const fullName = (p: { first: string; last: string }) => `${p.first} ${p.last}`.trim();

// One piece of wording with its fill-ins, escaped. With mark, wrapped for the Templates editor.
function piece(texts: Record<string, string>, p: QPiece, fills: (string | number)[], mark?: boolean): string {
  const raw = texts[p.key] ?? p.text;
  const filled = esc(raw).replace(/\{(\d+)\}/g, (m, i) => (fills[Number(i) - 1] !== undefined ? esc(String(fills[Number(i) - 1])) : m));
  return mark ? `<span class="wmark" data-w="${p.key}">${filled}</span>` : filled;
}

// The plain-words services list from the quote lines. Per-person items show whose they are for a couple.
export function serviceLines(texts: Record<string, string>, d: QuoteData, mark?: boolean): string[] {
  const couple = !!d.spouse;
  const names = [d.client.first, d.spouse?.first ?? ""];
  const out: string[] = [];
  const byCode = new Map<string, QuoteLine[]>();
  for (const l of d.lines) byCode.set(l.code, [...(byCode.get(l.code) ?? []), l]);
  for (const [code, ls] of byCode) {
    if (code === "PTX-110" || code === "PTX-111") continue;
    // Vehicle and home office join the self-employment line (Appendix A example).
    if ((code === "PTX-122" || code === "PTX-123") && byCode.has("PTX-121")) continue;
    const pieces = ITEM_LINES[code];
    if (!pieces) continue; // an item with no plain-words line yet: never show a code or price instead
    const qty = ls.reduce((n, l) => n + l.quantity, 0) / Math.max(1, new Set(ls.map((l) => l.person)).size);
    const [one, many] = pieces;
    let text = qty > 1 && many ? piece(texts, many, [qty], mark) : piece(texts, one, [], mark);
    if (code === "PTX-121") {
      const v = byCode.has("PTX-122"), h = byCode.has("PTX-123");
      if (v || h) text += piece(texts, v && h ? SELF_EMPLOYED_WITH.both : v ? SELF_EMPLOYED_WITH.vehicle : SELF_EMPLOYED_WITH.homeOffice, [], mark);
    }
    const who = ls.map((l) => l.person).filter((p): p is number => p !== null);
    out.push(couple && who.length ? `${text} (${esc(who.length > 1 ? `${names[0]} and ${names[1]}` : names[who[0]])})` : text);
  }
  return out;
}

// The look of the firm's letters: navy headings, dark text, letter spacing.
const NAVY = "#1A3C7C";
const S = {
  doc: "font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #1d2330; position: relative;",
  lh: "display: block; width: 100%; max-width: 680px; height: auto; margin: 0 0 22px;",
  h1: `font-size: 20px; line-height: 1.35; font-weight: bold; color: ${NAVY}; margin: 0 0 12px;`,
  h2: `font-size: 16px; font-weight: bold; color: ${NAVY}; margin: 22px 0 8px;`,
  h3: `font-size: 15px; font-weight: bold; color: ${NAVY}; margin: 18px 0 6px;`,
  p: "margin: 0 0 10px;",
  small: "margin: 0 0 2px; color: #3d4441;",
  fee: `font-size: 18px; font-weight: bold; color: ${NAVY}; margin: 16px 0 6px; padding: 10px 14px; background: #F2F5FB; border-left: 3px solid ${NAVY};`,
  ul: "margin: 0 0 10px; padding-left: 22px; list-style-type: disc;",
  ol: "margin: 0 0 10px; padding-left: 22px; list-style-type: decimal;",
  mark: "position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 64px; font-weight: bold; color: rgba(200, 40, 40, 0.13); transform: rotate(-24deg); letter-spacing: 4px;",
};

export function renderQuote(texts: Record<string, string>, d: QuoteData, o: Opts = {}): { label: string; html: string }[] {
  const t = (p: QPiece, ...f: (string | number)[]) => piece(texts, p, f, o.mark);
  const couple = !!d.spouse;
  const names = couple ? `${fullName(d.client)} and ${fullName(d.spouse!)}` : fullName(d.client);
  const li = (s: string) => `<li style="${S.p}">${s}</li>`;
  const wm = o.watermark ? `<div style="${S.mark}" aria-hidden="true">DRAFT FOR REVIEW</div>` : "";

  const partA = `<div style="${S.doc}">${wm}
${o.letterhead ? `<img data-lh="1" src="${esc(o.letterhead)}" alt="${esc(`${pieceText(texts, A.firm)}, ${pieceText(texts, A.address)}`)}" style="${S.lh}">` : `<p style="${S.p}"><b>${t(A.firm)}</b><br>${t(A.address)}</p>`}
<h1 style="${S.h1}">${t(A.title, couple ? "returns" : "return", d.taxYear)}</h1>
<p data-k="meta" style="${S.small}">${t(A.preparedFor, names)}</p>
<p data-k="meta" style="${S.small}">${t(A.preparedBy, d.preparedBy, longDate(d.preparedOn))}</p>
<p data-k="meta" style="${S.small} margin-bottom: 10px;">${t(A.validUntil, longDate(d.validUntil))}</p>
<h2 style="${S.h2}">${t(A.servicesHeading)}</h2>
<ul style="${S.ul}">${li(t(A.base, couple ? "both" : "your", d.taxYear, couple ? "Returns" : "Return"))}${serviceLines(texts, d, o.mark).map(li).join("")}${li(t(A.cpaReview))}</ul>
<p data-k="fee" style="${S.fee}">${t(A.fee, money(d.totalCents))}</p>
<p style="${S.p}">${t(A.feeCovers)}</p>
<h2 style="${S.h2}">${t(A.nextHeading)}</h2>
<ol style="${S.ol}">${[A.next1, A.next2, A.next3, A.next4, A.next5].map((p) => li(t(p))).join("")}</ol>
</div>`;

  const para = (p: QPiece, ...f: (string | number)[]) => `<p style="${S.p}">${t(p, ...f)}</p>`;
  const h = (p: QPiece) => `<h3 style="${S.h3}">${t(p)}</h3>`;
  const list = (...ps: QPiece[]) => `<ul style="${S.ul}">${ps.map((p) => li(t(p))).join("")}</ul>`;
  // The letter stands on its own: letterhead, date, addressee and subject before "Dear".
  const addressee = [names, ...(d.emails ?? []).filter(Boolean)].map(esc).join("<br>");
  const partB = `<div style="${S.doc}">${wm}
${o.letterhead ? `<img data-lh="1" src="${esc(o.letterhead)}" alt="${esc(`${pieceText(texts, A.firm)}, ${pieceText(texts, A.address)}`)}" style="${S.lh}">` : ""}
<p data-k="meta" style="${S.p}">${esc(longDate(d.preparedOn))}</p>
<p data-k="addr" style="${S.p}">${addressee}</p>
<p style="${S.p}"><b>${t(B.reLine, d.taxYear, couple ? "returns" : "return")}</b></p>
${para(B.dear, names)}${para(B.intro)}${para(B.applies, d.taxYear)}
${h(B.h1)}${para(B.s1a)}${para(B.s1b)}${para(B.s1c)}${para(B.s1d)}
${h(B.h2)}${para(B.s2lead)}${list(B.s2a, B.s2b, B.s2c, B.s2d, B.s2e)}${para(B.s2f)}
${h(B.h3)}${para(B.s3)}
${h(B.h4)}${para(B.s4a)}${para(B.s4b)}
${h(B.h5)}${para(B.s5)}${list(B.s5a, B.s5b, B.s5c, B.s5d, B.s5e, B.s5f, B.s5g)}
${h(B.h6)}${para(B.s6lead)}${list(B.s6a, B.s6b, B.s6c, B.s6d, B.s6e, B.s6f)}${para(B.s6g)}${para(B.s6h)}
${h(B.h7)}${para(B.s7lead)}${list(B.s7a, B.s7b, B.s7c)}${para(B.s7d)}
${h(B.h8)}${para(B.s8)}
${h(B.h9)}${para(B.s9a)}${para(B.s9b)}${para(B.s9c)}
${h(B.h10)}${para(B.s10a)}${para(B.s10b)}
${h(B.h11)}${para(B.s11)}
${h(B.h12)}${para(B.s12a)}${para(B.s12b)}
${para(B.yours)}<p data-k="signer" style="${S.p}">${t(B.firmCaps)}</p>
${o.signature ? `<img data-sig="1" src="${esc(o.signature)}" alt="Signature" style="display: block; width: 150px; height: auto; margin: 0 0 2px;">` : ""}
<p data-k="signer" style="${S.p}">${esc(d.signer.name)}${d.signer.title ? `<br>${esc(d.signer.title)}` : ""}</p>
</div>`;

  const partC = `<div style="${S.doc}">
<h2 style="${S.h2}">${t(C.partC)}</h2>
<p style="${S.p}">${t(C.typeName, fullName(d.client))}${couple ? ` ${t(C.spouseOwnLink, fullName(d.spouse!))}` : ""}</p>
</div>`;

  return [
    { label: `Part A: ${(texts[A.partA.key] ?? A.partA.text)}`, html: partA },
    { label: `Part B: ${(texts[B.partB.key] ?? B.partB.text)}`, html: partB },
    { label: "Part C: Sign", html: partC },
  ];
}

// An email button Outlook keeps when the email is pasted in: a coloured table cell around the link
// (Outlook drops buttons made only from a styled link).
export function emailButton(href: string, labelHtml: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display: inline-table; border-collapse: separate; margin: 0 8px 8px 0;"><tr><td bgcolor="#1A3C7C" style="background: #1A3C7C; border-radius: 6px; padding: 10px 18px;"><a href="${esc(href)}" style="color: #ffffff; text-decoration: none; font-weight: bold; font-family: Arial, Helvetica, sans-serif; font-size: 15px;">${labelHtml}</a></td></tr></table>`;
}

// The quote email, ready to paste into Outlook (HTML) or plain text. links: one per signer, in order.
export function renderEmail(texts: Record<string, string>, d: QuoteData, sender: Sender, links: string[], o: Opts = {}) {
  const t = (p: QPiece, ...f: (string | number)[]) => piece(texts, p, f, o.mark);
  const plain = (p: QPiece, ...f: (string | number)[]) => (texts[p.key] ?? p.text).replace(/\{(\d+)\}/g, (m, i) => (f[Number(i) - 1] !== undefined ? String(f[Number(i) - 1]) : m));
  const couple = !!d.spouse;
  const valid = longDate(d.validUntil);
  const p = (s: string) => `<p style="margin: 0 0 12px;">${s}</p>`;
  const k = couple
    ? { subject: EMAIL.subject2, thanks: EMAIL.thanks2, ready: EMAIL.ready2, after: EMAIL.after2, steps: [EMAIL.step1b, EMAIL.step2b, EMAIL.step3b], valid: EMAIL.valid2, firm: EMAIL.firm2 }
    : { subject: EMAIL.subject, thanks: EMAIL.thanks1, ready: EMAIL.ready1, after: EMAIL.after1, steps: [EMAIL.step1, EMAIL.step2, EMAIL.step3a], valid: EMAIL.valid1, firm: EMAIL.firm1 };
  const hi = couple ? t(EMAIL.hi2, d.client.first, d.spouse!.first) : t(EMAIL.hi1, d.client.first);
  const buttons = couple
    ? [d.client.first, d.spouse!.first].map((n, i) => emailButton(links[i] ?? "#", t(EMAIL.button2, n))).join("")
    : emailButton(links[0] ?? "#", t(EMAIL.button1));
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1f1e;">
${p(hi)}${p(t(k.thanks))}${p(t(k.ready, d.taxYear))}${p(t(k.after))}
<ol style="margin: 0 0 12px; padding-left: 22px; list-style-type: decimal;">${k.steps.map((s) => `<li style="margin: 0 0 6px;">${t(s)}</li>`).join("")}</ol>
${p(t(k.valid, valid))}
<div style="margin: 16px 0;">${buttons}</div>
<p style="margin: 16px 0 0;">${esc(sender.name)}<br>${t(k.firm)}<br>${esc([sender.phone, sender.email].filter(Boolean).join(" | "))}</p>
</div>`.replace(/\n/g, "");
  const text = [
    couple ? plain(EMAIL.hi2, d.client.first, d.spouse!.first) : plain(EMAIL.hi1, d.client.first), "",
    plain(k.thanks), "", plain(k.ready, d.taxYear), "", plain(k.after),
    ...k.steps.map((s, i) => `${i + 1}. ${plain(s)}`), "", plain(k.valid, valid), "",
    ...(couple ? [d.client.first, d.spouse!.first].map((n, i) => `${plain(EMAIL.button2, n)}: ${links[i] ?? ""}`) : [`${plain(EMAIL.button1)}: ${links[0] ?? ""}`]), "",
    sender.name, plain(k.firm), [sender.phone, sender.email].filter(Boolean).join(" | "),
  ].join("\n");
  return { subject: couple ? plain(k.subject, d.taxYear) : plain(k.subject, d.taxYear), subjectHtml: t(k.subject, d.taxYear), html, text };
}

// Sample data for the Templates page (made-up names; example sender is Asmaa, per the batch).
export const SAMPLE: QuoteData = {
  taxYear: 2026, client: { first: "Jordan", last: "Sample" }, spouse: { first: "Riley", last: "Sample" },
  lines: [{ code: "PTX-111", person: null, quantity: 1 }, { code: "PTX-120", person: null, quantity: 1 }, { code: "PTX-125", person: 0, quantity: 1 }],
  totalCents: 69700, preparedBy: "Asmaa Ibrahim", preparedOn: "2026-11-10", validUntil: "2026-12-01", signer: { name: "Hashim Abouelfetouh, CPA", title: "" },
};
export const SAMPLE_SENDER: Sender = { name: "Asmaa Ibrahim", phone: "226-789-9591", email: "asmaa@conceptaccounting.ca" };

// One piece as plain text, with its fill-ins (for buttons and labels on the client's page).
export function pieceText(texts: Record<string, string>, p: QPiece, ...fills: (string | number)[]): string {
  return (texts[p.key] ?? p.text).replace(/\{(\d+)\}/g, (m, i) => (fills[Number(i) - 1] !== undefined ? String(fills[Number(i) - 1]) : m));
}
