// Round 21 (Hashim, Nov 15, 2026): each step's progress in the step list, like ProFile's and TurboTax's
// side menus. Three states:
//   not_started  a grey number: nothing typed or loaded on the step yet
//   started      a blue ring around the number: work started, not signed by the preparer
//   signed       a green circle with a tick in place of the number: signed by the preparer
// The reviewer's sign-off stays in the second circle. Step 7 (Review) has no preparer: it is signed
// when the reviewer signs it. "Work started" comes only from data the file page already reads (answers
// saved, imports, coded lines, entries, typed figures); one pure rule, shared by the page and the tests.
import type { PaperKey, StepKey } from "./steps.ts";

export type Progress = "not_started" | "started" | "signed";

export type ProgressFacts = {
  bank: boolean;                 // built from bank and card statements (else a trial balance import)
  setupAnswers: number;          // setup questions answered (step 1)
  acceptance: boolean;           // an acceptance record saved (step 1)
  openingRows: number;           // last year's balance sheet lines typed (step 2)
  openingTyped: boolean;         // step 2's figures, source or "First year" saved on the file
  imported: boolean;             // a trial balance imported into this year's column (trial balance files)
  statements: number;            // bank and card statements uploaded (step 3)
  coded: number;                 // bank lines coded, sent to the reviewer or to the client (step 4)
  matched: number;               // trial balance accounts matched to GIFI by the preparer (step 4)
  entries: number;               // journal entries (step 5)
  revenueCheck: boolean;         // the revenue check explained or saved (step 5)
  shNotes: number;               // shareholder loan flags answered (step 5)
  expensesBooked: boolean;       // "Expenses paid personally" booked (step 5)
  mappingDecisions: number;      // GIFI decisions: lines set by the reviewer, types or sides kept with a reason (step 6)
  reviewNotes: number;           // review notes written on the file (step 7)
  reviewedSteps: number;         // steps the reviewer has signed (step 7)
  gifiExports: number;           // GIFI files exported (step 8)
  t2Tieout: boolean;             // T2 figures typed for the tie-out (step 8)
  gstReturn: boolean;            // a GST/HST return prepared (step 8)
  fsTyped: boolean;              // package fields saved (step 9)
  malSent: boolean;              // the MAL sent for signature (step 9)
  checklistAnswers: number;      // completion checklist answers (step 10)
  closeTyped: boolean;           // the filing record saved (step 10)
  signs: Partial<Record<StepKey, { prepared: boolean; reviewed: boolean }>>;
  banking?: Partial<Record<"accounts" | "feeds" | "reconcile", boolean>>;   // round 23: Banking's sub-steps signed by the preparer
  bankAccounts?: number;         // round 23: bank and card accounts added (3.1)
};

// Work started on a step, from its own data.
export function stepStarted(key: StepKey, f: ProgressFacts): boolean {
  switch (key) {
    case "setup": return f.setupAnswers > 0 || f.acceptance;
    // A trial balance file brings last year's column with its import.
    case "opening": return f.openingRows > 0 || f.openingTyped || (!f.bank && f.imported);
    case "records": return f.bank ? f.statements > 0 : f.imported;
    case "code": return f.bank ? f.coded > 0 : f.matched > 0;
    case "entries": return f.entries > 0 || f.revenueCheck || f.shNotes > 0 || f.expensesBooked;
    case "mapping": return f.mappingDecisions > 0;
    case "review": return f.reviewNotes > 0 || f.reviewedSteps > 0;
    case "t2": return f.gifiExports > 0 || f.t2Tieout || f.gstReturn;
    case "statements": return f.fsTyped || f.malSent;
    case "lock": return f.checklistAnswers > 0 || f.closeTyped;
  }
}

// Signed by the preparer (step 7: by the reviewer).
export const stepSigned = (key: StepKey, f: ProgressFacts) => (key === "review" ? !!f.signs.review?.reviewed : !!f.signs[key]?.prepared);

export function stepProgress(key: StepKey, f: ProgressFacts): Progress {
  if (stepSigned(key, f)) return "signed";
  return stepStarted(key, f) ? "started" : "not_started";
}

// A working paper under a step (Setup questions, Acceptance, ...): signed with its step; started from its
// own data. A paper whose work the page cannot see (a generated workpaper, an email) shows started only
// with its step's sign-off.
export function paperStarted(paper: PaperKey, f: ProgressFacts): boolean {
  switch (paper) {
    case "questions": return f.setupAnswers > 0;
    case "acceptance": return f.acceptance;
    case "revenue": return f.revenueCheck;
    case "sh": return f.shNotes > 0;
    case "expenses": return f.expensesBooked;
    case "gifi": return f.gifiExports > 0;
    case "tie": return f.t2Tieout;
    case "gst": return f.gstReturn;
    case "package": return f.fsTyped;
    case "mal": return f.malSent;
    case "checklist": return f.checklistAnswers > 0;
    case "filing": return f.closeTyped;
    default: return false;
  }
}

export function paperProgress(step: StepKey, paper: PaperKey, f: ProgressFacts): Progress {
  // Round 23: Banking's sub-steps carry their own sign-offs.
  if (paper === "accounts" || paper === "feeds" || paper === "reconcile") {
    if (f.banking?.[paper] || stepSigned(step, f)) return "signed";
    return (paper === "accounts" ? (f.bankAccounts ?? 0) > 0 : f.statements > 0) ? "started" : "not_started";
  }
  if (stepSigned(step, f)) return "signed";
  return paperStarted(paper, f) ? "started" : "not_started";
}

// "2 of 10 steps done": steps signed by the preparer (step 7 by the reviewer).
export function stepsDone(keys: readonly StepKey[], f: ProgressFacts): number {
  return keys.filter((k) => stepSigned(k, f)).length;
}

export const NO_PROGRESS: ProgressFacts = {
  bank: false, setupAnswers: 0, acceptance: false, openingRows: 0, openingTyped: false, imported: false, statements: 0, coded: 0, matched: 0,
  entries: 0, revenueCheck: false, shNotes: 0, expensesBooked: false, mappingDecisions: 0, reviewNotes: 0, reviewedSteps: 0,
  gifiExports: 0, t2Tieout: false, gstReturn: false, fsTyped: false, malSent: false, checklistAnswers: 0, closeTyped: false, signs: {},
};
