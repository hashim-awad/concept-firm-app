// The corporate year-end quote (Phase 2 batch, section 11 and Appendix C) and its email.
// Part A: Appendix C, word for word, as editable pieces.
// Part B: the corporate master letter, built by Studio's own engine with the published wording, word
//   for word, with exactly two changes (recorded in docs/BRIEF.md): the fee sentence points to the
//   amount in the quote, and the electronic-signature sentence from the T1 letter is added. The
//   letter's date, address block and signature block are left out (Parts A and C replace them).
// Part C: the same signing section as the T1 quote.
import { createStudioEngine } from "../studio/engine.generated.js";
import { CorporateLetter } from "../studio/controllers.ts";
import { ILLUSTRATIVE } from "../studio/assets.generated.ts";

const BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
import { C, CORP, CORP_EMAIL, A as T1A, type QPiece } from "../t1-quote/wording.ts";
import { emailButton, longDate, money, type Sender } from "../t1-quote/render.ts";

export type CorpQuoteData = {
  client: { first: string; last: string };
  company: string;
  yearEnd: string; // YYYY-MM-DD
  province: string;
  books: "bookkeeper" | "software" | "statements";
  extras: { gst: boolean; slips: boolean };
  totalCents: number;
  preparedBy: string;
  preparedOn: string;
  validUntil: string;
  signer: { name: string; title: string };
  letterDate?: string;
};
type Opts = { mark?: boolean; watermark?: boolean; letterhead?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const NAVY = "#1A3C7C";
function piece(texts: Record<string, string>, p: QPiece, fills: (string | number)[], mark?: boolean) {
  const filled = esc(texts[p.key] ?? p.text).replace(/\{(\d+)\}/g, (m, i) => (fills[Number(i) - 1] !== undefined ? esc(String(fills[Number(i) - 1])) : m));
  return mark ? `<span class="wmark" data-w="${p.key}">${filled}</span>` : filled;
}
const plain = (texts: Record<string, string>, p: QPiece, ...f: (string | number)[]) => (texts[p.key] ?? p.text).replace(/\{(\d+)\}/g, (m, i) => (f[Number(i) - 1] !== undefined ? String(f[Number(i) - 1]) : m));

const S = {
  doc: "font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #1d2330; position: relative;",
  lh: "display: block; width: 100%; max-width: 680px; height: auto; margin: 0 0 22px;",
  h1: `font-size: 20px; line-height: 1.35; font-weight: bold; color: ${NAVY}; margin: 0 0 12px;`,
  h2: `font-size: 16px; font-weight: bold; color: ${NAVY}; margin: 22px 0 8px;`,
  p: "margin: 0 0 10px;",
  small: "margin: 0 0 2px; color: #3d4441;",
  fee: `font-size: 18px; font-weight: bold; color: ${NAVY}; margin: 16px 0 6px; padding: 10px 14px; background: #F2F5FB; border-left: 3px solid ${NAVY};`,
  ul: "margin: 0 0 10px; padding-left: 22px; list-style-type: disc;",
  ol: "margin: 0 0 10px; padding-left: 22px; list-style-type: decimal;",
  mark: "position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 64px; font-weight: bold; color: rgba(200, 40, 40, 0.13); transform: rotate(-24deg); letter-spacing: 4px;",
};

// The services list (Appendix C): the "if" lines show only when that answer applies.
export function corpServices(texts: Record<string, string>, d: CorpQuoteData, mark?: boolean): string[] {
  const t = (p: QPiece, ...f: (string | number)[]) => piece(texts, p, f, mark);
  return [
    t(CORP.statements, longDate(d.yearEnd)), t(CORP.t2),
    t(d.books === "bookkeeper" ? CORP.bookkeeper : d.books === "software" ? CORP.software : CORP.bankOnly),
    ...(d.extras.gst ? [t(CORP.gst)] : []), ...(d.extras.slips ? [t(CORP.slips)] : []),
    t(CORP.planning), t(CORP.review),
  ];
}

export function corpPartA(texts: Record<string, string>, d: CorpQuoteData, o: Opts = {}): string {
  const t = (p: QPiece, ...f: (string | number)[]) => piece(texts, p, f, o.mark);
  const li = (s: string) => `<li style="${S.p}">${s}</li>`;
  const name = `${d.client.first} ${d.client.last}`.trim();
  const wm = o.watermark ? `<div style="${S.mark}" aria-hidden="true">DRAFT FOR REVIEW</div>` : "";
  const firm = `${plain(texts, T1A.firm)}, ${plain(texts, T1A.address)}`;
  return `<div style="${S.doc}">${wm}
${o.letterhead ? `<img data-lh="1" src="${esc(o.letterhead)}" alt="${esc(firm)}" style="${S.lh}">` : `<p style="${S.p}"><b>${t(T1A.firm)}</b><br>${t(T1A.address)}</p>`}
<h1 style="${S.h1}">${t(CORP.title, d.company)}</h1>
<p data-k="meta" style="${S.small}">${t(CORP.preparedFor, name, d.company)}</p>
<p data-k="meta" style="${S.small}">${t(CORP.preparedBy, d.preparedBy, longDate(d.preparedOn))}</p>
<p data-k="meta" style="${S.small} margin-bottom: 10px;">${t(CORP.validUntil, longDate(d.validUntil))}</p>
<h2 style="${S.h2}">${t(CORP.servicesHeading)}</h2>
<ul style="${S.ul}">${corpServices(texts, d, o.mark).map(li).join("")}</ul>
<p data-k="fee" style="${S.fee}">${t(CORP.fee, money(d.totalCents))}</p>
<p style="${S.p}">${t(CORP.feeCovers)}</p>
<p style="${S.p}">${t(CORP.twoParts)}</p>
<h2 style="${S.h2}">${t(CORP.nextHeading)}</h2>
<ol style="${S.ol}">${[CORP.next1, CORP.next2, CORP.next3, CORP.next4, CORP.next5, CORP.next6, CORP.next7].map((p) => li(t(p))).join("")}</ol>
</div>`;
}

// ---------- Part B: the master letter, from the engine ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
function letter(texts: Record<string, string>, d: CorpQuoteData) {
  const paper = { innerHTML: "", classList: { toggle() {} } };
  const e: any = createStudioEngine({
    LH: "", ILLUS: ILLUSTRATIVE, SIG: BLANK_PNG, SIGNER: d.signer.name, SIGNER_TITLE: d.signer.title, WORDING: texts, EL_VERSION: undefined,
    $: ((id: string) => (id === "paper" ? paper : null)) as any,
  } as any);
  const c = new CorporateLetter(e, d.letterDate ?? d.preparedOn);
  for (const [k] of e.SVC_UI as [string][]) c.set("svc_" + k, k === "comp" || k === "t2" || (k === "gst" && d.extras.gst));
  for (const [k, v] of Object.entries({ company: d.company, signer: `${d.client.first} ${d.client.last}`.trim(), salutation: d.client.first, province: d.province, ye: d.yearEnd, payMethod: "td", firstYear: true })) c.set(k, v as never);
  // One fee line, the quote total, billed half and half (the existing year-end letter's terms).
  e.__set("FEES", [{ svc: "Year-end financial statements and corporate tax return", detail: "", kind: "once", amt: String(d.totalCents / 100), tag: "comp" }]);
  c.setMode("final");
  return { e, c, paper, s: c.state() };
}

// The engine's own fee-pointer sentence (published wording, or the original).
const FEE_KEY = "w84832f505f";
const FEE_TEXT = "Our fees, billing terms and how to set up your payment details are in Appendix A, Fees and payment. Appendix A forms part of this letter.";
const YOURS_KEY = "wd9e359fb71";

// The master letter's blocks with the two changes, for the PDF.
export function corpPartBBlocks(texts: Record<string, string>, d: CorpQuoteData): { e: any; s: any; blocks: any[] } {
  const { e, s } = letter(texts, d);
  const fee = texts[FEE_KEY] ?? FEE_TEXT;
  const yours = texts[YOURS_KEY] ?? "Yours truly,";
  const runsText = (b: any) => (b.r ?? []).map((r: any) => (typeof r === "string" ? r : r.t)).join("");
  const out: any[] = [];
  let skippedDate = false;
  for (const b of e.build(s)) {
    if (b.k === "lh" || b.k === "addr") continue;
    // The firm's half of the signature block stays; the client's half is Part C.
    if (b.k === "sig") { out.push({ k: "p", r: [{ t: e.FIRM, b: 1 }] }, { k: "p", r: [[d.signer.name, d.signer.title].filter(Boolean).join("\n")] }); continue; }
    if (b.k === "p" && !skippedDate) { skippedDate = true; continue; } // the letter's date: Part A carries the date
    if (b.k === "p" && runsText(b) === fee) { out.push({ k: "p", r: [plain(texts, CORP.feePointer)] }); continue; }
    if (b.k === "p" && runsText(b) === yours) out.push({ k: "p", r: [plain(texts, CORP.esign)] });
    out.push(b);
  }
  return { e, s, blocks: out };
}

// The same, as HTML for the page (the engine's own letter HTML with the same changes).
export function corpPartB(texts: Record<string, string>, d: CorpQuoteData): string {
  const { e, s, paper } = letter(texts, d);
  e.render(s);
  let h = paper.innerHTML as string;
  h = h.replace(/^<img class="lh"[^>]*>/, "");
  h = h.replace(/^<p>[^<]*<\/p>/, ""); // the letter's date
  h = h.replace(/<p style="margin-bottom:14px">[\s\S]*?<\/p>/, ""); // the address block
  const fee = esc(texts[FEE_KEY] ?? FEE_TEXT).replace(/&#39;/g, "’");
  h = h.replace(new RegExp(`<p>${fee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`), `<p>${esc(plain(texts, CORP.feePointer))}</p>`);
  const yours = `<p>${esc(texts[YOURS_KEY] ?? "Yours truly,")}</p>`;
  h = h.replace(yours, `<p>${esc(plain(texts, CORP.esign))}</p>${yours}`);
  const sig = h.indexOf('<div class="sig">');
  const firmSig = `<p><strong>${esc(e.FIRM)}</strong><br>${esc(d.signer.name)}${d.signer.title ? `<br>${esc(d.signer.title)}` : ""}</p>`;
  if (sig >= 0) { const next = h.indexOf('<div class="pgb">', sig); h = h.slice(0, sig) + firmSig + (next >= 0 ? h.slice(next) : ""); }
  return `<div class="studio-preview"><div class="paper" style="width:auto;max-width:none;padding:0;box-shadow:none;margin:0">${h}</div></div>`;
}

export function renderCorpQuote(texts: Record<string, string>, d: CorpQuoteData, o: Opts = {}): { label: string; html: string }[] {
  const t = (p: QPiece, ...f: (string | number)[]) => piece(texts, p, f, o.mark);
  const partC = `<div style="${S.doc}"><h2 style="${S.h2}">${t(C.partC)}</h2><p style="${S.p}">${t(C.typeName, `${d.client.first} ${d.client.last}`.trim())}</p></div>`;
  return [
    { label: "Part A: Your quote", html: corpPartA(texts, d, o) },
    { label: "Part B: Engagement terms (the corporate master letter)", html: corpPartB(texts, d) },
    { label: "Part C: Sign", html: partC },
  ];
}

// The quote email (Appendix C).
export function renderCorpEmail(texts: Record<string, string>, d: CorpQuoteData, sender: Sender, link: string, o: Opts = {}) {
  const t = (p: QPiece, ...f: (string | number)[]) => piece(texts, p, f, o.mark);
  const E = CORP_EMAIL;
  const p = (s: string) => `<p style="margin: 0 0 12px;">${s}</p>`;
  const ye = longDate(d.yearEnd), valid = longDate(d.validUntil);
  const steps = [E.step1, E.step2, E.step3, E.step4];
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1f1e;">
${p(t(E.hi, d.client.first))}${p(t(E.thanks))}${p(t(E.ready, d.company, ye))}${p(t(E.after))}
<ol style="margin: 0 0 12px; padding-left: 22px; list-style-type: decimal;">${steps.map((s) => `<li style="margin: 0 0 6px;">${t(s)}</li>`).join("")}</ol>
${p(t(E.valid, valid))}
<div style="margin: 16px 0;">${emailButton(link, t(E.button))}</div>
<p style="margin: 16px 0 0;">${esc(sender.name)}<br>${t(E.firm)}<br>${esc([sender.phone, sender.email].filter(Boolean).join(" | "))}</p>
</div>`.replace(/\n/g, "");
  const text = [plain(texts, E.hi, d.client.first), "", plain(texts, E.thanks), "", plain(texts, E.ready, d.company, ye), "", plain(texts, E.after),
    ...steps.map((s, i) => `${i + 1}. ${plain(texts, s)}`), "", plain(texts, E.valid, valid), "", `${plain(texts, E.button)}: ${link}`, "",
    sender.name, plain(texts, E.firm), [sender.phone, sender.email].filter(Boolean).join(" | ")].join("\n");
  return { subject: plain(texts, E.subject), subjectHtml: t(E.subject), html, text };
}

// The deposit and balance invoices (section 11: half after signing, half at client approval).
export function depositAndBalance(totalCents: number) {
  const deposit = Math.round(totalCents / 2);
  return { deposit, balance: totalCents - deposit };
}

export const CORP_SAMPLE: CorpQuoteData = {
  client: { first: "Taylor", last: "Sample" }, company: "Example Holdings Inc.", yearEnd: "2026-12-31", province: "ON", books: "statements",
  extras: { gst: true, slips: true }, totalCents: 369900, preparedBy: "Asmaa Ibrahim", preparedOn: "2026-11-10", validUntil: "2026-12-01",
  signer: { name: "Hashim Abouelfetouh, CPA", title: "Director" },
};
