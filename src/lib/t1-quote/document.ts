// The signed document, built from exactly the HTML the client reads (renderQuote), so the PDF and the
// fingerprint cannot differ from the page. Pure (no server imports): tests use it too.
import { createHash } from "node:crypto";

export type Block = { kind: "h1" | "h2" | "h3" | "p" | "ul" | "ol"; runs: { text: string; bold?: boolean }[]; items?: string[] };

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = (html: string) => unescape(html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();

// Headings, paragraphs and lists, in order. The DRAFT watermark (a <div>) is never part of it.
export function blocks(html: string): Block[] {
  const out: Block[] = [];
  for (const m of html.matchAll(/<(h1|h2|h3|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const kind = m[1] as Block["kind"], inner = m[2];
    if (kind === "ul" || kind === "ol") { out.push({ kind, runs: [], items: [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((x) => text(x[1])) }); continue; }
    const runs: Block["runs"] = [];
    let last = 0;
    for (const b of inner.matchAll(/<b>([\s\S]*?)<\/b>/g)) {
      if (b.index! > last) runs.push({ text: text(inner.slice(last, b.index)) });
      runs.push({ text: text(b[1]), bold: true });
      last = b.index! + b[0].length;
    }
    if (last < inner.length) runs.push({ text: text(inner.slice(last)) });
    out.push({ kind, runs: runs.filter((r) => r.text) });
  }
  return out;
}

// The document as plain text, one block per line: what the fingerprint covers.
export function plainDocument(parts: { html: string }[]): string {
  return parts.flatMap((p) => blocks(p.html)).map((b) => b.items ? b.items.map((i) => `- ${i}`).join("\n") : b.runs.map((r) => r.text).join(" ")).join("\n");
}

// SHA-256 fingerprint of the exact quote and terms signed (Parts A and B).
export function documentHash(parts: { html: string }[]): string {
  return createHash("sha256").update(plainDocument(parts.slice(0, 2)), "utf8").digest("hex");
}
