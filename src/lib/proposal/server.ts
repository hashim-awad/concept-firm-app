import "server-only";
// A sent proposal as the client sees and signs it (front office batch, section 5, item 2):
// Part A, the proposal, from Studio's engine with the wording kept when it was sent; then, for each
// option, the corporate engagement letter that option becomes. The client picks one and signs it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { createStudioEngine } from "@/lib/studio/engine.generated.js";
import { CorporateLetter, Proposal } from "@/lib/studio/controllers";
import { LETTERHEAD } from "@/lib/studio/assets.generated";
import { esignWording, letterEngine, partBHtml, partBPdf, type LetterBuild } from "@/lib/corporate/render";
import { LETTERHEAD_URL } from "@/lib/t1-quote/render";
import { fillLetter, letterValue, packedOptions, type ProposalInputs } from "./letter";
import type { QuoteRow, SignerRow } from "@/lib/t1-quote/server";

export type ProposalRow = QuoteRow & { proposal: ProposalInputs | null; chosen_option: number | null; title: string | null };

const sentDay = (q: ProposalRow) => (q.sent_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(q.sent_at)) : "");
const signerOf = (q: ProposalRow) => (q.signer?.name ? q.signer : { name: "", title: "" });

// The proposal engine's input, as it was sent: dated the day it was sent, valid 21 days.
function proposalState(q: ProposalRow, lh: string) {
  const e: any = createStudioEngine({ LH: lh, SIGNER: signerOf(q).name, SIGNER_TITLE: signerOf(q).title, WORDING: q.wording ?? {} } as any);
  const p = new Proposal(e, sentDay(q));
  const data = q.proposal!;
  Object.assign(p.f, data.f, { date: sentDay(q), valid: "21" });
  e.__set("POPTS", JSON.parse(JSON.stringify(data.opts)));
  e.__set("pRec", data.rec ?? 0);
  p.setMode("final");
  return { e, s: p.state() };
}

// The letter for option i, built the way the builder checked it.
function letterBuild(q: ProposalRow, i: number): LetterBuild {
  const data = q.proposal!;
  const { e: pe, s } = proposalState(q, "");
  const o = packedOptions(pe, s)[i];
  const { e, paper } = letterEngine(esignWording(q.wording ?? {}), signerOf(q));
  const c = fillLetter(new CorporateLetter(e, sentDay(q)), o, data.f, sentDay(q));
  const f = (k: Parameters<typeof letterValue>[1]) => letterValue(data.f, k);
  return { e, s: c.state(), paper, addr: [f("company"), `Attention: ${f("signer")}`, f("email")].filter(Boolean), signer: signerOf(q), corp: false };
}

const wrap = (h: string) => `<div class="studio-preview"><div class="paper" style="width:auto;max-width:none;padding:0;box-shadow:none;margin:0">${h}</div></div>`;

export type ProposalView = { partA: string; options: { name: string; letter: string }[]; recommended: number };

// What the client reads: the proposal and each option's letter (HTML).
export function proposalView(q: ProposalRow, signature: string | null): ProposalView {
  const { e, s } = proposalState(q, LETTERHEAD_URL);
  const options = packedOptions(e, s).map((o, i) => ({ name: o.n || `Option ${"ABC"[i]}`, letter: partBHtml(q.wording ?? {}, letterBuild(q, i), { letterhead: LETTERHEAD_URL, signature }) }));
  return { partA: wrap(e.pHtml(s)), options, recommended: q.proposal?.rec ?? 0 };
}

// The fingerprint of what was signed: the proposal and the chosen option's letter, as text (tables
// and option boxes included), with the option's name.
export function proposalHash(view: ProposalView, option: number): string {
  const text = (h: string) => h.replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|div|li|tr|h\d)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
  return createHash("sha256").update(`${text(view.partA)}\nOption chosen: ${view.options[option].name}\n${text(view.options[option].letter)}`, "utf8").digest("hex");
}

// The signed PDF's two parts: the proposal as the engine lays it out, then the chosen letter.
export function proposalPdfParts(q: ProposalRow, option: number, signature: string | null) {
  const { e, s } = proposalState(q, LETTERHEAD);
  const dd = e.pPdf(s);
  const name = packedOptions(e, s)[option]?.n || `Option ${"ABC"[option]}`;
  const b = partBPdf(q.wording ?? {}, letterBuild(q, option), LETTERHEAD, signature);
  return {
    partA: { content: dd.content as unknown[], images: dd.images as Record<string, string> },
    // The letter's letterhead first, then the option the client chose.
    partB: { content: [b.content[0], { text: `Option chosen: ${name}`, bold: true, color: "#1A3C7C", margin: [0, 0, 0, 10] }, ...b.content.slice(1)], images: b.images },
    optionName: name,
  };
}

export const isProposal = (q: { kind?: string }) => q.kind === "proposal";
export type { SignerRow };
