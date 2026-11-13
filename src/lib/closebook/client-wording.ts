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
export const CB_PIECES: QPiece[] = Object.values(CB_CLIENT);
export const CB_TEMPLATES = [
  { k: "cbclientlist", name: "Closebook client entry list", group: "Closebook", basis: "Hashim, Nov 15, 2026: the client's copy of the entries, for clients who keep their own books", status: "Trial" },
];
// The live text of a piece: the current approved version's change, else the original.
export const cbText = (texts: Record<string, string>, p: QPiece) => texts[p.key] ?? p.text;
