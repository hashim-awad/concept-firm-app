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

// Round 35b: the status is the question's (closed by posting, in the database), not the line's.
test("statuses: from the questions; a posted line keeps an open question; excluded is Closed", () => {
  assert.equal(qStatusOf(line({})), null);
  assert.equal(qStatusOf(line({ q_status: "not_sent" })), "not_sent");
  assert.equal(qStatusOf(line({ q_status: "waiting" })), "waiting");
  assert.equal(qStatusOf(line({ q_status: "answered" })), "answered");
  assert.equal(qStatusOf(line({ q_status: "answered", status: "done", chart_account: "63000" })), "answered", "asked on a posted line");
  assert.equal(qStatusOf(line({ q_status: "closed", status: "done", chart_account: "63000" })), "closed", "closed when posted");
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
  const m = questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "Pat", legalName: "Dummy Studio Inc.", count: 3 });
  assert.equal(m.subject, "Questions about your business transactions");
  assert.match(m.message, /^Hi Pat,/);
  assert.match(m.message, /We are working on the year-end for Dummy Studio Inc\. We have 3 questions about transactions on your bank and card statements\./);
  // Round 33: the reply-by sentence is not in the editable text; the email adds it from the stored date.
  assert.doesNotMatch(m.message, /Please answer/);
  assert.match(questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "", legalName: "X", count: 1 }).message, /1 question about/);
  const e = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, m, { name: "Dana Dummy", credentials: "CPA", title: "Senior Accountant" }, "https://example.test/cq/abc", "2026-11-25");
  assert.match(e.html, /Please answer them by November 25, 2026\. You can attach a receipt or invoice to any answer\./);
  assert.match(e.html, /<a href="https:\/\/example\.test\/cq\/abc" style="[^"]*font-weight: bold; text-decoration: underline;">View transaction questions<\/a>/);
  assert.match(e.html, /<b>Dana Dummy<\/b>, CPA<br>Senior Accountant \| Concept Accounting &amp; Advisory Professional Corporation/);
  // Never on a client document: chart numbers, GIFI, "Closebook", em dashes.
  for (const bad of [/Closebook/i, /GIFI/, /—/]) assert.doesNotMatch(e.html + e.text, bad);
  // Edited for this email only: the window's text is what goes out.
  const edited = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, { subject: "Two quick questions", message: "Hi Pat,\n\nJust two." }, { name: "Dana Dummy", credentials: "", title: "" }, "https://example.test/cq/x", "2026-12-01");
  assert.match(edited.html, /Please answer them by December 1, 2026\./);
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

// Round 32 fix (Hashim, Nov 17, 2026): a link ends only at 30 days, at the next good send, or when the file is locked.
// The reply-by date is not even an input. Checked at 11:30 AM and 9 PM Eastern on the day it was sent, reply by that day.
import { linkRefusal } from "../src/lib/closebook/questions.ts";
test("the link: the reply-by date and the time of day play no part", () => {
  const sentAt = new Date("2026-11-17T16:27:00Z");                      // 11:27 AM Eastern
  const link = { active: true, sent: true, expires_at: new Date(sentAt.getTime() + 30 * 86_400_000).toISOString(), reply_by: "2026-11-17" };
  for (const now of ["2026-11-17T16:30:00Z", "2026-11-18T02:00:00Z", "2026-11-25T12:00:00Z", "2026-12-17T16:26:00Z"]) assert.equal(linkRefusal(link, "open", new Date(now)), null, now);
  assert.equal(linkRefusal(link, "open", new Date("2026-12-17T16:27:00Z")), "expired");
  assert.equal(linkRefusal({ ...link, active: false }, "open", new Date("2026-11-17T16:30:00Z")), "replaced");
  assert.equal(linkRefusal({ ...link, sent: false, active: false }, "open", new Date("2026-11-17T16:30:00Z")), "not_sent");
  assert.equal(linkRefusal(link, "locked", new Date("2026-11-17T16:30:00Z")), "locked");
});

// Firm decision (Nov 17, 2026): each opening of the link goes in History with the device.
import { deviceOf } from "../src/lib/closebook/questions.ts";
test("the device on each opening: phone, tablet, computer, or an automatic link check", () => {
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), "phone");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"), "phone");
  assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0"), "computer");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36"), "automatic link check");
  assert.equal(deviceOf(""), "automatic link check");
});

// Round 33 (Hashim, Nov 17, 2026): internal notes never reach the client page.
import { clientLineVisible, clientThread, answerByText } from "../src/lib/closebook/questions.ts";
test("the client page: only sent questions, only open lines that are Waiting or Answered", () => {
  const entries = [
    { kind: "q" as const, sent_at: "2026-11-17T16:00:00Z", body: "What was this for?" },
    { kind: "q" as const, sent_at: null, body: "Applied by CRA to HST period ... (an internal note typed as a question)" },
    { kind: "a" as const, sent_at: null, body: "A client meeting." },
  ];
  const t = clientThread(entries);
  assert.deepEqual(t.map((e) => e.body), ["What was this for?", "A client meeting."]);
  const open = { status: "new", chart_account: null, is_split: false, transfer_account: null };
  assert.equal(clientLineVisible({ ...open, q_status: "waiting" }, t), true);
  assert.equal(clientLineVisible({ ...open, q_status: "answered" }, t), true);
  assert.equal(clientLineVisible({ ...open, q_status: "not_sent" }, t), false, "a question not sent yet");
  // Round 35b: a question asked on a posted line shows; one closed by posting never does.
  assert.equal(clientLineVisible({ ...open, status: "done", chart_account: "63000", q_status: "waiting" }, t), true, "asked on a posted line");
  assert.equal(clientLineVisible({ ...open, status: "done", chart_account: "63000", q_status: "closed" }, t), false, "closed by posting");
  assert.deepEqual(clientThread([{ ...entries[0], closed_at: "2026-11-17T17:00:00Z" }]).length, 0, "a closed question never shows");
  assert.equal(clientLineVisible({ ...open, status: "excluded", q_status: "answered" }, t), false, "excluded");
  assert.equal(clientLineVisible({ ...open, q_status: "waiting" }, clientThread([entries[1]])), false, "no sent question");
});
test("one reply-by date: the sentence comes from the stored date", () => {
  assert.equal(answerByText({}, CB_QUESTIONS_EMAIL, "2026-11-24"), "Please answer them by November 24, 2026. You can attach a receipt or invoice to any answer.");
});
