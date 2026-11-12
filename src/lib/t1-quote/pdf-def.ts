// The signed T1 quote and engagement letter as a PDF (pdfmake definition): Parts A and B as the
// client read them, the typed signatures, and an audit page with the signing record.
// Pure: the server turns it into the PDF; tests check what it holds.
import { blocks, type Block } from "./document.ts";
import { LETTERHEAD } from "../studio/assets.generated.ts";

const NAVY = "#1A3C7C";

export type AuditSigner = { name: string; signedName: string; email: string; signedAt: string; ip: string; agent: string; sameDevice: boolean; documentHash: string; title?: string };
// company: a corporate quote, signed on behalf of the company (the master letter's signature wording).
// docTitle and option: a proposal ("Proposal and engagement letter", the option the client chose).
export type AuditInfo = { quoteId: string; taxYear: number | null; docTitle?: string; option?: string; sentAt: string; validUntil: string; wordingLabel: string; clientNames?: string; company?: string; signers: AuditSigner[] };

const TZ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/Toronto", timeZoneName: "short" });
export const auditTime = (iso: string) => (iso ? TZ.format(new Date(iso)) : "");

/* eslint-disable @typescript-eslint/no-explicit-any */
function node(b: Block, hasSig = false): any {
  const runs = b.runs.map((r) => ({ text: r.text, bold: r.bold }));
  // Same look as the firm's engagement letters (pdfDoc in the Studio engine).
  switch (b.kind) {
    case "lh": return { image: "lh", width: 492, margin: [0, 0, 0, 18] };
    case "sig": return hasSig ? { image: "sig", width: 130, margin: [0, 0, 0, 2] } : { text: "" };
    case "addr": return { text: runs, alignment: "left", margin: [0, 0, 0, 12] };
    case "h1": return { text: runs, fontSize: 13.5, bold: true, color: NAVY, alignment: "left", margin: [0, 0, 0, 8] };
    case "h2": return { text: runs, fontSize: 11.5, bold: true, color: NAVY, alignment: "left", margin: [0, 10, 0, 6] };
    case "h3": return { text: runs, fontSize: 11, bold: true, color: NAVY, alignment: "left", margin: [0, 8, 0, 6] };
    case "meta": return { text: runs, color: "#3d4441", alignment: "left", margin: [0, 0, 0, 2] };
    case "fee": return { table: { widths: ["*"], body: [[{ text: runs, fontSize: 12, bold: true, color: NAVY, margin: [8, 6, 8, 6] }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2.5 : 0), vLineColor: () => NAVY, fillColor: () => "#F2F5FB" }, margin: [0, 8, 0, 8] };
    case "signer": return { text: runs, alignment: "left", margin: [0, 0, 0, 8] };
    case "ul": return { ul: b.items, markerColor: NAVY, margin: [12, 0, 0, 8] };
    case "ol": return { ol: b.items, markerColor: NAVY, margin: [12, 0, 0, 8] };
    default: return { text: runs, margin: [0, 0, 0, 8] };
  }
}

// partB: for a corporate quote, the master letter as Studio's engine lays it out (pdfDoc content and images).
// signature: the firm signer's signature image (data URL) for the letter's closing.
export function signedPdfDef(parts: { label: string; html: string }[], audit: AuditInfo, partB?: { content: unknown[]; images: Record<string, string> }, signature?: string | null,
  partA?: { content: unknown[]; images: Record<string, string> }): any {
  const [a, b] = parts;
  const title = audit.docTitle ?? `Quote and engagement letter ${audit.taxYear}`;
  // What was signed, in the signing record's words: a quote, a proposal, or a New letter.
  const doc = audit.docTitle === "Engagement letter" ? { name: "this engagement letter", read: "the engagement letter", text: "the letter", ref: "Letter reference" }
    : audit.option ? { name: "this proposal and engagement letter", read: "the proposal and the engagement letter for the option they chose", text: "the proposal and the letter", ref: "Proposal reference" }
    : { name: "this quote and engagement letter", read: "the quote and engagement terms", text: "the quote and terms", ref: "Quote reference" };
  // One signature block per signer, side by side, like the letters' "Agreed and accepted" blocks.
  const sig = (s: AuditSigner) => ({ stack: [
    { text: audit.company ? `Agreed and accepted on behalf of ${audit.company}` : "Agreed and accepted", bold: true, color: NAVY, margin: [0, 0, 0, 6] },
    { text: s.signedName, fontSize: 18, italics: true, color: NAVY, margin: [0, 0, 0, 2] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6, lineColor: "#7a8394" }] },
    { text: s.name, bold: true, margin: [0, 4, 0, 0] },
    ...(audit.company ? [...(s.title ? [{ text: `Title: ${s.title}` }] : []), { text: "I have authority to bind the Company.", fontSize: 9 }] : []),
    { text: `Signed electronically ${auditTime(s.signedAt)}${s.sameDevice ? ", on the same device as the other signer" : ""}`, fontSize: 8.5, color: "#3d4441" },
  ] });
  const signatures: any[] = [];
  for (let i = 0; i < audit.signers.length; i += 2) {
    signatures.push({ columns: [sig(audit.signers[i]), audit.signers[i + 1] ? sig(audit.signers[i + 1]) : { text: "" }], columnGap: 30, margin: [0, i ? 22 : 8, 0, 0], unbreakable: true });
  }
  const row = (k: string, v: string) => [{ text: k, bold: true, fontSize: 9, alignment: "left" }, { text: v, fontSize: 9, alignment: "left" }];
  const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : iso);
  const audits = audit.signers.flatMap((s, i) => [
    { text: `Signer ${i + 1}: ${s.name}`, bold: true, color: NAVY, margin: [0, 12, 0, 4] },
    { table: { widths: [130, "*"], body: [
      row("Name typed to sign", s.signedName), ...(s.title ? [row("Title", s.title)] : []), row("Email", s.email), row("Signed", auditTime(s.signedAt)),
      row("IP address", s.ip || "Not available"), row("Browser", s.agent || "Not available"),
      // Only when there is another signer (a couple).
      ...(audit.signers.length > 1 ? [row("Same device as the other signer", s.sameDevice ? "Yes" : "No")] : []), row("Document fingerprint (SHA-256)", s.documentHash),
    ] }, layout: "lightHorizontalLines" },
  ]);
  return {
    pageSize: "LETTER",
    pageMargins: [60, 48, 60, 56],
    images: { ...(partA?.images ?? {}), ...(partB?.images ?? {}), lh: LETTERHEAD, ...(signature ? { sig: signature } : {}) },
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.22, color: "#1d2330", alignment: "justify" },
    info: { title, author: "Concept Accounting & Advisory Professional Corporation" },
    footer: (cur: number, total: number) => ({ columns: [
      { width: "*", text: `${audit.clientNames ? `${audit.clientNames}  |  ` : ""}${title}  |  Signed`, fontSize: 7.5, color: "#7a8394" },
      { width: 70, text: `Page ${cur} of ${total}`, alignment: "right", fontSize: 7.5, color: "#7a8394" },
    ], margin: [60, 18, 60, 0] }),
    content: [
      ...(partA ? partA.content : blocks(a.html).map((x) => node(x))),
      { text: "", pageBreak: "after" },
      ...(partB ? partB.content : blocks(b.html).map((x) => node(x, !!signature))),
      // The heading, the agreement and the first row of signatures stay on one page.
      { unbreakable: true, stack: [
        { text: "Signatures", fontSize: 11.5, bold: true, color: NAVY, margin: [0, 14, 0, 4] },
        { text: audit.option ? `I have read the proposal and the engagement letter for ${audit.option}, and I agree to them.` : audit.docTitle === "Engagement letter" ? "I have read this engagement letter, and I agree to it." : "I have read my quote and these engagement terms, and I agree to them.", margin: [0, 0, 0, 6] },
        signatures[0],
      ] },
      ...signatures.slice(1),
      { image: "lh", width: 492, margin: [0, 0, 0, 18], pageBreak: "before" },
      { text: "Signing record", fontSize: 13.5, bold: true, color: NAVY, margin: [0, 0, 0, 6] },
      { text: `This page records how ${doc.name} was signed in Concept Studio. Each person signed through their own private link by typing their full name and clicking Sign under the statement that they have read ${doc.read} and agree to ${audit.docTitle === "Engagement letter" ? "it" : "them"}. The fingerprint identifies the exact text of ${doc.text} that was signed; any change to the text gives a different fingerprint.`, fontSize: 9, margin: [0, 0, 0, 8] },
      { table: { widths: [130, "*"], body: [
        row(doc.ref, audit.quoteId), ...(audit.taxYear ? [row("Tax year", String(audit.taxYear))] : []), ...(audit.option ? [row("Option chosen", audit.option)] : []), row("Sent", auditTime(audit.sentAt)),
        row("Valid until", day(audit.validUntil)), row("Wording version", audit.wordingLabel || "Published wording at sending"),
      ] }, layout: "lightHorizontalLines" },
      ...audits,
    ],
  };
}
