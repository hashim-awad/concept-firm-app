// The trial balance of a file built from bank and card CSVs (Hashim, Nov 13, 2026; PHASE3-BATCH.md 5.1
// "Closebook builds the trial balance"). Pure and tested. Debits positive, credits negative, in cents.
//
// - Each bank or card account: its first statement's opening plus every line on it.
//   Bank: money in is a debit. Card or line of credit: a charge is a credit (more owing).
// - Each coded line posts the other side to its standard chart account, with the sales tax split:
//   purchases: net + non-recoverable tax to the account, ITC to 21500 GST/HST payable;
//   sales (Revenue accounts): net to the account, GST/HST collected to 21500, PST collected to 21550.
// - Lines not yet coded (or waiting for the reviewer or the client) sit in "Transactions not yet coded".
// - The opening balances sit in "Opening balances to enter" until last year's closing balances are in.
// So the trial balance always balances; the two holding accounts show what is left to do.
//
// Every amount is also kept as a posting (date, source, description), so the reports and the ledger are
// built live from the postings (Hashim, Nov 15, 2026: reports like QuickBooks Online, with drill-down).
// Last year's balances post to the standard chart account on the same GIFI line, as QuickBooks posts
// opening balances to accounts; a GIFI line with no chart account keeps its GIFI code.
import { splitLine, type TaxCode, type TaxContext } from "./sales-tax.ts";

export type BuildBank = { id: string; name: string; kind: "bank" | "card"; chart: string; openingCents: number };
export type BuildLine = { account_id: string; cents: number; status: string; chart_account: string | null; tax_code: string | null; id?: string; date?: string; description?: string };
export type BuildChart = { name: string; account_type: string; line_no: string };
export type TbRow = { key: string; number: string; name: string; line_no: string | null; cents: number; lastCents: number; reviewer?: string };
// Last year's balances by GIFI code (src/lib/closebook/opening.ts), with last year's 3849 as stated on
// last year's T2 (null when it comes from last year's Closebook file, where it is the same by design).
export type BuildOpening = { lines: { code: string; line_no: string; name: string; type: string; debitCents: number }[]; reClosingCents: number; reStatedCents: number | null };

// One amount on one account. kind: where it came from; ref: the bank line, entry, GIFI code or
// statement it came from (for the drill-down); acct: the bank or card account of a bank line.
export type PostingKind = "opening" | "bank" | "entry" | "import";
export type Posting = { key: string; cents: number; date: string; kind: PostingKind; ref: string; acct?: string; label: string };

export const UNCODED = "uncoded";
export const OPENING = "opening";

// The standard chart account a GIFI line's balance lands on: the account on that exact line, else the
// first one on a sub-line of the same code (chart order).
export function chartForLine(chart: Map<string, BuildChart>, line_no: string, code: string): string | null {
  let sub: string | null = null;
  for (const [n, c] of chart) {
    if (c.line_no === line_no) return n;
    if (!sub && c.line_no.startsWith(`${code}.`)) sub = n;
  }
  return sub;
}

export function buildTrialBalance(banks: BuildBank[], lines: BuildLine[], chart: Map<string, BuildChart>, codes: Map<string, TaxCode>, ctx: TaxContext, opening?: BuildOpening | null): TbRow[] {
  return buildLedger(banks, lines, chart, codes, ctx, opening).rows;
}

export function buildLedger(banks: BuildBank[], lines: BuildLine[], chart: Map<string, BuildChart>, codes: Map<string, TaxCode>, ctx: TaxContext, opening?: BuildOpening | null, yearStart = ""): { rows: TbRow[]; postings: Posting[] } {
  const rows = new Map<string, TbRow>();
  const postings: Posting[] = [];
  type Meta = Omit<Posting, "key" | "cents">;
  const add = (key: string, number: string, name: string, line_no: string | null, cents: number, meta: Meta | null, reviewer?: string, lastCents = 0) => {
    const r = rows.get(key) ?? { key, number, name, line_no, cents: 0, lastCents: 0, reviewer };
    r.cents += cents; r.lastCents += lastCents; rows.set(key, r);
    if (cents && meta) postings.push({ key, cents, ...meta });
  };
  const post = (number: string, cents: number, meta: Meta) => {
    const c = chart.get(number);
    add(`chart:${number}`, number, c?.name ?? number, c?.line_no ?? null, cents, meta);
  };
  // Two accounts on the same chart account (two cards) stay apart; one alone uses the chart account,
  // so a payment coded to it from another account lands on the same line.
  const shared = new Set(banks.map((b) => b.chart).filter((c, i, all) => all.indexOf(c) !== i));
  const bankKey = (b: BuildBank) => (shared.has(b.chart) ? `bank:${b.id}` : `chart:${b.chart}`);
  const byId = new Map(banks.map((b) => [b.id, b]));
  const openMeta = (ref: string, label: string): Meta => ({ date: yearStart, kind: "opening", ref, label });

  const gifiOf = (b: BuildBank) => (chart.get(b.chart)?.line_no ?? "").slice(0, 4);
  for (const b of banks) {
    const open = b.kind === "bank" ? b.openingCents : -b.openingCents;
    const m = openMeta(`stmt:${b.id}`, `Opening balance on the first statement, ${b.name}`);
    add(bankKey(b), b.chart, shared.has(b.chart) ? b.name : chart.get(b.chart)?.name ?? b.name, chart.get(b.chart)?.line_no ?? null, open, m);
    if (!opening) add(OPENING, "", "Opening balances to enter", null, -open, m, "Enter last year's closing balances: until then the opening bank and card balances sit here.");
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
      const n = Number(l.code);
      const ch = chartForLine(chart, l.line_no, l.code);
      const key = ch ? `chart:${ch}` : `gifi:${l.code}`;
      const number = ch ?? "";
      const name = ch ? chart.get(ch)!.name : l.name;
      const line_no = ch ? chart.get(ch)!.line_no : l.line_no;
      const m = openMeta(`gifi:${l.code}`, `Last year's closing balance, GIFI ${l.code}`);
      if (l.type === "Revenue" || l.type === "Expense" || (n >= 3700 && n <= 3848)) add(key, number, name, line_no, 0, null, undefined, l.debitCents);
      else if (l.code === "3660") add(key, number, ch ? name : "Retained earnings", line_no, -opening.reClosingCents,
        openMeta("gifi:3849", "Retained earnings at the start of the year (last year's 3849)"), undefined, l.debitCents);
      else if (bankOpen.has(l.code)) {
        // A bank, card or line of credit line: this year starts from the statements; last year's closing must match.
        const on = banksOn.get(l.code)!;
        if (on.length === 1) add(bankKey(on[0]), on[0].chart, "", null, 0, null, undefined, l.debitCents);
        else add(key, number, name, line_no, 0, null, undefined, l.debitCents);
        const d = bankOpen.get(l.code)! - l.debitCents;
        if (d) diffs.push(`GIFI ${l.code}: the first statements open at ${dollars(bankOpen.get(l.code)!)}, last year closed at ${dollars(l.debitCents)}`);
        bankOpen.delete(l.code);
      } else add(key, number, name, line_no, l.debitCents, m, undefined, l.debitCents);
    }
    for (const [g, c] of bankOpen) if (c) diffs.push(`GIFI ${g}: the first statements open at ${dollars(c)}, but last year has no balance on this line`);
    const reOff = opening.reStatedCents !== null && opening.reStatedCents !== opening.reClosingCents;
    if (reOff) diffs.push(`Opening retained earnings ${dollars(opening.reClosingCents)} (3660 + net income − dividends + adjustments) does not equal last year's 3849 of ${dollars(opening.reStatedCents!)}`);
    // Whatever does not tie sits here for the reviewer; with both checks passing there is nothing.
    const others = [...rows.values()].reduce((t, r) => t + r.cents, 0);
    if (diffs.length || others) add(OPENING, "", "Opening balances to enter", null, -others, openMeta("", "Difference with last year's closing balances"), diffs.join(". ") || "Last year's balances do not balance.");
  }
  for (const l of lines) {
    const b = byId.get(l.account_id);
    if (!b) continue;
    const m: Meta = { date: l.date ?? "", kind: "bank", ref: l.id ?? "", acct: b.id, label: l.description ?? "" };
    const debit = b.kind === "bank" ? l.cents : -l.cents;   // the bank or card side
    add(bankKey(b), b.chart, "", null, debit, m);
    const c = l.status === "done" && l.chart_account ? chart.get(l.chart_account) : undefined;
    if (!c) { add(UNCODED, "", "Transactions not yet coded", null, -debit, m, "Lines still to code, or waiting for the reviewer or the client."); continue; }
    const code = l.tax_code ? codes.get(l.tax_code) ?? null : null;
    if (c.account_type === "Revenue") {
      const s = splitLine(debit, code, "sale", ctx);
      post(l.chart_account!, -s.netCents, m);
      if (s.gstCollectedCents) post("21500", -s.gstCollectedCents, m);
      if (s.pstCollectedCents) post("21550", -s.pstCollectedCents, m);
    } else {
      const s = splitLine(-debit, code, "purchase", ctx, c.account_type === "Asset");
      post(l.chart_account!, s.netCents + s.expenseTaxCents, m);
      if (s.itcCents) post("21500", s.itcCents, m);
    }
  }
  // Drop empty rows; the opening row stays while it has a reason, even at zero (retained earnings off).
  const out = [...rows.values()].filter((r) => r.cents !== 0 || r.lastCents !== 0 || r.key.startsWith("chart:") || r.key.startsWith("bank:") || (r.key === OPENING && !!r.reviewer));
  return { rows: out, postings };
}
