// The Closebook file page's 9 steps (Hashim, Nov 13, 2026; BRIEF.md "Closebook file page, 9 steps";
// mockup https://claude.ai/artifact/XkgKhoP3v9jG395A5Meqho). One path down the left; the page opens on
// the current step with one "next job" line. Pure, so the page, the file list and tests share the rules.
// Sign-offs per step arrive with build step 3: until then a step is "done" only where the data says so.
import type { CbDoc } from "./files.ts";

export const STEP_KEYS = ["setup", "records", "code", "entries", "review", "mapping", "t2", "statements", "lock"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type StepState = "done" | "current" | "open";
export type Step = { key: StepKey; n: number; name: string; who: string; note: string; state: StepState };

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
  entries: number;
  bankGaps?: string;           // bank files: the months still missing, one sentence ("" when complete)
  coding?: { lines: number; open: number; reviewer: number; ask: number };   // bank files: step 3
  openingIssue?: string;       // bank files: why "Opening balances to enter" has not cleared ("" when it has)
  people: { preparer: string; reviewer: string };
};

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function fileSteps(f: StepFacts): { steps: Step[]; current: StepKey; next: string } {
  const bank = fromStatements(f.books);
  const planning = f.docs.filter((d) => d.phase === "planning");
  const setupDone = planning.length > 0 && planning.every((d) => d.status === "signed");
  const records = bank ? f.statements > 0 && !f.bankGaps && !f.openingIssue : f.imported;
  const cd = f.coding ?? { lines: 0, open: 0, reviewer: 0, ask: 0 };
  const matched = bank ? cd.lines > 0 && cd.open + cd.reviewer + cd.ask === 0 : f.imported && f.accounts > 0 && f.unmatched === 0 && f.waiting === 0;

  const base: Omit<Step, "state">[] = [
    { key: "setup", n: 1, name: "Set up the file", who: f.people.preparer, note: setupDone ? "Done" : `${s(planning.filter((d) => d.status !== "signed").length, "item")} open` },
    { key: "records", n: 2, name: "Get the records", who: f.people.preparer,
      note: bank ? (!f.statements ? "Upload the statements" : f.bankGaps ? "Months still missing" : f.openingIssue ? "Opening balances to settle" : "All in") : f.imported ? "Trial balance imported" : "Import the trial balance" },
    { key: "code", n: 3, name: bank ? "Code the transactions" : "Match accounts to GIFI", who: f.people.preparer,
      note: bank ? (!cd.lines ? "" : cd.open ? `${cd.open} to code` : cd.reviewer ? `${cd.reviewer} for the reviewer` : cd.ask ? `${cd.ask} for the client` : "All coded") : !f.imported ? "" : f.unmatched + f.waiting === 0 ? "All matched" : `${f.unmatched + f.waiting} to match` },
    { key: "entries", n: 4, name: "Adjusting entries", who: f.people.preparer, note: f.entries ? s(f.entries, "entry", "entries") : "" },
    { key: "review", n: 5, name: "Review", who: f.people.reviewer, note: `Reviewer: ${f.people.reviewer}` },
    { key: "mapping", n: 6, name: "GIFI mapping", who: f.people.reviewer, note: bank ? "Reviewer" : "Reviewer checks the matches" },
    { key: "t2", n: 7, name: "T2 tie-out", who: f.people.preparer, note: "GIFI to ProFile" },
    { key: "statements", n: 8, name: "Statements", who: f.people.preparer, note: "" },
    { key: "lock", n: 9, name: "Deliver and lock", who: f.people.preparer, note: "" },
  ];
  // What the data can show today. Uploads and coding may start before step 1 is signed.
  const done: Record<StepKey, boolean> = { setup: setupDone, records, code: matched, entries: false, review: false, mapping: false, t2: false, statements: false, lock: false };
  const current: StepKey = !records && !setupDone && f.statements === 0 && !f.imported ? "setup"
    : (STEP_KEYS.slice(1).find((k) => !done[k]) ?? "lock");
  const steps = base.map((b) => ({ ...b, state: (b.key === current ? "current" : done[b.key] ? "done" : "open") as StepState }));

  const next: Record<StepKey, string> = {
    setup: "Set up the file. You can start getting the records now: statements often come in before the letter is signed.",
    records: !bank ? "Import this year's trial balance." : f.statements && f.bankGaps ? `Still missing: ${f.bankGaps}. You can start coding the lines already in.`
      : f.statements && f.openingIssue ? `Opening balances: ${f.openingIssue}`
      : "Upload the bank and card statements in Concept's template: one month or the whole year per file.",
    code: bank ? (cd.open ? `Code ${s(cd.open, "line")} to accounts from the standard chart, with the sales tax.`
      : cd.reviewer ? `${s(cd.reviewer, "line")} waiting for the reviewer (${f.people.reviewer}).` : `${s(cd.ask, "line")} on the client's question list.`) : `Match ${s(f.unmatched + f.waiting, "account")} to GIFI lines.`,
    entries: "Post the year-end entries, then explain the flagged changes on the lead sheets.",
    review: `Review by ${f.people.reviewer}.`,
    mapping: "Check the GIFI line of every account, then sign off.",
    t2: "Download the GIFI file and import it into ProFile.",
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
