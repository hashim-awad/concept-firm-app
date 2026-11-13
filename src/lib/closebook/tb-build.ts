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
export type TbRow = { key: string; number: string; name: string; line_no: string | null; cents: number; reviewer?: string };

export const UNCODED = "uncoded";
export const OPENING = "opening";

export function buildTrialBalance(banks: BuildBank[], lines: BuildLine[], chart: Map<string, BuildChart>, codes: Map<string, TaxCode>, ctx: TaxContext): TbRow[] {
  const rows = new Map<string, TbRow>();
  const add = (key: string, number: string, name: string, line_no: string | null, cents: number, reviewer?: string) => {
    const r = rows.get(key) ?? { key, number, name, line_no, cents: 0, reviewer };
    r.cents += cents; rows.set(key, r);
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

  for (const b of banks) {
    const open = b.kind === "bank" ? b.openingCents : -b.openingCents;
    add(bankKey(b), b.chart, shared.has(b.chart) ? b.name : chart.get(b.chart)?.name ?? b.name, chart.get(b.chart)?.line_no ?? null, open);
    add(OPENING, "", "Opening balances to enter", null, -open, "Enter last year's closing balances: until then the opening bank and card balances sit here.");
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
  return [...rows.values()].filter((r) => r.cents !== 0 || r.key.startsWith("chart:") || r.key.startsWith("bank:"));
}
