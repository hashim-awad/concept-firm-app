// Run with: npm test
// The corporate year-end quote (section 11, Appendix C): Part A and the email word for word against
// docs/PHASE2-BATCH.md; Part B is the corporate master letter with exactly the two recorded changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { CorporateLetter } from "../src/lib/studio/controllers.ts";
import { corpPartA, corpPartB, corpPartBBlocks, depositAndBalance, renderCorpEmail, CORP_SAMPLE } from "../src/lib/corporate/render.ts";
import { SAMPLE_SENDER } from "../src/lib/t1-quote/render.ts";

const batch = readFileSync(new URL("../docs/PHASE2-BATCH.md", import.meta.url), "utf8");
const appC = batch.slice(batch.indexOf("## Appendix C"));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const sentences = (md: string) => md.split("\n").map((l) => l.replace(/^>\s?/, "").replace(/^\s*(?:-|\d+\.)\s+/, "").replace(/\*\*/g, "").trim())
  .filter((l) => l && !l.includes("[") && !l.startsWith("#") && !l.startsWith("If ") && !l.startsWith("Subject:") && !l.startsWith("Fields in") && !l.startsWith("Concept Accounting & Advisory Professional Corporation 675"));

test("Part A: Appendix C word for word", () => {
  const a = text(corpPartA({}, CORP_SAMPLE));
  const partA = appC.slice(appC.indexOf("### Part A"), appC.indexOf("### Quote email"));
  for (const s of sentences(partA)) assert.ok(a.includes(s), `missing: ${s}`);
  assert.ok(a.includes("Quote and engagement letter: year-end financial statements and corporate tax return for Example Holdings Inc."));
  assert.ok(a.includes("Prepared for: Taylor Sample, Example Holdings Inc."));
  assert.ok(a.includes("Year-end financial statements for the year ending Dec 31, 2026, prepared by a CPA"));
  assert.ok(a.includes("Your fee: $3,699.00 plus GST/HST"));
});

test("Part A: the 'if' lines follow the answers", () => {
  const book = text(corpPartA({}, { ...CORP_SAMPLE, books: "bookkeeper", extras: { gst: false, slips: false } }));
  assert.ok(book.includes("Review of your bookkeeper's year-end records and year-end adjustments"));
  assert.ok(!book.includes("GST/HST return for the year") && !book.includes("Tax slips for people"));
  assert.ok(text(corpPartA({}, { ...CORP_SAMPLE, books: "software" })).includes("Review of your accounting file and year-end adjustments"));
  const st = text(corpPartA({}, CORP_SAMPLE));
  assert.ok(st.includes("Bookkeeping for the year from your bank and credit card statements") && st.includes("GST/HST return for the year") && st.includes("Tax slips for people the company paid (T4, T4A and T5)"));
  assert.ok(!st.includes("$2,900") && !st.includes("$250"), "no line prices");
});

test("email: Appendix C word for word", () => {
  const e = renderCorpEmail({}, CORP_SAMPLE, SAMPLE_SENDER, "https://x.test/q/a");
  const em = appC.slice(appC.indexOf("### Quote email"));
  for (const s of sentences(em)) if (s !== "Asmaa Ibrahim") assert.ok(text(e.html).includes(s), `missing: ${s}`);
  assert.equal(e.subject, "Your company's year-end quote");
  assert.ok(text(e.html).includes("your quote for Example Holdings Inc.'s year ending Dec 31, 2026 is ready"));
  assert.ok(e.html.includes('href="https://x.test/q/a"'));
});

/* eslint-disable @typescript-eslint/no-explicit-any */
test("Part B: the corporate master letter, word for word, with exactly the two recorded changes", () => {
  // The master letter as Studio builds it for the same company and services.
  const e: any = createStudioEngine({ SIGNER: CORP_SAMPLE.signer.name, SIGNER_TITLE: CORP_SAMPLE.signer.title } as any);
  const c = new CorporateLetter(e, CORP_SAMPLE.preparedOn);
  for (const [k] of e.SVC_UI as [string][]) c.set("svc_" + k, ["comp", "t2", "gst"].includes(k));
  for (const [k, v] of Object.entries({ company: CORP_SAMPLE.company, signer: "Taylor Sample", salutation: "Taylor", province: "ON", ye: CORP_SAMPLE.yearEnd, payMethod: "td", firstYear: true })) c.set(k, v as never);
  e.__set("FEES", [{ svc: "Year-end financial statements and corporate tax return", detail: "", kind: "once", amt: "3699", tag: "comp" }]);
  c.setMode("final");
  const master = e.build(c.state()).filter((b: any) => b.k === "p" || b.k === "h" || b.k === "ul");
  const ours = corpPartBBlocks({}, CORP_SAMPLE).blocks.filter((b: any) => b.k === "p" || b.k === "h" || b.k === "ul");
  const t = (b: any) => (b.k === "h" ? b.t : b.k === "ul" ? b.items.join("|") : b.r.map((r: any) => (typeof r === "string" ? r : r.t)).join(""));
  const m = master.map(t), o = ours.map(t);
  // Removed: the date (Part A has it). Changed: the fee sentence. Added: the e-signature sentence and the firm's signature lines.
  const removed = m.filter((x: string) => !o.includes(x));
  const added = o.filter((x: string) => !m.includes(x));
  assert.deepEqual(removed, ["November 10, 2026", "Our fees, billing terms and how to set up your payment details are in Appendix A, Fees and payment. Appendix A forms part of this letter."]);
  assert.deepEqual(added, [
    "Your fee is the amount in your quote. Our billing terms and how to pay are in Appendix A, Fees and payment. Appendix A forms part of this letter.",
    "You agree that signing this letter electronically has the same effect as signing it by hand.",
    "Concept Accounting & Advisory Professional Corporation", "Hashim Abouelfetouh, CPA\nDirector",
  ]);
  // The page version has the same changes, and no signature block or address.
  const html = corpPartB({}, CORP_SAMPLE);
  assert.ok(html.includes("Your fee is the amount in your quote.") && html.includes("signing this letter electronically") && !html.includes('class="sig"'));
  assert.ok(text(html).includes("$1,849.50 plus HST when you sign this letter"), "Appendix A bills half and half");
});

test("deposit and balance: half and half, to the cent", () => {
  assert.deepEqual(depositAndBalance(369900), { deposit: 184950, balance: 184950 });
  assert.deepEqual(depositAndBalance(369901), { deposit: 184951, balance: 184950 });
});
