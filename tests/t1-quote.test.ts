// Run with: npm test
// The T1 quote and engagement letter (Appendix A) and the quote emails (section 8): word for word
// against docs/PHASE2-BATCH.md, no line prices for the client, single and couple versions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderEmail, renderQuote, SAMPLE, SAMPLE_SENDER, type QuoteData } from "../src/lib/t1-quote/render.ts";
import { T1Q_PIECES } from "../src/lib/t1-quote/wording.ts";
import generated from "../src/lib/studio/wording.generated.json" with { type: "json" };

const batch = readFileSync(new URL("../docs/PHASE2-BATCH.md", import.meta.url), "utf8");
const section = (from: string, to: string) => batch.slice(batch.indexOf(from), batch.indexOf(to, batch.indexOf(from)));
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
// Sentences from the batch's markdown, without markdown marks; lines with [fill-ins] are checked separately.
const sentences = (md: string) => md.split("\n").map((l) => l.replace(/^>\s?/, "").replace(/^\s*(?:-|\d+\.)\s+/, "").replace(/\*\*/g, "").trim())
  .filter((l) => l && !l.includes("[") && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("Subject:"));

const single: QuoteData = { ...SAMPLE, spouse: null, lines: [{ code: "PTX-110", person: null, quantity: 1 }, { code: "PTX-120", person: null, quantity: 2 }, { code: "PTX-124", person: null, quantity: 4 }], totalCents: 29900 + 2 * 24900 + 4 * 14900 };
const all = (d: QuoteData, o = {}) => plain(renderQuote({}, d, o).map((p) => p.html).join(" "));

test("Part B engagement terms: every sentence of Appendix A, word for word", () => {
  const doc = all(SAMPLE);
  for (const s of sentences(section("### Part B: Engagement terms", "### Part C: Sign"))) assert.ok(doc.includes(s), `missing: ${s}`);
});

test("Part A quote: the fixed sentences of Appendix A, word for word", () => {
  const doc = all(SAMPLE);
  // The example services lines, from a quote that has each of those items.
  const ex = all({ ...SAMPLE, spouse: null, lines: [
    { code: "PTX-110", person: null, quantity: 1 }, { code: "PTX-120", person: null, quantity: 1 }, { code: "PTX-121", person: null, quantity: 1 },
    { code: "PTX-122", person: null, quantity: 1 }, { code: "PTX-123", person: null, quantity: 1 }, { code: "PTX-124", person: null, quantity: 1 },
    { code: "PTX-125", person: 0, quantity: 1 }, { code: "PTX-128", person: 0, quantity: 1 }] });
  for (const s of sentences(section("### Part A: Your quote", "### Part B: Engagement terms"))) {
    if (ex.includes(s)) continue;
    if (s === "Concept Accounting & Advisory Professional Corporation 675 Riverbend Dr., Kitchener, ON N2K 3S3") continue; // two lines on the page
    assert.ok(doc.includes(s), `missing: ${s}`);
  }
  assert.ok(doc.includes("Concept Accounting & Advisory Professional Corporation") && doc.includes("675 Riverbend Dr., Kitchener, ON N2K 3S3"));
});

test("Part A fill-ins: couple and single", () => {
  const c = all(SAMPLE);
  assert.ok(c.includes("Quote and engagement letter: personal income tax returns for the 2026 tax year"));
  assert.ok(c.includes("Prepared for: Jordan Sample and Riley Sample"));
  assert.ok(c.includes("Prepared by: Asmaa Ibrahim, Nov 10, 2026"));
  assert.ok(c.includes("Valid until: Dec 1, 2026"));
  assert.ok(c.includes("Preparation and electronic filing of both 2026 T1 Income Tax and Benefit Returns"));
  assert.ok(c.includes("Sale of investments (Jordan)"));
  assert.ok(c.includes("Your fee: $697.00 plus GST/HST"));
  assert.ok(c.includes("Jordan Sample, type your full name to sign. Riley Sample signs with their own link."));
  const s = all(single);
  assert.ok(s.includes("personal income tax return for the 2026 tax year"));
  assert.ok(s.includes("Preparation and electronic filing of your 2026 T1 Income Tax and Benefit Return"));
  assert.ok(s.includes("Rental income for 2 properties (Form T776)"));
  assert.ok(s.includes("4 GST/HST returns for your business"));
  assert.ok(!s.includes("signs with their own link"));
});

test("the client never sees a line price, only the total", () => {
  const s = all(single);
  for (const p of ["$299", "$249", "$149", "PTX-"]) assert.ok(!s.includes(p), p);
  assert.ok(s.includes("$1,393.00 plus GST/HST"));
});

test("DRAFT FOR REVIEW only when asked (unsent staff preview)", () => {
  assert.ok(!all(SAMPLE).includes("DRAFT FOR REVIEW"));
  assert.ok(all(SAMPLE, { watermark: true }).includes("DRAFT FOR REVIEW"));
});

test("signer comes from Settings", () => {
  assert.ok(all({ ...SAMPLE, signer: { name: "Hashim Abouelfetouh, CPA", title: "" } }).includes("CONCEPT ACCOUNTING & ADVISORY PROFESSIONAL CORPORATION Hashim Abouelfetouh, CPA"));
});

test("emails: section 8 word for word, single and couple", () => {
  const [one, two] = section("**Single filer**", "Store both as editable templates").split("**Couple, two signers**");
  const e1 = renderEmail({}, { ...SAMPLE, spouse: null }, SAMPLE_SENDER, ["https://x.test/q/a"]);
  const e2 = renderEmail({}, SAMPLE, SAMPLE_SENDER, ["https://x.test/q/a", "https://x.test/q/b"]);
  const skip = new Set(["Asmaa Ibrahim", "Single filer", "Couple, two signers"]);
  for (const s of sentences(one)) if (!skip.has(s)) assert.ok(plain(e1.html).includes(s), `single missing: ${s}`);
  for (const s of sentences(two)) if (!skip.has(s)) assert.ok(plain(e2.html).includes(s), `couple missing: ${s}`);
  assert.equal(e1.subject, "Your 2026 personal tax quote");
  assert.ok(plain(e1.html).includes("Hi Jordan,") && plain(e1.html).includes("Your quote is valid until Dec 1, 2026."));
  assert.ok(e1.html.includes('href="https://x.test/q/a"') && plain(e1.html).includes("Review and sign your quote"));
  assert.ok(plain(e2.html).includes("Hi Jordan and Riley,"));
  assert.ok(plain(e2.html).includes("Jordan, review and sign") && plain(e2.html).includes("Riley, review and sign"));
  assert.ok(e2.html.includes('href="https://x.test/q/b"'));
  assert.ok(plain(e1.html).includes("Asmaa Ibrahim") && plain(e1.html).includes("226-789-9591 | asmaa@conceptaccounting.ca"));
  assert.ok(e2.text.includes("Riley, review and sign: https://x.test/q/b"));
  for (const e of [e1, e2]) assert.ok(!/—/.test(e.html + e.text), "no em dashes");
});

test("edited wording is used", () => {
  const key = T1Q_PIECES.find((p) => p.text === "A CPA reviews every return before it is filed")!.key;
  assert.ok(all(SAMPLE).includes("A CPA reviews"));
  assert.ok(plain(renderQuote({ [key]: "Every return is reviewed by a CPA" }, SAMPLE).map((p) => p.html).join(" ")).includes("Every return is reviewed by a CPA"));
});

test("piece keys: right format, unique, no clash with the letters' pieces; fill-ins match", () => {
  const keys = T1Q_PIECES.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, /^w[0-9a-f]{10}$/);
  const gen = new Set((generated as { key: string }[]).map((p) => p.key));
  for (const k of keys) assert.ok(!gen.has(k), k);
  for (const p of T1Q_PIECES) assert.equal(new Set(p.text.match(/\{\d+\}/g) ?? []).size, p.fills.length, p.text);
});
