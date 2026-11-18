// Piece 8 (Hashim, Nov 18, 2026, version 5; benchmark CaseWare Cloud's continuity schedule read from the ledger):
// Reporting > Shareholder loans. One card per shareholder account, built from the postings the other reports use:
// the opening balance (step 2), what was paid to or for the shareholder and paid in by the shareholder (bank and card
// lines), each entry that credited or debited the account, on a file where the client keeps their own books the year's
// movement in the client's books (Hashim's answer, Nov 18, 2026), and the closing balance. Amounts owed to the
// shareholder are shown plain, amounts owed by the shareholder in brackets: the ledger's sign turned over (a credit is
// what the company owes the shareholder). A Summary comes first when there are two or more accounts.
import type { Posting } from "./tb-build.ts";
import { addYear, isShAccount } from "./sh-loans.ts";

export type ShEntryRef = { no: string; kind: string; wpRef: string };
export type ShReportEntry = { ref: string; no: string; kind: string; wpRef: string; cents: number };
export type ShCard = {
  key: string; number: string; name: string; holder: string; line_no: string;
  openingCents: number; paidToCents: number; paidInCents: number; booksCents: number | null;
  credited: ShReportEntry[]; creditedCents: number; debited: ShReportEntry[]; debitedCents: number;
  closingCents: number; movementCents: number; tbCents: number; tied: boolean;
  owedBy: boolean; dueOn: string | null;
};
export type ShReport = { cards: ShCard[]; total: { openingCents: number; movementCents: number; closingCents: number } };

type Acct = { key: string; number: string; name: string; line_no: string | null; lastCents: number; tbCents: number };

// tbCents: the account's final trial balance in the ledger's sign (debit positive).
export function buildShReport(inp: { accounts: Acct[]; postings: Posting[]; entries: Map<string, ShEntryRef>; own: boolean; yearEnd: string; holders: Map<string, string> }): ShReport {
  const cards: ShCard[] = [];
  for (const a of inp.accounts.filter((x) => isShAccount({ key: x.key, line_no: x.line_no }))) {
    const ps = inp.postings.filter((p) => p.key === a.key);
    let opening = 0, paidTo = 0, paidIn = 0, books: number | null = null;
    const perEntry = new Map<string, number>();
    if (inp.own) {
      opening = -a.lastCents;
      const imported = ps.filter((p) => p.kind === "import").reduce((t, p) => t + p.cents, 0);
      books = -(imported - a.lastCents);
    }
    for (const p of ps) {
      if (p.kind === "opening" && !inp.own) opening -= p.cents;
      else if (p.kind === "bank") { if (p.cents > 0) paidTo -= p.cents; else paidIn -= p.cents; }
      else if (p.kind === "entry") perEntry.set(p.ref, (perEntry.get(p.ref) ?? 0) - p.cents);
    }
    const line = (ref: string, cents: number): ShReportEntry => {
      const e = inp.entries.get(ref);
      return { ref, no: e?.no ?? "", kind: e?.kind ?? "", wpRef: e?.wpRef ?? "", cents };
    };
    const byNo = (x: ShReportEntry, y: ShReportEntry) => x.no.localeCompare(y.no) || x.ref.localeCompare(y.ref);
    const credited = [...perEntry].filter(([, c]) => c > 0).map(([r, c]) => line(r, c)).sort(byNo);
    const debited = [...perEntry].filter(([, c]) => c < 0).map(([r, c]) => line(r, c)).sort(byNo);
    const creditedCents = credited.reduce((t, x) => t + x.cents, 0), debitedCents = debited.reduce((t, x) => t + x.cents, 0);
    const closing = opening + paidTo + paidIn + (books ?? 0) + creditedCents + debitedCents;
    const any = opening || closing || a.tbCents || ps.length;
    if (!any) continue;
    const owedBy = closing < 0;
    cards.push({
      key: a.key, number: a.number, name: a.name, holder: inp.holders.get(a.key) ?? "", line_no: a.line_no ?? "",
      openingCents: opening, paidToCents: paidTo, paidInCents: paidIn, booksCents: books,
      credited, creditedCents, debited, debitedCents,
      closingCents: closing, movementCents: closing - opening, tbCents: -a.tbCents, tied: closing === -a.tbCents,
      owedBy, dueOn: owedBy ? addYear(inp.yearEnd) : null,
    });
  }
  cards.sort((x, y) => x.number.localeCompare(y.number) || x.key.localeCompare(y.key));
  const sum = (f: (c: ShCard) => number) => cards.reduce((t, c) => t + f(c), 0);
  return { cards, total: { openingCents: sum((c) => c.openingCents), movementCents: sum((c) => c.movementCents), closingCents: sum((c) => c.closingCents) } };
}

// Text shared by the screen and the exports.
export const money = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const shown = (c: number) => (c === 0 ? "–" : c < 0 ? `(${money(c)})` : money(c));
export const shortDay = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
export const cardTitle = (c: Pick<ShCard, "number" | "name" | "holder">) => `${c.number} ${c.name}${c.holder ? ` · ${c.holder}` : ""}`;
export const openingLabel = (c: ShCard) => `Opening balance, ${c.openingCents < 0 ? "owed by the shareholder" : "owed to the shareholder"}`;
export const atYearEnd = (c: ShCard) => (c.owedBy ? `Owed by the shareholder · repay by ${shortDay(c.dueOn!)}` : "Owed to the shareholder");
// The grey result line: the bold part, then the rest.
export const resultLine = (c: ShCard): [string, string] => c.owedBy
  ? [`Owed by the shareholder at year-end: ${money(c.closingCents)}.`, `Repay by ${shortDay(c.dueOn!)}.${c.tied ? " Ties to the trial balance." : ""}`]
  : [`Owed to the shareholder at year-end: ${money(c.closingCents)}.`, c.tied ? "Ties to the trial balance." : ""];
export const entryLabel = (e: ShReportEntry) => `${e.no}${e.wpRef ? ` · ${e.wpRef}` : ""}`;
export const SIGN_NOTE = "Amounts owed to the shareholder are shown plain; amounts owed by the shareholder are in brackets.";
