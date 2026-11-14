// The client entry list's own words (Hashim, Nov 15, 2026), as editable wording pieces on the Templates
// page: plain words, grade 7, no em dashes. The template starts as a Trial: it shows "needs your OK" until
// an owner approves it there. Fixed ids: never reuse or renumber one (saved edits are stored by key).
import type { QPiece } from "../t1-quote/wording.ts";

const key = (id: number) => `wb1${id.toString(16).padStart(8, "0")}`;
const P = (id: number, text: string): QPiece => ({ key: key(id), text, fills: [], fns: ["cbclientlist"] });

export const CB_CLIENT = {
  newAccountsIntro: P(1, "Create these accounts in your books first. The entries that follow use them."),
  tbNote: P(2, "How to read this page. Debits are plain numbers. Credits are in brackets. A dash means zero. Prelim is the balance in your books before our entries. Adjust and Reclass are our entries, listed on the pages that follow. Final is the balance after our entries. Prior is last year's final balance. $ change is Final less Prior. % change compares the size of each balance with last year. n/a means there was no balance last year. n/m means the balance moved to the other side, so a percentage would not mean anything."),
};
// The completion checklist on step 6 (round 8, Hashim, Nov 24, 2026): CSRS 4200 compilation engagements
// only, never a review or an audit. A draft for Hashim's approval on the Templates page. The keys match
// cb_checklist_questions in the database, where the answers are kept; never reuse or renumber one.
const ckey = (id: number) => `wb2${id.toString(16).padStart(8, "0")}`;
const Q = (id: number, text: string): QPiece => ({ key: ckey(id), text, fills: [], fns: ["cbchecklist"] });
export const CB_CHECKLIST: QPiece[] = [
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
export const CB_PIECES: QPiece[] = [...Object.values(CB_CLIENT), ...CB_CHECKLIST];
export const CB_TEMPLATES = [
  { k: "cbclientlist", name: "Closebook client entry list", group: "Closebook", basis: "Hashim, Nov 15, 2026: the client's copy of the entries, for clients who keep their own books", status: "Trial" },
  { k: "cbchecklist", name: "Closebook completion checklist", group: "Closebook", basis: "Hashim, Nov 24, 2026: the CSRS 4200 completion questions answered on step 6 before the reviewer signs. Compilation engagements only", status: "Trial" },
];
// The live text of a piece: the current approved version's change, else the original.
export const cbText = (texts: Record<string, string>, p: QPiece) => texts[p.key] ?? p.text;
