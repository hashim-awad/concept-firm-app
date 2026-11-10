// Run with: npm test
// Signing (Phase 2 step 8): the document fingerprint and the signed PDF with its audit page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderQuote, SAMPLE } from "../src/lib/t1-quote/render.ts";
import { blocks, documentHash, plainDocument } from "../src/lib/t1-quote/document.ts";
import { signedPdfDef } from "../src/lib/t1-quote/pdf-def.ts";

const parts = renderQuote({}, SAMPLE);

test("the fingerprint covers the exact quote and terms, and nothing else", () => {
  const h = documentHash(parts);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(documentHash(renderQuote({}, SAMPLE)), h, "same document, same fingerprint");
  assert.equal(documentHash(renderQuote({}, SAMPLE, { watermark: true })), h, "the staff watermark is not part of the document");
  assert.notEqual(documentHash(renderQuote({}, { ...SAMPLE, totalCents: 69800 })), h, "a different fee, a different fingerprint");
  const key = "wa100000009"; // "A CPA reviews every return before it is filed"
  assert.notEqual(documentHash(renderQuote({ [key]: "Changed" }, SAMPLE)), h, "different wording, a different fingerprint");
});

test("the document text read back from the page is complete", () => {
  const text = plainDocument(parts.slice(0, 2));
  assert.ok(text.includes("Your fee: $697.00 plus GST/HST"));
  assert.ok(text.includes("- Rental income for 1 property (Form T776)"));
  assert.ok(text.includes("12. Ending this agreement and governing law"));
  assert.ok(!text.includes("DRAFT FOR REVIEW"));
  const firm = blocks(parts[0].html)[0];
  assert.equal(firm.runs[0].bold, true);
});

const audit = {
  quoteId: "11111111-1111-1111-1111-111111111111", taxYear: 2026, sentAt: "2026-11-10T15:00:00Z", validUntil: "2026-12-01", wordingLabel: "EL v3.31",
  signers: [
    { name: "Jordan Sample", signedName: "Jordan Sample", email: "jordan@example.test", signedAt: "2026-11-11T16:30:00Z", ip: "203.0.113.5", agent: "Test browser", sameDevice: false, documentHash: "a".repeat(64) },
    { name: "Riley Sample", signedName: "Riley Sample", email: "riley@example.test", signedAt: "2026-11-11T16:32:00Z", ip: "203.0.113.5", agent: "Test browser", sameDevice: true, documentHash: "a".repeat(64) },
  ],
};

test("the signed PDF holds the quote, the terms, both signatures and the signing record", () => {
  const def = signedPdfDef(parts, audit);
  const all = JSON.stringify(def.content);
  for (const s of ["Your fee: $697.00 plus GST/HST", "1. Our services", "Signatures", "Signing record", "Jordan Sample", "Riley Sample",
    "203.0.113.5", "Test browser", "a".repeat(64), "Same device as the other signer", "on the same device as the other signer", "Nov 11, 2026"]) {
    assert.ok(all.includes(s), s);
  }
  assert.ok(!all.includes("DRAFT FOR REVIEW"));
  assert.ok(!all.includes("$349") && !all.includes("$249"), "no line prices");
});

test("pdfmake builds the PDF", async () => {
  const require = createRequire(import.meta.url);
  const PdfPrinter = require("pdfmake/src/printer");
  const vfs = require("pdfmake/build/vfs_fonts.js").pdfMake.vfs as Record<string, string>;
  const f = (n: string) => Buffer.from(vfs[n], "base64");
  const printer = new PdfPrinter({ Roboto: { normal: f("Roboto-Regular.ttf"), bold: f("Roboto-Medium.ttf"), italics: f("Roboto-Italic.ttf"), bolditalics: f("Roboto-MediumItalic.ttf") } });
  const doc = printer.createPdfKitDocument(signedPdfDef(parts, audit));
  const chunks: Buffer[] = [];
  const bytes: Buffer = await new Promise((resolve, reject) => { doc.on("data", (c: Buffer) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); doc.end(); });
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 10000);
});

test("letterhead: on the page and in the PDF, with the firm name and address kept in the document text", async () => {
  const { LETTERHEAD_URL } = await import("../src/lib/t1-quote/render.ts");
  const withLh = renderQuote({}, SAMPLE, { letterhead: LETTERHEAD_URL });
  assert.ok(withLh[0].html.includes('src="/studio/letterhead.jpg"'));
  const b = blocks(withLh[0].html);
  assert.equal(b[0].kind, "lh");
  assert.ok(plainDocument(withLh).startsWith("Concept Accounting & Advisory Professional Corporation, 675 Riverbend Dr., Kitchener, ON N2K 3S3"));
  const def = signedPdfDef(withLh, audit);
  assert.ok(String(def.images.lh).startsWith("data:image/jpeg;base64,"));
  assert.equal(def.content[0].image, "lh");
  assert.equal(b.find((x) => x.kind === "fee")?.runs[0].text, "Your fee: $697.00 plus GST/HST");
});
