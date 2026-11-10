// The signed T1 quote and engagement letter as a PDF (pdfmake definition): Parts A and B as the
// client read them, the typed signatures, and an audit page with the signing record.
// Pure: the server turns it into the PDF; tests check what it holds.
import { blocks, type Block } from "./document.ts";

export type AuditSigner = { name: string; signedName: string; email: string; signedAt: string; ip: string; agent: string; sameDevice: boolean; documentHash: string };
export type AuditInfo = { quoteId: string; taxYear: number; sentAt: string; validUntil: string; wordingLabel: string; signers: AuditSigner[] };

const TZ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/Toronto", timeZoneName: "short" });
export const auditTime = (iso: string) => (iso ? TZ.format(new Date(iso)) : "");

/* eslint-disable @typescript-eslint/no-explicit-any */
function node(b: Block): any {
  const runs = b.runs.map((r) => ({ text: r.text, bold: r.bold }));
  switch (b.kind) {
    case "h1": return { text: runs, fontSize: 15, bold: true, margin: [0, 10, 0, 6] };
    case "h2": return { text: runs, fontSize: 12.5, bold: true, margin: [0, 12, 0, 4] };
    case "h3": return { text: runs, fontSize: 11, bold: true, margin: [0, 9, 0, 3] };
    case "ul": return { ul: b.items, margin: [0, 0, 0, 6] };
    case "ol": return { ol: b.items, margin: [0, 0, 0, 6] };
    default: return { text: runs, margin: [0, 0, 0, 6] };
  }
}

export function signedPdfDef(parts: { label: string; html: string }[], audit: AuditInfo): any {
  const [a, b] = parts;
  const signatures = audit.signers.map((s) => ({
    stack: [
      { text: s.signedName, fontSize: 18, italics: true, color: "#1A3C7C", margin: [0, 8, 0, 2] },
      { text: `Signed electronically by ${s.name} on ${auditTime(s.signedAt)}${s.sameDevice ? ", on the same device as the other signer" : ""}.`, fontSize: 9, color: "#3d4441" },
    ], margin: [0, 0, 0, 10],
  }));
  const row = (k: string, v: string) => [{ text: k, bold: true, fontSize: 9 }, { text: v, fontSize: 9 }];
  const audits = audit.signers.flatMap((s, i) => [
    { text: `Signer ${i + 1}: ${s.name}`, bold: true, margin: [0, 12, 0, 4] },
    { table: { widths: [130, "*"], body: [
      row("Name typed to sign", s.signedName), row("Email", s.email), row("Signed", auditTime(s.signedAt)),
      row("IP address", s.ip || "Not available"), row("Browser", s.agent || "Not available"),
      row("Same device as the other signer", s.sameDevice ? "Yes" : "No"), row("Document fingerprint (SHA-256)", s.documentHash),
    ] }, layout: "lightHorizontalLines" },
  ]);
  return {
    pageSize: "LETTER",
    pageMargins: [54, 54, 54, 54],
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.25 },
    info: { title: `Quote and engagement letter, ${audit.taxYear}`, author: "Concept Accounting & Advisory Professional Corporation" },
    footer: (cur: number, total: number) => ({ text: `Page ${cur} of ${total}`, alignment: "center", fontSize: 8, color: "#6b7280", margin: [0, 18, 0, 0] }),
    content: [
      ...blocks(a.html).map(node),
      { text: "", pageBreak: "after" },
      ...blocks(b.html).map(node),
      { text: "Signatures", fontSize: 12.5, bold: true, margin: [0, 16, 0, 2] },
      { text: "I have read my quote and these engagement terms, and I agree to them.", margin: [0, 0, 0, 4] },
      ...signatures,
      { text: "Signing record", fontSize: 15, bold: true, pageBreak: "before", margin: [0, 0, 0, 6] },
      { text: "This page records how this quote and engagement letter was signed in Concept Studio. Each person signed through their own private link by typing their full name and ticking the agreement box. The fingerprint identifies the exact text of the quote and terms that was signed; any change to the text gives a different fingerprint.", fontSize: 9, margin: [0, 0, 0, 8] },
      { table: { widths: [130, "*"], body: [
        row("Quote reference", audit.quoteId), row("Tax year", String(audit.taxYear)), row("Sent", auditTime(audit.sentAt)),
        row("Valid until", audit.validUntil), row("Wording version", audit.wordingLabel || "Published wording at sending"),
      ] }, layout: "lightHorizontalLines" },
      ...audits,
    ],
  };
}
