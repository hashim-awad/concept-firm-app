// Round 32 (Hashim, Nov 18, 2026): questions to the client. The statuses, the email (template default), the client's
// Excel file read back, and what a client document must never show. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { CB_QUESTIONS_EMAIL } from "../src/lib/closebook/client-wording.ts";
import {
  accountForClient, accountShort, addDays, isOpen, maskEmail, qStatusOf, questionsMessage, questionsXlsx, renderQuestionsEmail, xlsxName, XLSX_COLUMNS,
} from "../src/lib/closebook/questions.ts";
import { FILTERS, inFilter, type FeedLine } from "../src/lib/closebook/bank-feed.ts";

function readZip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10), dirAt = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0, p = dirAt; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const dataAt = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const body = buf.subarray(dataAt, dataAt + size);
    out.set(name, (method === 8 ? inflateRawSync(body) : Buffer.from(body)).toString("utf8"));
    p += 46 + nlen;
  }
  return out;
}
const line = (o: Partial<{ q_status: string; status: string; chart_account: string | null; is_split: boolean; transfer_account: string | null }>) =>
  ({ q_status: "", status: "new", chart_account: null, is_split: false, transfer_account: null, ...o });

test("statuses: on the line until posted or excluded, then Closed", () => {
  assert.equal(qStatusOf(line({})), null);
  assert.equal(qStatusOf(line({ q_status: "not_sent" })), "not_sent");
  assert.equal(qStatusOf(line({ q_status: "waiting" })), "waiting");
  assert.equal(qStatusOf(line({ q_status: "answered" })), "answered");
  assert.equal(qStatusOf(line({ q_status: "answered", status: "done", chart_account: "63000" })), "closed");
  assert.equal(qStatusOf(line({ q_status: "waiting", status: "excluded" })), "closed");
  // A line sent to the reviewer without an account is still Pending, so its question stays open.
  assert.equal(qStatusOf(line({ q_status: "waiting", status: "reviewer" })), "waiting");
  assert.equal(isOpen("closed"), false);
  assert.equal(isOpen("answered"), true);
});

test("step 4's new filters: Asked, not sent; Waiting for client; Client answered", () => {
  const keys = FILTERS.map(([k]) => k as string);
  for (const k of ["q_not_sent", "q_waiting", "q_answered"]) assert.ok(keys.includes(k), k);
  assert.equal(FILTERS.find(([k]) => k === "q_not_sent")?.[1], "Asked, not sent");
  const l = { q_status: "waiting", cents: -500 } as unknown as FeedLine;
  assert.equal(inFilter("q_waiting", l, null, "bank"), true);
  assert.equal(inFilter("q_answered", l, null, "bank"), false);
});

test("the email: template default, the link bold and underlined, the sender's signature", () => {
  const m = questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "Pat", legalName: "Dummy Studio Inc.", count: 3, replyBy: "2026-11-25" });
  assert.equal(m.subject, "Questions about your business transactions");
  assert.match(m.message, /^Hi Pat,/);
  assert.match(m.message, /We are working on the year-end for Dummy Studio Inc\. We have 3 questions about transactions on your bank and card statements\./);
  assert.match(m.message, /Please answer them by November 25, 2026\. You can attach a receipt or invoice to any answer\./);
  assert.match(questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "", legalName: "X", count: 1, replyBy: "2026-11-25" }).message, /1 question about/);
  const e = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, m, { name: "Dana Dummy", credentials: "CPA", title: "Senior Accountant" }, "https://example.test/cq/abc");
  assert.match(e.html, /<a href="https:\/\/example\.test\/cq\/abc" style="[^"]*font-weight: bold; text-decoration: underline;">View transaction questions<\/a>/);
  assert.match(e.html, /<b>Dana Dummy<\/b>, CPA<br>Senior Accountant \| Concept Accounting &amp; Advisory Professional Corporation/);
  // Never on a client document: chart numbers, GIFI, "Closebook", em dashes.
  for (const bad of [/Closebook/i, /GIFI/, /—/]) assert.doesNotMatch(e.html + e.text, bad);
  // Edited for this email only: the window's text is what goes out.
  const edited = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, { subject: "Two quick questions", message: "Hi Pat,\n\nJust two." }, { name: "Dana Dummy", credentials: "", title: "" }, "https://example.test/cq/x");
  assert.equal(edited.subject, "Two quick questions");
  assert.match(edited.html, /Just two\./);
  assert.match(edited.html, /<b>Dana Dummy<\/b><br>Concept Accounting/);
});

test("the Excel file: name, sheet, rows 1 to 5, header on row 7, yellow answer column, frozen, filter, landscape, one page wide", () => {
  assert.equal(xlsxName("Dummy Studio Inc.", "2026-08-31"), "Dummy Studio Inc. - Questions - 2026-08-31.xlsx");
  const buf = questionsXlsx({ legalName: "Dummy Studio Inc.", yearEnd: "2026-08-31", preparedOn: "2026-11-18", firm: "Concept Accounting & Advisory Professional Corporation" }, [
    { n: 1, date: "2026-03-19", account: "RBC Chq ••• 7509", description: "CAFE DUMMY 1", out: true, cents: -4512, question: "What was this for?" },
    { n: 2, date: "2026-04-02", account: "Visa ••• 1111", description: "REFUND DUMMY", out: false, cents: 123456, question: "Please send the receipt." },
  ]);
  const z = readZip(buf);
  assert.match(z.get("xl/workbook.xml")!, /<sheet name="Questions"/);
  assert.match(z.get("xl/workbook.xml")!, /_xlnm\.Print_Titles[^>]*>Questions!\$7:\$7</);
  const s = z.get("xl/worksheets/sheet1.xml")!;
  assert.match(s, /<row r="1"><c r="A1"[^>]*><is><t[^>]*>Dummy Studio Inc\.<\/t>/);
  assert.match(s, /<c r="A2"[^>]*><is><t[^>]*>Questions about your bank and card transactions</);
  assert.match(s, /<c r="A3"[^>]*><is><t[^>]*>Year ended August 31, 2026</);
  assert.match(s, /<c r="A4"[^>]*><is><t[^>]*>Prepared by Concept Accounting &amp; Advisory Professional Corporation on Nov 18, 2026</);
  assert.match(s, /<c r="A5"[^>]*><is><t[^>]*>Please answer each question in the yellow column/);
  for (const [i, h] of XLSX_COLUMNS.entries()) assert.match(s, new RegExp(`<c r="${"ABCDEFGH"[i]}7" t="inlineStr" s="3"><is><t xml:space="preserve">${h}</t>`));
  assert.match(s, /<c r="A8" s="9"><v>1<\/v><\/c><c r="B8" s="8"><v>46100<\/v><\/c>/);   // # and the date as numbers (Mar 19, 2026)
  assert.match(s, /<c r="E8" s="5"><v>45\.12<\/v><\/c><c r="F8" s="5"\/>/);       // paid out
  assert.match(s, /<c r="E9" s="5"\/><c r="F9" s="5"><v>1234\.56<\/v><\/c>/);      // received
  assert.match(s, /<c r="H8" s="6"\/>/);                                           // the empty yellow answer cell
  assert.match(s, /<pane ySplit="7" topLeftCell="A8"[^>]*state="frozen"/);
  assert.match(s, /<autoFilter ref="A7:H9"\/>/);
  assert.match(s, /<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.match(s, /<col min="8" max="8" width="50"/);
  assert.doesNotMatch(s, /mergeCell/);
  const st = z.get("xl/styles.xml")!;
  assert.match(st, /FFF6CC/);
  assert.match(st, /#,##0\.00/);
  assert.match(st, /mmm d, yyyy/);
  assert.match(st, /<cellStyle name="Normal" xfId="0" builtinId="0"\/>/);
  for (const bad of [/Closebook/i, /GIFI/, /\b6\d{4}\b/]) assert.doesNotMatch(s, bad);
});

test("account names and the masked email on the client page", () => {
  assert.equal(accountForClient("RBC Royal Bank", "chequing", "bank", "7509"), "RBC Chequing ••• 7509");
  assert.equal(accountForClient(null, null, "card", "1111"), "Credit card ••• 1111");
  assert.equal(accountShort("RBC Royal Bank", "10000 Chequing", "7509", "chequing"), "RBC Chq ••• 7509");
  assert.equal(accountShort(null, "10000 Chequing · Dummy Chq ••• 7509", "7509", "chequing"), "Dummy Chq ••• 7509");
  assert.equal(maskEmail("hdummy@hotmail.com"), "h•••@hotmail.com");
  assert.equal(addDays("2026-11-18", 7), "2026-11-25");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
});
