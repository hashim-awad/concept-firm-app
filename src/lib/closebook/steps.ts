// The Closebook file page's 10 steps (Hashim, Nov 13, 2026, and Nov 14: Opening balances became step 2;
// BRIEF.md "Closebook file page"; mockup https://claude.ai/artifact/XkgKhoP3v9jG395A5Meqho). One path down the left; the page opens on
// the current step with one "next job" line. Pure, so the page, the file list and tests share the rules.
// Sign-offs per step arrive with build step 3: until then a step is "done" only where the data says so.
import type { CbDoc } from "./files.ts";

// Round 15b (Hashim): GIFI mapping comes before Review, because Review's sign-off already needs mapping
// signed. Only the order and the names changed; every rule is the same.
export const STEP_KEYS = ["setup", "opening", "records", "code", "entries", "mapping", "review", "t2", "statements", "lock"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type StepState = "done" | "current" | "open";
// word: the step's status in Studio's fixed words (round 8): Signed (reviewed), Prepared (signed by the
// preparer only), Next (the current step), Open. notes: review notes not yet cleared on the step.
export type StepWord = "signed" | "prepared" | "next" | "open";
export type Step = { key: StepKey; n: number; name: string; who: string; note: string; state: StepState; word: StepWord; notes: number };
export type StepSign = { prepared: boolean; reviewed: boolean; notes: number };
// The steps with sign-offs today (round 8); 8 to 10 get theirs when they are built.
export const SIGNED_STEPS: StepKey[] = [...STEP_KEYS];

// Files built from bank and card CSVs code transactions to the standard chart; every other file
// imports a trial balance and matches its accounts straight to GIFI lines (Hashim, Nov 13, 2026).
export const fromStatements = (books: string) => books === "statements" || books === "paper";

export type StepFacts = {
  books: string;
  docs: CbDoc[];
  statements: number;          // bank and card statements uploaded
  imported: boolean;           // a trial balance imported into this year's column
  accounts: number;
  unmatched: number;           // accounts with no GIFI line
  waiting: number;             // accounts waiting for the reviewer's decision
  typeFlags?: number;          // accounts whose type differs from their GIFI line's (round 5) or whose balance is on the wrong side of it (round 10), not yet decided
  entries: number;
  bankGaps?: string;           // bank files: how many months are still missing ("4 months missing"; "" when complete)
  coding?: { lines: number; open: number; reviewer: number; ask: number };   // bank files: step 3
  opening?: { signed: boolean; entered: boolean; firstYear?: boolean };   // bank files: step 2, last year's balance sheet (round 16: or a first year)
  people: { preparer: string; reviewer: string };
  // Round 8: each step's sign-offs and open review notes. With them, a step is done when reviewed.
  signs?: Partial<Record<StepKey, StepSign>>;
  setupOpen?: number;          // setup questions still to answer
};

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A step's number and name as the file shows it (round 8b item 11): steps 3 and 4 are named by how the
// books are kept. The Review notes page lists each note under its own file's step names.
export function stepTitle(key: string, books: string): string {
  const bank = fromStatements(books);
  const names: Record<string, [number, string]> = { setup: [1, "Set up"], opening: [2, "Opening balances"],
    records: [3, bank ? "Banking" : "Get the records"], code: [4, bank ? "Code transactions" : "Match accounts to GIFI"],
    entries: [5, "Adjustments"], mapping: [6, "GIFI mapping"], review: [7, "Review"], t2: [8, "Tax returns"], statements: [9, "Statements"], lock: [10, "Deliver and lock"] };
  const n = names[key];
  return n ? `${n[0]}. ${n[1]}` : key;
}

export function fileSteps(f: StepFacts): { steps: Step[]; current: StepKey; next: string } {
  const bank = fromStatements(f.books);
  const planning = f.docs.filter((d) => d.phase === "planning");
  const setupDone = planning.length > 0 && planning.every((d) => d.status === "signed");
  const records = bank ? f.statements > 0 && !f.bankGaps : f.imported;
  const op = f.opening ?? { signed: false, entered: false };
  // Imported trial balances bring last year's column with them; bank files sign step 2 off.
  const openingDone = bank ? op.signed : f.imported;
  const cd = f.coding ?? { lines: 0, open: 0, reviewer: 0, ask: 0 };
  const matched = bank ? cd.lines > 0 && cd.open + cd.reviewer + cd.ask === 0 : f.imported && f.accounts > 0 && f.unmatched === 0 && f.waiting === 0 && !f.typeFlags;

  const base: Omit<Step, "state" | "word" | "notes">[] = [
    { key: "setup", n: 1, name: "Set up", who: f.people.preparer,
      note: f.setupOpen !== undefined ? (f.setupOpen ? `${s(f.setupOpen, "question")} to answer` : "Questions answered") : setupDone ? "Done" : `${s(planning.filter((d) => d.status !== "signed").length, "item")} open` },
    { key: "opening", n: 2, name: "Opening balances", who: f.people.preparer,
      // Round 8b: the step's sign-off is its Prepared by; the sub-line only says what the step is.
      note: op.firstYear ? "First year: no opening balances" : bank ? "Last year's balance sheet" : "From the trial balance import" },
    // Round 23 (Hashim): step 3 on a bank file is "Banking", with sub-steps 3.1 to 3.3.
    { key: "records", n: 3, name: bank ? "Banking" : "Get the records", who: f.people.preparer,
      note: bank ? (!f.statements ? "Upload the statements" : f.bankGaps ? "Months still missing" : "All in") : f.imported ? "Trial balance imported" : "Import the trial balance" },
    { key: "code", n: 4, name: bank ? "Code transactions" : "Match accounts to GIFI", who: f.people.preparer,
      note: bank ? (!cd.lines ? "" : cd.open ? `${cd.open} to code` : cd.reviewer ? `${cd.reviewer} for the reviewer` : cd.ask ? `${cd.ask} for the client` : "All coded") : !f.imported ? "" : f.unmatched + f.waiting ? `${f.unmatched + f.waiting} to match` : f.typeFlags ? `${s(f.typeFlags, "check")} for the reviewer` : "All matched" },
    { key: "entries", n: 5, name: "Adjustments", who: f.people.preparer, note: "" },
    { key: "mapping", n: 6, name: "GIFI mapping", who: f.people.reviewer,
      note: f.typeFlags ? `${s(f.typeFlags, "check")} for the reviewer` : bank ? "Reviewer" : "Reviewer checks the matches" },
    { key: "review", n: 7, name: "Review", who: f.people.reviewer, note: `Reviewer: ${f.people.reviewer}` },
    { key: "t2", n: 8, name: "Tax returns", who: f.people.preparer, note: "GIFI to ProFile" },
    { key: "statements", n: 9, name: "Statements", who: f.people.preparer, note: "" },
    { key: "lock", n: 10, name: "Deliver and lock", who: f.people.preparer, note: "" },
  ];
  // What the data can show today. Uploads and coding may start before step 1 is signed.
  const done: Record<StepKey, boolean> = { setup: setupDone, opening: openingDone, records, code: matched, entries: false, review: false, mapping: false, t2: false, statements: false, lock: false };
  let current: StepKey = !records && !setupDone && f.statements === 0 && !f.imported ? "setup"
    : (STEP_KEYS.slice(1).find((k) => !done[k]) ?? "lock");
  const sg = f.signs;
  if (sg) {
    // Round 8 (CaseWare): a step is done when the reviewer has signed it. The current step is the first
    // the preparer has not signed; once steps 1 to 6 are prepared, it is step 7, the review.
    for (const k of SIGNED_STEPS) done[k] = !!sg[k]?.reviewed;
    const work: StepKey[] = ["setup", "opening", "records", "code", "entries", "mapping"];
    current = work.find((k) => !sg[k]?.prepared) ?? (!sg.review?.reviewed ? "review" : !sg.t2?.prepared ? "t2" : !sg.statements?.reviewed ? "statements" : "lock");
  }
  const word = (k: StepKey): StepWord => (sg?.[k]?.reviewed ? "signed" : sg?.[k]?.prepared ? "prepared" : k === current ? "next" : "open");
  const steps = base.map((b) => ({ ...b, state: (b.key === current ? "current" : done[b.key] ? "done" : "open") as StepState,
    word: sg ? word(b.key) : ((done[b.key] ? "signed" : b.key === current ? "next" : "open") as StepWord), notes: sg?.[b.key]?.notes ?? 0 }));

  const next: Record<StepKey, string> = {
    setup: "Answer the setup questions.",
    opening: op.firstYear ? "First year: sign step 2; the reviewer confirms it." : !bank ? "Import this year's trial balance; last year's column comes with it." : op.entered
      ? "Check last year's balance sheet: sign as preparer when no total is highlighted."
      : "Enter last year's closing balance sheet from the prior T2 or the CRA assessment. Sign off when no total is highlighted.",
    records: !bank ? "Import the client's trial balance, and the QuickBooks Account List if they use QuickBooks." : f.statements && f.bankGaps ? `${f.bankGaps}: they show on each account below. You can start coding the lines already in.`
      : "Upload the bank and card statements in Concept's template: one month or the whole year per file.",
    code: bank ? (cd.open ? `Post ${s(cd.open, "pending line")}: each needs an account and a sales tax code${cd.ask ? ` (${cd.ask} asked of the client)` : ""}.`
      : cd.reviewer ? `${s(cd.reviewer, "line")} waiting for the reviewer (${f.people.reviewer}).` : `${s(cd.ask, "line")} on the client's question list.`) : f.unmatched + f.waiting ? `Match ${s(f.unmatched + f.waiting, "account")} to GIFI lines.`
      : `${s(f.typeFlags ?? 0, "account")} on a GIFI line of another type, or with a balance on the wrong side of it: for the reviewer (${f.people.reviewer}).`,
    entries: "Finish the checks and post the year-end entries, then explain the flagged changes on the lead sheets.",
    review: `Review by ${f.people.reviewer}: work through the list below, answer the completion checklist, then sign step 7.`,
    mapping: f.typeFlags ? `Decide ${s(f.typeFlags, "account")} whose type or balance does not fit its GIFI line (keep it there with a reason, or move it), then sign off.`
      : "Check the GIFI line of every account, then sign off.",
    t2: "Export the GIFI file, import it into ProFile, then tie out the T2.",
    statements: "Send the management acknowledgement (MAL) for signature.",
    lock: "Send the package to the client and lock the file.",
  };
  return { steps, current, next: next[current] };
}

// Old links (?tab=...&view=...) still land on the right step: actions and bookmarks keep working.
export function stepFromLegacy(tab: string | undefined, view: string | undefined, books: string): StepKey | null {
  if (!tab) return null;
  if (tab === "documents") return "setup";
  if (tab === "entries") return "entries";
  if (tab === "notes") return "review";
  if (tab === "statements") return "statements";
  if (tab !== "tb") return null;
  if (view === "transactions") return "records";
  if (view === "gifi") return "t2";
  if (view === "lead") return "review";
  return fromStatements(books) ? "mapping" : "code";
}

// Round 15b (Hashim; CaseWare Cloud's document map): a step holds one or more working papers, each its
// own screen, listed under the step when it is open. A paper shows only when it applies. Sign-offs stay
// on the step.
export type PaperKey = "accounts" | "feeds" | "reconcile" | "questions" | "acceptance" | "revenue" | "sh" | "expenses" | "gifi" | "taxwp" | "tie" | "gst" | "package" | "mal" | "checklist" | "email" | "documents" | "filing";
export type Paper = { key: PaperKey; name: string };
// Piece 7: revenue false = no revenue check added on this file (step 5 offers "+ Add revenue check" instead).
export type PaperFacts = { full: boolean; shareholders: boolean; ownerPaid: boolean; gst: boolean; bank?: boolean; revenue?: boolean };
export function stepPapers(step: StepKey, f: PaperFacts): Paper[] {
  const p = (key: PaperKey, name: string, on = true): Paper[] => (on ? [{ key, name }] : []);
  switch (step) {
    // Round 16: the acceptance and continuance record (CSRS 4200) beside the setup questions.
    case "setup": return [...p("questions", "Setup questions"), ...p("acceptance", "Acceptance")];
    // Round 23: Banking's sub-steps, each with its own sign-offs (bank and card files).
    case "records": return [...p("accounts", "3.1 Bank accounts & T2 tie-out", !!f.bank), ...p("feeds", "3.2 Bank feeds", !!f.bank), ...p("reconcile", "3.3 Reconcile", !!f.bank)];
    // Piece 4b (Hashim, Nov 18, 2026): the "Expenses paid personally" paper is retired; the schedule is in the entry window.
    case "entries": return [...p("revenue", "Revenue check", f.full && f.revenue !== false), ...p("sh", "Shareholder loans", f.shareholders)];
    case "t2": return [...p("gifi", "GIFI file"), ...p("taxwp", "Tax workpaper"), ...p("tie", "T2 tie-out"), ...p("gst", "GST/HST return", f.gst)];
    case "statements": return [...p("package", "Package"), ...p("mal", "MAL signing")];
    case "lock": return [...p("checklist", "Checklist"), ...p("email", "Client email"), ...p("documents", "Documents"), ...p("filing", "Filing and lock")];
    default: return [];
  }
}

