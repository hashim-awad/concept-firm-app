// Round 36 (Hashim, Nov 17, 2026): Excel header and footer "&", Notify client errors in plain words, and the email
// for one question. Dummy data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { hfText } from "../src/lib/closebook/xlsx-hf.ts";
import { reportXlsx } from "../src/lib/closebook/xlsx-write.ts";
import { questionsXlsx, questionsMessage, renderQuestionsEmail, answerByText } from "../src/lib/closebook/questions.ts";
import { CB_QUESTIONS_EMAIL } from "../src/lib/closebook/client-wording.ts";
import { notSentText, graphCode } from "../src/lib/email/not-sent.ts";

const FIRM = "Concept Accounting & Advisory Professional Corporation";
const sheetOf = async (b: Buffer) => (await JSZip.loadAsync(b)).file("xl/worksheets/sheet1.xml")!.async("string");

test("Excel headers and footers: every & is written as &&", async () => {
  assert.equal(hfText("A & B && C"), "A && B &&&& C");
  const q = await sheetOf(questionsXlsx({ legalName: "Dummy Inc.", yearEnd: "2026-08-31", preparedOn: "2026-11-18", firm: FIRM },
    [{ n: 1, date: "2026-03-19", account: "RBC Chq ••• 7509", description: "CAFE DUMMY", out: true, cents: -4512, question: "What was this for?" }]));
  assert.match(q, /<oddFooter>&amp;LConcept Accounting &amp;&amp; Advisory Professional Corporation&amp;RPage &amp;P of &amp;N<\/oddFooter>/);
  const r = await sheetOf(reportXlsx({ title: "Test", columns: ["Account", "Amount"], numeric: [false, true], rows: [{ cells: ["Dummy", 100] }] }, [], "WORKING PAPER · Smith & Co Dummy"));
  assert.match(r, /<oddHeader>&amp;C&amp;"Arial,Bold"&amp;KB3261EWORKING PAPER · Smith &amp;&amp; Co Dummy<\/oddHeader>/);
  // The cells themselves are not header text: one & there.
  assert.match(r, /<t xml:space="preserve">WORKING PAPER · Smith &amp; Co Dummy<\/t>/);
});

test("Notify client: plain words, never Microsoft's text", () => {
  assert.equal(notSentText({ status: 403, code: "ErrorAccessDenied" }, "dana.dummy@example.test"),
    "Not sent. Microsoft 365 has not allowed Studio to send from dana.dummy@example.test yet. Nothing went to the client.");
  assert.equal(notSentText({ status: 401, code: "ErrorAccessDenied" }, "x@example.test").startsWith("Not sent. Microsoft 365 has not allowed"), true);
  assert.equal(notSentText({ status: 400, code: "ErrorInvalidRecipients" }, "x@example.test"), "Not sent. Microsoft 365 refused the email (ErrorInvalidRecipients). Nothing went to the client.");
  assert.equal(notSentText({ status: 503 }, "x@example.test"), "Not sent. Microsoft 365 refused the email (503). Nothing went to the client.");
  assert.equal(notSentText(null, "x@example.test"), "Not sent. Microsoft 365 refused the email (no reply). Nothing went to the client.");
  assert.equal(graphCode('{"error":{"code":"ErrorAccessDenied","message":"Access is denied."}}'), "ErrorAccessDenied");
  assert.equal(graphCode("<html>Bad gateway</html>"), "");
});

test("one question: its own two sentences; two or more: today's wording", () => {
  const one = questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "Pat", legalName: "Sample Company Inc.", count: 1 });
  assert.equal(one.message, "Hi Pat,\n\nWe are working on the year-end for Sample Company Inc. We have 1 question about a transaction on your bank and card statements.");
  assert.equal(answerByText({}, CB_QUESTIONS_EMAIL, "2026-12-04", 1), "Please answer it by December 4, 2026. You can attach a receipt or invoice to your answer.");
  const e1 = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, one, { name: "Dana Dummy", credentials: "CPA", title: "" }, "https://example.test/cq/x", "2026-12-04", 1);
  assert.match(e1.text, /Please answer it by December 4, 2026\. You can attach a receipt or invoice to your answer\./);
  const three = questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "Pat", legalName: "Sample Company Inc.", count: 3 });
  assert.equal(three.message, "Hi Pat,\n\nWe are working on the year-end for Sample Company Inc. We have 3 questions about transactions on your bank and card statements.");
  const e3 = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, three, { name: "Dana Dummy", credentials: "CPA", title: "" }, "https://example.test/cq/x", "2026-12-04", 3);
  assert.match(e3.text, /Please answer them by December 4, 2026\. You can attach a receipt or invoice to any answer\./);
  // An approved change in Templates is used for the one-question piece too.
  const texts = { [CB_QUESTIONS_EMAIL.answerBy1.key]: "Please reply by {1}." };
  assert.equal(answerByText(texts, CB_QUESTIONS_EMAIL, "2026-12-04", 1), "Please reply by December 4, 2026.");
});
