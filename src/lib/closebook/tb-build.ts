// The trial balance of a file built from bank and card CSVs (Hashim, Nov 13, 2026; PHASE3-BATCH.md 5.1
// "Closebook builds the trial balance"). Pure and tested. Debits positive, credits negative, in cents.
//
// - Each bank or card account: its first statement's opening plus every line on it.
//   Bank: money in is a debit. Card or line of credit: a charge is a credit (more owing).
// - Each coded line posts the other side to its standard chart account, with the sales tax split:
//   purchases: net + non-recoverable tax to the account, ITC to 2150 GST/HST payable;
//   sales (Revenue accounts): net to the account, GST/HST collected to 2150, PST collected to 2155.
// - Lines not yet coded (or waiting for the reviewer or the client) sit in "Transactions not yet coded".
// - The opening balances sit in "Opening balances to enter" until last year's closing balances are in.
// So the trial balance always balances; the two holding accounts show what is left to do.
import { splitLine, type TaxCode, type TaxContext } from "./sales-tax.ts";

export type BuildBank = { id: string; name: string; kind: "bank" | "card"; chart: string; openingCents: number };
export type BuildLine = { account_id: string; cents: number; status: string; chart_account: string | null; tax_code: string | null };
export type BuildChart = { name: string; account_type: string; line_no: string };
export type TbRow = { key: string; number: string; name: string; line_no: string | null; cents: number; lastCents: number; reviewer?: string };
// Last year's balances by GIFI code (src/lib/closebook/opening.ts), with last year's 3849 as stated on
// last year's T2 (null when it comes from last year's Closebook file, where it is the same by design).
export type BuildOpening = { lines: { code: string; line_no: string; name: string; type: string; debitCents: number }[]; reClosingCents: number; reStatedCents: number | null };

export const UNCODED = "uncoded";
export const OPENING = "opening";

export function buildTrialBalance(banks: BuildBank[], lines: BuildLine[], chart: Map<string, BuildChart>, codes: Map<string, TaxCode>, ctx: TaxContext, opening?: BuildOpening | null): TbRow[] {
  const rows = new Map<string, TbRow>();
  const add = (key: string, number: string, name: string, line_no: string | null, cents: number, reviewer?: string, lastCents = 0) => {
    const r = rows.get(key) ?? { key, number, name, line_no, cents: 0, lastCents: 0, reviewer };
    r.cents += cents; r.lastCents += lastCents; rows.set(key, r);
  };
  const post = (number: string, cents: number) => {
    const c = chart.get(number);
    add(`chart:${number}`, number, c?.name ?? number, c?.line_no ?? null, cents);
  };
  // Two accounts on the same chart account (two cards) stay apart; one alone uses the chart account,
  // so a payment coded to it from another account lands on the same line.
  const shared = new Set(banks.map((b) => b.chart).filter((c, i, all) => all.indexOf(c) !== i));
  const bankKey = (b: BuildBank) => (shared.has(b.chart) ? `bank:${b.id}` : `chart:${b.chart}`);
  const byId = new Map(banks.map((b) => [b.id, b]));

  const gifiOf = (b: BuildBank) => (chart.get(b.chart)?.line_no ?? "").slice(0, 4);
  for (const b of banks) {
    const open = b.kind === "bank" ? b.openingCents : -b.openingCents;
    add(bankKey(b), b.chart, shared.has(b.chart) ? b.name : chart.get(b.chart)?.name ?? b.name, chart.get(b.chart)?.line_no ?? null, open);
    if (!opening) add(OPENING, "", "Opening balances to enter", null, -open, "Enter last year's closing balances: until then the opening bank and card balances sit here.");
  }
  if (opening) {
    // Last year's balances carry into this year: balance sheet lines carry, the income statement
    // closes to retained earnings (closing = 3660 + net income − dividends + adjustments).
    const bankOpen = new Map<string, number>(), banksOn = new Map<string, BuildBank[]>();
    for (const b of banks) {
      const g = gifiOf(b);
      bankOpen.set(g, (bankOpen.get(g) ?? 0) + (b.kind === "bank" ? b.openingCents : -b.openingCents));
      banksOn.set(g, [...(banksOn.get(g) ?? []), b]);
    }
    const diffs: string[] = [];
    const dollars = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
    for (const l of opening.lines) {
      const key = `gifi:${l.code}`, label = `${l.code} ${l.name}`;
      const n = Number(l.code);
      if (l.type === "Revenue" || l.type === "Expense" || (n >= 3700 && n <= 3848)) add(key, l.code, label, l.line_no, 0, undefined, l.debitCents);
      else if (l.code === "3660") add(key, "3660", "Retained earnings", l.line_no, -opening.reClosingCents, undefined, l.debitCents);
      else if (bankOpen.has(l.code)) {
        // A bank, card or line of credit line: this year starts from the statements; last year's closing must match.
        const on = banksOn.get(l.code)!;
        if (on.length === 1) add(bankKey(on[0]), on[0].chart, "", null, 0, undefined, l.debitCents);
        else add(key, l.code, label, l.line_no, 0, undefined, l.debitCents);
        const d = bankOpen.get(l.code)! - l.debitCents;
        if (d) diffs.push(`GIFI ${l.code}: the first statements open at ${dollars(bankOpen.get(l.code)!)}, last year closed at ${dollars(l.debitCents)}`);
        bankOpen.delete(l.code);
      } else add(key, l.code, label, l.line_no, l.debitCents, undefined, l.debitCents);
    }
    for (const [g, c] of bankOpen) if (c) diffs.push(`GIFI ${g}: the first statements open at ${dollars(c)}, but last year has no balance on this line`);
    const reOff = opening.reStatedCents !== null && opening.reStatedCents !== opening.reClosingCents;
    if (reOff) diffs.push(`Opening retained earnings ${dollars(opening.reClosingCents)} (3660 + net income − dividends + adjustments) does not equal last year's 3849 of ${dollars(opening.reStatedCents!)}`);
    // Whatever does not tie sits here for the reviewer; with both checks passing there is nothing.
    const others = [...rows.values()].reduce((t, r) => t + r.cents, 0);
    if (diffs.length || others) add(OPENING, "", "Opening balances to enter", null, -others, diffs.join(". ") || "Last year's balances do not balance.");
  }
  for (const l of lines) {
    const b = byId.get(l.account_id);
    if (!b) continue;
    const debit = b.kind === "bank" ? l.cents : -l.cents;   // the bank or card side
    add(bankKey(b), b.chart, "", null, debit);
    const c = l.status === "done" && l.chart_account ? chart.get(l.chart_account) : undefined;
    if (!c) { add(UNCODED, "", "Transactions not yet coded", null, -debit, "Lines still to code, or waiting for the reviewer or the client."); continue; }
    const code = l.tax_code ? codes.get(l.tax_code) ?? null : null;
    if (c.account_type === "Revenue") {
      const s = splitLine(debit, code, "sale", ctx);
      post(l.chart_account!, -s.netCents);
      if (s.gstCollectedCents) post("2150", -s.gstCollectedCents);
      if (s.pstCollectedCents) post("2155", -s.pstCollectedCents);
    } else {
      const s = splitLine(-debit, code, "purchase", ctx, c.account_type === "Asset");
      post(l.chart_account!, s.netCents + s.expenseTaxCents);
      if (s.itcCents) post("2150", s.itcCents);
    }
  }
  // Fix the bank rows' names (lines added with a blank name) and drop empty rows; the opening row stays
  // while it has a reason, even at zero (retained earnings off).
  return [...rows.values()].filter((r) => r.cents !== 0 || r.lastCents !== 0 || r.key.startsWith("chart:") || r.key.startsWith("bank:") || (r.key === OPENING && !!r.reviewer));
}
