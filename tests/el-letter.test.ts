// Run with: npm test
// The engagement letter stands on its own (Hashim, Nov 11, 2026): letterhead, date, addressee and a
// Re line before "Dear", and the firm's signature at the end. T1 and corporate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderQuote, SAMPLE, LETTERHEAD_URL } from "../src/lib/t1-quote/render.ts";
import { documentHash, blocks } from "../src/lib/t1-quote/document.ts";
import { signedPdfDef } from "../src/lib/t1-quote/pdf-def.ts";
import { corpPartB, corpPartBPdf, CORP_SAMPLE, SIG_MARK } from "../src/lib/corporate/render.ts";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const D = { ...SAMPLE, emails: ["taylor@example.test", "jordan@example.test"] };

test("T1 letter opens with letterhead, date, addressee and Re line, in that order", () => {
  const b = renderQuote({}, D, { letterhead: LETTERHEAD_URL, signature: SIG })[1].html;
  const bl = blocks(b);
  assert.equal(bl[0].kind, "lh");
  assert.equal(bl[1].runs[0].text, "Nov 10, 2026", "the date the quote was sent");
  assert.equal(bl[2].kind, "addr");
  const addr = bl[2].runs.map((r) => r.text).join("");
  assert.ok(addr.includes("taylor@example.test") && addr.includes("jordan@example.test") && addr.includes(" and "), "both names and emails");
  assert.ok(bl[3].runs[0].text.startsWith("Re: Engagement letter for your 2026 personal income tax returns"));
  assert.ok(bl[4].runs[0].text.startsWith("Dear "));
});

test("T1 letter closes with the firm, the signature image, then the signer", () => {
  const b = renderQuote({}, D, { signature: SIG })[1].html;
  const t = text(b);
  assert.ok(/Yours truly, CONCEPT ACCOUNTING & ADVISORY PROFESSIONAL CORPORATION Hashim Abouelfetouh, CPA/.test(t));
  assert.ok(b.indexOf("data-sig") > b.indexOf("CONCEPT ACCOUNTING") && b.indexOf("data-sig") < b.lastIndexOf("Hashim Abouelfetouh"));
  assert.ok(!renderQuote({}, D)[1].html.includes("data-sig"), "no image when none is uploaded");
});

test("the signature image does not change the fingerprint", () => {
  assert.equal(documentHash(renderQuote({}, D, { signature: SIG })), documentHash(renderQuote({}, D)));
});

test("T1 signed PDF: the signature image is placed when there is one", () => {
  const parts = renderQuote({}, D, { letterhead: LETTERHEAD_URL, signature: SIG });
  const audit = { quoteId: "q", taxYear: 2026, sentAt: "2026-11-10T15:00:00Z", validUntil: "2026-12-01", wordingLabel: "EL v3.31", signers: [] };
  const def = signedPdfDef(parts, audit, undefined, SIG);
  assert.equal(def.images.sig, SIG);
  assert.ok(JSON.stringify(def.content).includes('"image":"sig"'));
  assert.ok(!JSON.stringify(signedPdfDef(renderQuote({}, D), audit).content).includes('"image":"sig"'));
});

const C = { ...CORP_SAMPLE, email: "taylor@example.test" };
test("corporate letter keeps its date and Re line, and addresses the company", () => {
  const t = text(corpPartB({}, C, { letterhead: LETTERHEAD_URL, signature: SIG }));
  assert.ok(t.startsWith("November 10, 2026"), t.slice(0, 80));
  assert.ok(t.includes("Example Holdings Inc. Attention: Taylor Sample taylor@example.test Dear Taylor,"));
  assert.ok(t.includes("Re: Engagement letter for Example Holdings Inc., the year ending December 31, 2026"));
  const h = corpPartB({}, C, { letterhead: LETTERHEAD_URL, signature: SIG });
  assert.ok(h.includes("data-lh") && h.includes("data-sig"));
});

test("corporate PDF: signature image in place, no marker left", () => {
  const withSig = JSON.stringify(corpPartBPdf({}, C, "data:image/png;base64,AAAA", SIG));
  assert.ok(withSig.includes('"image":"corpsig"') && !withSig.includes(SIG_MARK.slice(1)));
  const without = JSON.stringify(corpPartBPdf({}, C, "data:image/png;base64,AAAA", null));
  assert.ok(!without.includes("corpsig") && !without.includes(SIG_MARK.slice(1)));
});
