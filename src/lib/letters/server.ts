import "server-only";
// A Final letter from the Letter Builder, sent for online signing (front office batch, section 7).
// Rebuilt from the inputs saved at Final and the wording kept with it, so the client signs exactly
// the letter Hashim issued: the page shows the engine's own letter HTML; the signed PDF is the
// engine's own PDF of it, followed by the signatures and the signing record.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { createStudioEngine } from "@/lib/studio/engine.generated.js";
import { CorporateLetter, T1Letter, type Fee } from "@/lib/studio/controllers";
import { ILLUSTRATIVE, LETTERHEAD } from "@/lib/studio/assets.generated";
import { LETTERHEAD_URL } from "@/lib/t1-quote/render";
import { longDate } from "@/lib/closebook/fs-model";
import { DATE_PLACEHOLDER } from "@/lib/closebook/fs-text";
import { partBHtml, partBPdf, type LetterBuild } from "@/lib/corporate/render";
import type { QuoteRow } from "@/lib/t1-quote/server";

export type LetterDetails = { doc_kind: "corporate_letter" | "t1_letter" | "cb_mal"; inputs: { f: Record<string, unknown>; fees?: Fee[] }; label?: string; document_id?: string; engagement_id?: string;
  // cb_mal (round 11): the Management Responsibility Acknowledgement from Closebook step 9, built when the
  // preparer sends it. Its date is the day the signing officer signs ({{DATE}} until then).
  file_id?: string; html?: string; pdf?: unknown[]; position?: string };
export type LetterRow = QuoteRow & { details: LetterDetails | null; title: string | null };

function built(q: LetterRow, lh: string, sig: string) {
  const paper = { innerHTML: "", classList: { toggle() {} } };
  const signer = q.signer?.name ? q.signer : { name: "", title: "" };
  const e: any = createStudioEngine({ LH: lh, ILLUS: ILLUSTRATIVE, SIG: sig, SIGNER: signer.name, SIGNER_TITLE: signer.title, WORDING: q.wording ?? {}, P_NEED: true,
    $: ((id: string) => (id === "paper" ? paper : null)) as any } as any);
  const d = q.details!;
  const date = String(d.inputs.f.letterDate ?? "");
  if (d.doc_kind === "corporate_letter") {
    const c = new CorporateLetter(e, date);
    c.load(d.inputs.f as Record<string, string | boolean>, d.inputs.fees ?? [], "final");
    const s = c.state();
    return { e, s, paper, html: () => { e.render(s); return paper.innerHTML as string; }, blocks: () => e.build(s) };
  }
  const c = new T1Letter(e, date);
  Object.assign(c.f, d.inputs.f); c.setMode("final");
  const s = c.state();
  return { e, s, paper, html: () => e.t1Html(s) as string, blocks: () => e.buildT1(s) };
}

const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const wrap = (h: string) => `<div class="studio-preview"><div class="paper" style="width:auto;max-width:none;padding:0;box-shadow:none;margin:0">${h}</div></div>`;

// A company letter signed online takes the same e-sign form as the year-end quote's letter: its address
// block, the firm's half of the signatures with the signature image (the client signs on the
// Signatures page, so no blank lines for them), the sentence that signing online counts as signing by
// hand, and no "sign in TaxDome" sentence. The wording is otherwise the letter Hashim issued.
function companyBuild(q: LetterRow, lh: string, sig: string): LetterBuild {
  const b = built(q, lh, sig);
  const addr = (b.blocks() as { k: string; lines?: string[]; boldN?: number }[]).find((x) => x.k === "addr");
  return { e: b.e, s: b.s, paper: b.paper, addr: addr?.lines ?? [], addrBold: addr?.boldN ?? 1, signer: q.signer?.name ? q.signer : { name: "", title: "" }, corp: false };
}
const company = (q: LetterRow) => q.details?.doc_kind === "corporate_letter";

// The MAL's date and signature line: "[Date of signing]" and a blank line until the officer signs; then
// the day it was signed (Toronto) and "Signed electronically by <name>, <title>, on <date>".
export const MAL_DATE = "{{DATE}}";
export const MAL_ESIGN = "{{ESIGN}}";
export type MalSigned = { at: string; name: string; title: string } | null;
const malDay = (iso: string) => longDate(new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }));
const dated = (x: unknown, date: string, esign: string): unknown => (typeof x === "string" ? x.split(MAL_DATE).join(date).split(MAL_ESIGN).join(esign)
  : Array.isArray(x) ? x.map((y) => dated(y, date, esign))
  : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, dated(v, date, esign)])) : x);
const malFill = (x: unknown, s: MalSigned) => dated(x, s ? malDay(s.at) : DATE_PLACEHOLDER, s ? `Signed electronically by ${s.name}${s.title ? `, ${s.title}` : ""}, on ${malDay(s.at)}` : "");
export const isMal = (q: { kind?: string; details?: { doc_kind?: string } | null }) => q.kind === "letter" && q.details?.doc_kind === "cb_mal";

// The letter as the client reads it.
export function letterHtml(q: LetterRow, signature: string | null, signed?: MalSigned): string {
  if (isMal(q)) return malFill(q.details?.html ?? "", signed ?? null) as string;
  if (company(q)) return partBHtml(q.wording ?? {}, companyBuild(q, LETTERHEAD_URL, signature ?? BLANK), { letterhead: LETTERHEAD_URL, signature });
  return wrap(built(q, LETTERHEAD_URL, signature ?? BLANK).html());
}

// The fingerprint of what is signed: the letter's text, tables included.
export function letterHash(html: string): string {
  const text = html.replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|div|li|tr|h\d)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// The letter's PDF content, exactly as the Letter Builder lays it out.
export function letterPdf(q: LetterRow, signature: string | null, signed?: MalSigned): { content: unknown[]; images: Record<string, string> } {
  if (isMal(q)) return { content: malFill(q.details?.pdf ?? [], signed ?? null) as unknown[], images: {} };
  if (company(q)) return partBPdf(q.wording ?? {}, companyBuild(q, LETTERHEAD, signature ?? BLANK), LETTERHEAD, signature);
  const b = built(q, LETTERHEAD, signature ?? BLANK);
  const dd = b.e.pdfDoc(b.s, b.blocks(), LETTERHEAD);
  return { content: dd.content as unknown[], images: dd.images as Record<string, string> };
}

export const isCompanyLetter = (q: { kind?: string; details?: { doc_kind?: string } | null }) => q.kind === "letter" && (q.details?.doc_kind === "corporate_letter" || q.details?.doc_kind === "cb_mal");
