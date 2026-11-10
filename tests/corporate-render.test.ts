// Run with: npm test
// The corporate year-end quote (section 11, Appendix C): Part A and the email word for word against
// docs/PHASE2-BATCH.md; Part B is the corporate master letter with only the changes recorded in docs/BRIEF.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { CorporateLetter } from "../src/lib/studio/controllers.ts";
import { accountsList, corpPartA, corpPartB, corpPartBBlocks, depositAndBalance, renderCorpEmail, CORP_SAMPLE } from "../src/lib/corporate/render.ts";
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
test("Part B: the corporate master letter, word for word, with only the recorded changes", () => {
  // The master letter as Studio builds it for the same company and services.
  const e: any = createStudioEngine({ SIGNER: CORP_SAMPLE.signer.name, SIGNER_TITLE: CORP_SAMPLE.signer.title } as any);
  const c = new CorporateLetter(e, CORP_SAMPLE.preparedOn);
  for (const [k] of e.SVC_UI as [string][]) c.set("svc_" + k, ["comp", "t2", "gst"].includes(k));
  for (const [k, v] of Object.entries({ company: CORP_SAMPLE.company, signer: "Taylor Sample", salutation: "Taylor", province: "ON", ye: CORP_SAMPLE.yearEnd, payMethod: "td", firstYear: true })) c.set(k, v as never);
  e.__set("FEES", [{ svc: "Year-end financial statements and corporate tax return", detail: "", kind: "once", amt: "3699", tag: "comp" }]);
  c.setMode("final");
  const keep = (b: any) => b.k === "p" || b.k === "h" || b.k === "ul" || b.k === "table";
  const master = e.build(c.state()).filter(keep);
  const ours = corpPartBBlocks({}, CORP_SAMPLE).blocks.filter(keep);
  const t = (b: any) => (b.k === "h" ? b.t : b.k === "ul" ? b.items.join("|") : b.k === "table" ? b.rows.map((r: any[]) => r.join(" / ")).join("|") : b.r.map((r: any) => (typeof r === "string" ? r : r.t)).join(""));
  const m = master.map(t), o = ours.map(t);
  // Every difference is one recorded in docs/BRIEF.md, nothing else.
  const removed = m.filter((x: string) => !o.includes(x));
  const added = o.filter((x: string) => !m.includes(x));
  assert.deepEqual(removed, [
    "November 10, 2026",
    "3. GST/HST returns",
    "We will prepare and file the Company’s GST/HST returns at the filing frequency CRA has assigned to the Company, from the information you give us. You remain responsible for paying any GST/HST owing by the due date.",
    "Our fees, billing terms and how to set up your payment details are in Appendix A, Fees and payment. Appendix A forms part of this letter.",
    "This letter covers only the services described above. Other work is not included, for example review or audit engagements; tax planning and reorganizations; CRA audits, objections and disputes; personal tax returns; and legal, valuation and investment advice. We will agree any other work with you in writing, in a Change Order, before we start.",
    "Please sign and return this letter to confirm that it reflects your understanding. We will start work once we receive the signed letter and the first invoice is paid.",
    "Year-end financial statements and corporate tax return / $3,699 plus HST / ",
    "$1,849.50 plus HST when you sign this letter|$1,849.50 plus HST when the work is complete",
    "You sign this letter and pay the invoice in the same step, in your secure TaxDome client portal.",
  ]);
  assert.deepEqual(added, [
    "3. GST/HST return",
    "We will prepare and file the Company's annual GST/HST return for the year, from the information you give us. You remain responsible for paying any GST/HST owing by the due date.",
    "Your fee is the amount in your quote. Our billing terms and how to pay are in Appendix A, Fees and payment. Appendix A forms part of this letter.",
    "This letter covers only the services described above. Other work is not included, for example review or audit engagements; tax planning beyond how you pay yourself, and reorganizations; CRA audits, objections and disputes; personal tax returns; and legal, valuation and investment advice. We will agree any other work with you in writing, in a Change Order, before we start.",
    "Please sign this letter below to confirm that it reflects your understanding. We will start work once we receive the signed letter and the first invoice is paid.",
    "You agree that signing this letter electronically has the same effect as signing it by hand.",
    "Concept Accounting & Advisory Professional Corporation", "Hashim Abouelfetouh, CPA\nDirector",
    "Year-end financial statements and corporate tax return / $3,699 plus GST/HST / ",
    "$1,849.50 plus GST/HST when you sign up in the portal|$1,849.50 plus GST/HST when your statements and tax return are ready for your approval",
  ]);
  // The page version has the same changes, and no signature block or address.
  const html = corpPartB({}, CORP_SAMPLE);
  const ht = text(html);
  assert.ok(html.includes("Your fee is the amount in your quote.") && html.includes("signing this letter electronically") && !html.includes('class="sig"'));
  assert.ok(ht.includes("$1,849.50 plus GST/HST when you sign up in the portal") && ht.includes("ready for your approval"), "Appendix A bills half and half");
  assert.ok(!/plus HST|plus GST\b(?!\/)/.test(ht), "never plus HST");
  assert.ok(!ht.includes("TaxDome") && ht.includes("Please sign this letter below") && ht.includes("tax planning beyond how you pay yourself"));
  assert.ok(ht.includes("annual GST/HST return for the year") && !ht.includes("filing frequency"));
  // Without GST-110 there is no GST/HST section at all.
  assert.ok(!text(corpPartB({}, { ...CORP_SAMPLE, extras: { gst: false, slips: true } })).includes("GST/HST return for the year"));
});

test("Part A: the bookkeeping line lists the accounts from the form", () => {
  assert.equal(accountsList({ bank: 2, cc: 1, loc: 0, loan: 0, car: 1 }), "2 bank accounts, 1 credit card, 1 car loan or lease");
  assert.equal(accountsList({ bank: 1, cc: 2, loc: 2, loan: 1, car: 2 }), "1 bank account, 2 credit cards, 2 lines of credit, 1 bank loan, 2 car loans or leases");
  assert.ok(text(corpPartA({}, CORP_SAMPLE)).includes("Bookkeeping for the year from your bank and credit card statements: 2 bank accounts, 1 credit card, 1 line of credit, 1 car loan or lease"));
  // A quote made before the counts were kept still reads as Appendix C.
  assert.ok(text(corpPartA({}, { ...CORP_SAMPLE, counts: undefined })).includes("Bookkeeping for the year from your bank and credit card statements"));
});

test("deposit and balance: half and half, to the cent", () => {
  assert.deepEqual(depositAndBalance(369900), { deposit: 184950, balance: 184950 });
  assert.deepEqual(depositAndBalance(369901), { deposit: 184951, balance: 184950 });
});
