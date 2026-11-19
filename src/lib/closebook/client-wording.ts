// The client entry list's own words (Hashim, Nov 15, 2026), as editable wording pieces on the Templates
// page: plain words, grade 7, no em dashes. The template starts as a Trial: it shows "needs your OK" until
// an Admin approves it there. Fixed ids: never reuse or renumber one (saved edits are stored by key).
import type { QPiece } from "../t1-quote/wording.ts";

const key = (id: number) => `wb1${id.toString(16).padStart(8, "0")}`;
const P = (id: number, text: string): QPiece => ({ key: key(id), text, fills: [], fns: ["cbclientlist"] });

export const CB_CLIENT = {
  newAccountsIntro: P(1, "Create these accounts in your books first. The entries that follow use them."),
  tbNote: P(2, "How to read this page. Debits are plain numbers. Credits are in brackets. A dash means zero. Prelim is the balance in your books before our entries. Adjust and Reclass are our entries, listed on the pages that follow. Final is the balance after our entries. Prior is last year's final balance. $ change is Final less Prior. % change compares the size of each balance with last year. n/a means there was no balance last year. n/m means the balance moved to the other side, so a percentage would not mean anything."),
};
// The completion checklist on step 10 (round 8, Hashim, Nov 24, 2026; moved from step 6 in round 8b): CSRS 4200 compilation engagements
// only, never a review or an audit. A draft for Hashim's approval on the Templates page. The keys match
// cb_checklist_questions in the database, where the answers are kept; never reuse or renumber one.
const ckey = (id: number) => `wb2${id.toString(16).padStart(8, "0")}`;
const Q = (id: number, text: string): QPiece => ({ key: ckey(id), text, fills: [], fns: ["cbchecklist"] });
// Round 16 (Hashim, Nov 15, 2026): the 13 questions, a new draft for approval in Templates. New keys
// (13 to 25): the first 12 stay with the files answered on them.
export const CB_CHECKLIST: QPiece[] = [
  Q(13, "A signed engagement letter is on file, and it covers this year-end."),
  Q(14, "We understand the business and its operations, how it keeps its books and records, and the basis of accounting."),
  Q(15, "Management chose the basis of accounting, and its acknowledgment is on file (written, or a note of what they told us)."),
  Q(16, "The basis of accounting note describes the basis in plain words, lists the accruals we used, and matches how the statements were prepared. It uses no vague terms such as \"substantially ASPE\"."),
  Q(17, "We discussed the significant judgments in the statements with management, and their answers are in the file."),
  Q(18, "Management approved all our adjusting entries and reclassifications in the signed acknowledgement letter."),
  Q(19, "We read the statements as a whole. Nothing in them is false or misleading."),
  Q(20, "If anything made the statements false or misleading, management corrected it. If they would not, we did not issue the report."),
  Q(21, "If we are not independent of the client, the compilation report includes a statement saying so."),
  Q(22, "Management acknowledged in writing its responsibility for the final statements."),
  Q(23, "The compilation report is dated no earlier than the day management signed the acknowledgement."),
  Q(24, "The compilation report uses the firm's standard CSRS 4200 wording, unchanged."),
  Q(25, "The file holds the working papers that support the work: the trial balance, our entries, the supporting papers and the sign-offs."),
];
// The rules on the 13 (round 16), the database's too: which must be Yes, which may be Not applicable,
// which Closebook fills from the signing record and the locked template.
export const CHECKLIST_RULES = {
  v2: { mustYes: [1, 2, 3, 4, 6, 7, 10, 11, 12, 13], mayNa: [8, 9], auto: [6, 10, 11, 12] },
  v1: { mustYes: [1, 10, 11], mayNa: [8, 9], auto: [10, 11] },
};
// The first 12 questions (round 8): kept for files answered on them; no longer in Templates.
export const CB_CHECKLIST_V1: QPiece[] = [
  Q(1, "The engagement letter for this compilation is signed and on file, and it covers this year-end."),
  Q(2, "We know enough about the business, its industry and its records to compile these statements."),
  Q(3, "Management chose the basis of accounting, and it suits the people who will use the statements."),
  Q(4, "The note on the basis of accounting describes it in plain words and matches how the statements were prepared."),
  Q(5, "We asked management about anything that looked wrong, missing or unusual, and every answer is in the file."),
  Q(6, "Every entry we made is in the file, and management has agreed to each one."),
  Q(7, "We read the statements as a whole. They are not false or misleading."),
  Q(8, "If anything made the statements false or misleading, management fixed it. If they would not, we did not issue the report."),
  Q(9, "If we are not independent of the client, the compilation report says so and gives the reasons."),
  Q(10, "Management signed the management acknowledgement letter for these statements."),
  Q(11, "The compilation report is dated on or after the day management signed the acknowledgement and approved the statements."),
  Q(12, "The file holds the working papers for the work: the trial balance, the entries, the schedules and the sign-offs."),
];
// Round 32 (Hashim, Nov 18, 2026): the email that sends the client questions (Templates, "Closebook · Client questions
// email"; an Admin approves it as other templates). {1}, {2}: the fills named beside each piece. Fixed ids.
const qkey = (id: number) => `wb3${id.toString(16).padStart(8, "0")}`;
const E = (id: number, text: string): QPiece => ({ key: qkey(id), text, fills: [], fns: ["cbquestionsemail"] });
export const CB_QUESTIONS_EMAIL = {
  subject: E(1, "Questions about your business transactions"),
  hi: E(2, "Hi {1},"),                                                       // {1}: the contact's first name
  working: E(3, "We are working on the year-end for {1}. We have {2} about transactions on your bank and card statements."),   // {1}: legal name; {2}: "8 questions"
  answerBy: E(4, "Please answer them by {1}. You can attach a receipt or invoice to any answer."),                              // {1}: the reply-by date
  link: E(5, "View transaction questions"),
  firm: E(6, "Concept Accounting & Advisory Professional Corporation"),
  // Round 36 (Hashim, Nov 17, 2026): the same two sentences when there is only one question.
  working1: E(7, "We are working on the year-end for {1}. We have 1 question about a transaction on your bank and card statements."),   // {1}: legal name
  answerBy1: E(8, "Please answer it by {1}. You can attach a receipt or invoice to your answer."),                                         // {1}: the reply-by date
};
export const CB_PIECES: QPiece[] = [...Object.values(CB_CLIENT), ...CB_CHECKLIST, ...Object.values(CB_QUESTIONS_EMAIL)];
export const CB_TEMPLATES = [
  { k: "cbclientlist", name: "Closebook client entry list", group: "Closebook", basis: "Hashim, Nov 15, 2026: the client's copy of the entries, for clients who keep their own books", status: "Trial" },
  { k: "cbquestionsemail", name: "Closebook · Client questions email", group: "Closebook", basis: "Hashim, Nov 18, 2026 (round 32): the email that sends the client their transaction questions, with the link to answer them online", status: "Trial" },
  { k: "cbchecklist", name: "Closebook completion checklist", group: "Closebook", basis: "Hashim, Nov 24, 2026: the CSRS 4200 completion questions answered on step 10, before the file is locked and the compilation report is released. Compilation engagements only", status: "Trial" },
];
// The live text of a piece: the current approved version's change, else the original.
export const cbText = (texts: Record<string, string>, p: QPiece) => texts[p.key] ?? p.text;
