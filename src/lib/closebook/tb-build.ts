// The trial balance of a file built from bank and card CSVs (Hashim, Nov 13, 2026; PHASE3-BATCH.md 5.1
// "Closebook builds the trial balance"). Pure and tested. Debits positive, credits negative, in cents.
//
// - Each bank or card account: its first statement's opening plus every line on it.
//   Bank: money in is a debit. Card or line of credit: a charge is a credit (more owing).
// - Each coded line posts the other side to its standard chart account, with the sales tax split:
//   purchases: net + non-recoverable tax to the account, ITC to 21500 GST/HST payable;
//   sales (Revenue accounts): net to the account, GST/HST collected to 21500, PST collected to 21550.
// - Lines not yet coded (or waiting for the reviewer or the client) sit in "Transactions not yet coded".
// - A transfer between two of the file's accounts (round 20) posts once, on its money-out line: Dr the
//   other account, Cr this one. Its money-in line ("matched") posts nothing.
// - The opening balances sit in "Opening balances to enter" until last year's closing balances are in.
// So the trial balance always balances; the two holding accounts show what is left to do.
//
// Every amount is also kept as a posting (date, source, description), so the reports and the ledger are
// built live from the postings (Hashim, Nov 15, 2026: reports like QuickBooks Online, with drill-down).
// Last year's balances post to the standard chart account on the same GIFI line, as QuickBooks posts
// opening balances to accounts; a GIFI line with no chart account keeps its GIFI code.
import { splitLine, type TaxCode, type TaxContext } from "./sales-tax.ts";

// number: the bank or card account's own number in the file (round 4b): the first on a chart account takes
// its number, others the next free one (10010). Optional for older callers: the chart number then.
// Round 22: lineNo overrides the chart account's GIFI line (a long-term line of credit on 3149); fromBooks says
// the opening is the balance in the books typed in step 3, not the first statement's opening.
export type BuildBank = { id: string; name: string; kind: "bank" | "card"; chart: string; openingCents: number; number?: string; lineNo?: string | null; fromBooks?: boolean;
  t2Line?: string | null };   // round 25: last year's T2 line (empty: the type's usual line)
// transfer_bank (round 20): on the money-out line of a matched transfer, the other bank or card account; its
// other side posts to that account's own row. The money-in line of the transfer has status "matched".
export type BuildLine = { account_id: string; cents: number; status: string; chart_account: string | null; tax_code: string | null; id?: string; date?: string; description?: string;
  transfer_bank?: string | null;
  // Round 31 (step 4): a transfer posted to another of the file's accounts before that account had a line for it, and the
  // rows of a split line (each a share of the line's amount, positive in the line's own direction).
  transfer_to?: string | null; splits?: { chart_account: string; tax_code: string | null; cents: number }[] };
export type BuildChart = { name: string; account_type: string; line_no: string | null };
export type TbRow = { key: string; number: string; name: string; line_no: string | null; cents: number; lastCents: number; reviewer?: string;
  lastLine?: string };   // round 25: the T2 line last year's figure came from, when it differs from this year's
// Last year's balances by GIFI code (src/lib/closebook/opening.ts), with last year's 3849 as stated on
// last year's T2 (null when it comes from last year's Closebook file, where it is the same by design).
// account: the standard chart account chosen in step 2 when the GIFI line has more than one.
export type BuildOpening = { lines: { code: string; line_no: string; name: string; type: string; debitCents: number; account?: string | null; bank?: string | null }[]; reClosingCents: number; reStatedCents: number | null };

// One amount on one account. kind: where it came from; ref: the bank line, entry, GIFI code or
// statement it came from (for the drill-down); acct: the bank or card account of a bank line.
export type PostingKind = "opening" | "bank" | "entry" | "import";
// entryKind: AJE, RJE or TJE for an adjusting entry (Adjust = AJE and TJE, Reclass = RJE).
export type Posting = { key: string; cents: number; date: string; kind: PostingKind; ref: string; acct?: string; label: string; entryKind?: "AJE" | "RJE" | "TJE" };

export const UNCODED = "uncoded";
// Round 24: a line posts only once it has an account (coded). New lines, matched transfer money-in lines, lines that
// clear an outstanding item and excluded lines post nothing.
// Round 31 (step 4, QuickBooks Online's Pending and Posted): only a posted line posts ("done", or "reviewer" when it went to
// the reviewer). A Pending line with an account chosen, a line asked of the client and an excluded line post nothing.
export const linePosts = (l: { status: string; chart_account: string | null; transfer_to?: string | null; splits?: unknown[] }) =>
  (l.status === "done" || l.status === "reviewer") && (!!l.chart_account || !!l.transfer_to || !!l.splits?.length);
export const OPENING = "opening";

// The standard chart account a GIFI line's balance lands on: the account on that exact line, else the
// first one on a sub-line of the same code (chart order).
export function chartForLine(chart: Map<string, BuildChart>, line_no: string, code: string): string | null {
  let sub: string | null = null;
  for (const [n, c] of chart) {
    if (c.line_no === line_no) return n;
    if (!sub && c.line_no?.startsWith(`${code}.`)) sub = n;
  }
  return sub;
}

export function buildTrialBalance(banks: BuildBank[], lines: BuildLine[], chart: Map<string, BuildChart>, codes: Map<string, TaxCode>, ctx: TaxContext, opening?: BuildOpening | null): TbRow[] {
  return buildLedger(banks, lines, chart, codes, ctx, opening).rows;
}

// One cause of "Opening balances to enter", with its share of the row (debit positive), so the row can be
// opened to its build-up: the causes always add up to the row (Hashim, Nov 16, 2026, round 2 item 8).
export type OpeningCause = { text: string; cents: number };

// A GIFI line with no standard chart account gets a file account: a 5-digit number in its type's range
// (never the GIFI code) and the line's plain name (round 2 item 7; QuickBooks numbers its own accounts).
export const FILE_ACCOUNT_BASE: Record<string, number> = { Asset: 19000, Liability: 29000, Equity: 39000, Revenue: 49000, Expense: 79000 };
export function fileAccountNumber(type: string, taken: Set<string>): string {
  let n = FILE_ACCOUNT_BASE[type] ?? 79000;
  while (taken.has(String(n))) n += 10;
  return String(n);
}

export function buildLedger(banks: BuildBank[], lines: BuildLine[], chart: Map<string, BuildChart>, codes: Map<string, TaxCode>, ctx: TaxContext, opening?: BuildOpening | null, yearStart = "",
  fileNumbers: Map<string, string> = new Map()): { rows: TbRow[]; postings: Posting[]; causes: OpeningCause[] } {
  const causes: OpeningCause[] = [];
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
  // Each bank or card account is its own row with its own number and name (round 4b, as QuickBooks Online).
  // The one holding its chart account's number is that chart account's row, so a line coded to 10000 from
  // another account lands on the same row; any other has its own row.
  const numberOf = (b: BuildBank) => b.number ?? b.chart;
  const bankKey = (b: BuildBank) => (numberOf(b) === b.chart ? `chart:${b.chart}` : `bank:${b.id}`);
  const byId = new Map(banks.map((b) => [b.id, b]));
  const openMeta = (ref: string, label: string): Meta => ({ date: yearStart, kind: "opening", ref, label });

  const lineOf = (b: BuildBank) => b.lineNo ?? chart.get(b.chart)?.line_no ?? null;
  const gifiOf = (b: BuildBank) => (lineOf(b) ?? "").slice(0, 4);
  // Round 23: an account overdrawn at last year end ties to last year's Bank overdraft (2600), as on the T2.
  // Round 25: an account carries last year's T2 line when the prior accountant put it on another one (a line of
  // credit on 2707 with the cards): the opening compares, and the rounding posts, per T2 line as last year had it.
  const tieOf = (b: BuildBank) => b.t2Line || (b.kind === "bank" && b.fromBooks && b.openingCents < 0 ? "2600" : gifiOf(b));
  for (const b of banks) {
    const open = b.kind === "bank" ? b.openingCents : -b.openingCents;
    const m = openMeta(`stmt:${b.id}`, b.fromBooks ? `Balance in the books at the start of the year, ${b.name}` : `Opening balance on the first statement, ${b.name}`);
    add(bankKey(b), numberOf(b), b.name, lineOf(b), open, m);
    if (!opening) {
      add(OPENING, "", "Opening balances to enter", null, -open, m, "Enter last year's closing balances: until then the opening bank and card balances sit here.");
      if (open) causes.push({ text: `${b.name}: the first statement opens at ${(b.kind === "bank" ? open : -open) / 100 < 0 ? "-" : ""}${Math.abs(open / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })}, and last year's balances are not entered yet`, cents: -open });
    }
  }
  if (opening) {
    // Last year's balances carry into this year: balance sheet lines carry, the income statement
    // closes to retained earnings (closing = 3660 + net income − dividends + adjustments).
    const bankOpen = new Map<string, number>(), banksOn = new Map<string, BuildBank[]>();
    for (const b of banks) {
      const g = tieOf(b);
      bankOpen.set(g, (bankOpen.get(g) ?? 0) + (b.kind === "bank" ? b.openingCents : -b.openingCents));
      banksOn.set(g, [...(banksOn.get(g) ?? []), b]);
    }
    const diffs: string[] = [];
    // A negative in brackets, ($1,234.00) (Hashim, Nov 15, 2026, item C).
    const dollars = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" }); return c < 0 ? `(${t})` : t; };
    const taken = new Set<string>([...chart.keys(), ...fileNumbers.values()]);
    // A card or line of credit in the statement's own terms (round 3 item 7): a balance owing is positive.
    const inStatementTerms = (g: string, debitCents: number) => {
      const cards = (banksOn.get(g) ?? []).every((b) => b.kind === "card") && (banksOn.get(g) ?? []).length > 0;
      if (!cards) return dollars(debitCents);
      return debitCents <= 0 ? `${dollars(-debitCents)} owing` : `${dollars(debitCents)} in credit`;
    };
    const hasRe = opening.lines.some((l) => l.code === "3660");
    const bankCode = (l: { code: string; bank?: string | null }) => { const b = l.bank ? banks.find((x) => x.id === l.bank) : undefined; return b ? tieOf(b) || l.code : l.code; };
    for (const l of opening.lines) {
      const n = Number(l.code);
      const ch = l.account && chart.has(l.account) ? l.account : chartForLine(chart, l.line_no, l.code);
      const key = ch ? `chart:${ch}` : `gifi:${l.code}`;
      // No standard chart account on the line: a file account with its own 5-digit number, never the GIFI code.
      let number = ch ?? fileNumbers.get(l.code) ?? "";
      if (!number) { number = fileAccountNumber(l.type, taken); taken.add(number); fileNumbers.set(l.code, number); }
      const name = ch ? chart.get(ch)!.name : l.name;
      const line_no = ch ? chart.get(ch)!.line_no : l.line_no;
      const m = openMeta(`gifi:${l.code}`, `Last year's closing balance, GIFI ${l.code}`);
      if (l.type === "Revenue" || l.type === "Expense" || (n >= 3700 && n <= 3848)) add(key, number, name, line_no, 0, null, undefined, l.debitCents);
      else if (l.code === "3660") add(key, number, ch ? name : "Retained earnings", line_no, -opening.reClosingCents,
        openMeta("gifi:3849", "Retained earnings at the start of the year (last year's 3849)"), undefined, l.debitCents);
      // Round 21 (Recommendation A): a summary line (1000) can sit on a bank account on its detail line (1002).
      else if (bankOpen.has(bankCode(l))) {
        // A bank, card or line of credit line: this year starts from the statements; last year's closing must match.
        const on = banksOn.get(bankCode(l))!;
        // Last year's balance sits on the bank account it belongs to (chosen in step 2), else the one holding
        // the chart account's number, so the year-over-year comparison is on one line (round 4b).
        // Round 25: the home account is one that stays on this T2 line this year, when there is one.
        const moved = (b: BuildBank) => !!b.t2Line && b.t2Line !== gifiOf(b);
        const home = on.find((b) => b.id === l.bank && !moved(b)) ?? on.find((b) => !moved(b) && numberOf(b) === b.chart) ?? on.find((b) => !moved(b))
          ?? on.find((b) => b.id === l.bank) ?? on[0];
        // Round 25: an account whose line this year differs from last year's T2 line takes its own balance as last
        // year's figure, and says where it came from ("Reclassified from 2707 to 2701"); the rest stays on the home one.
        let lastRest = l.debitCents;
        for (const b of on) {
          if (b === home || !moved(b)) continue;
          const own = b.kind === "bank" ? b.openingCents : -b.openingCents;
          add(bankKey(b), numberOf(b), "", null, 0, null, undefined, own);
          const r = rows.get(bankKey(b)); if (r) r.lastLine = b.t2Line ?? undefined;
          lastRest -= own;
        }
        add(bankKey(home), numberOf(home), "", null, 0, null, undefined, lastRest);
        if (moved(home)) { const r = rows.get(bankKey(home)); if (r) r.lastLine = home.t2Line!; }
        const d = bankOpen.get(bankCode(l))! - l.debitCents;
        // Round 23 (Hashim): last year's T2 is in whole dollars. Under 1.00 is rounding: it posts by itself to
        // retained earnings at the start of the year, one entry per T2 line, so the opening trial balance is 0.00.
        if (d && Math.abs(d) < 100) {
          const re = chartForLine(chart, "3600.00", "3600");
          add(re ? `chart:${re}` : "gifi:3660", re ?? fileAccountNumber("Equity", taken), re ? chart.get(re)!.name : "Retained earnings", re ? chart.get(re)!.line_no : "3600.00", -d,
            openMeta(`rounding:${bankCode(l)}`, `Opening balance rounding, GIFI ${bankCode(l)}`));
        } else if (d) {
          const t = `GIFI ${l.code}: the first statements open at ${inStatementTerms(bankCode(l), bankOpen.get(bankCode(l))!)}, last year closed at ${inStatementTerms(bankCode(l), l.debitCents)}`;
          diffs.push(t); causes.push({ text: t, cents: -d });
        }
        bankOpen.delete(bankCode(l));
      } else add(key, number, name, line_no, l.debitCents, m, undefined, l.debitCents);
    }
    for (const [g, c] of bankOpen) if (c) {
      const t = `GIFI ${g}: the first statements open at ${inStatementTerms(g, c)}, but last year has no balance on this line`;
      diffs.push(t); causes.push({ text: t, cents: -c });
    }
    // Retained earnings at the start of the year post even when last year had no 3660 line (a company in
    // its second year): before Nov 16 the build only posted them from a 3660 line, so a 3849 typed with
    // no 3660 sat unexplained in "Opening balances to enter".
    if (!hasRe && opening.reClosingCents) {
      const ch = chartForLine(chart, "3600.00", "3600");
      // Last year's column: retained earnings at the start of last year, 0.00 (no 3660). Last year's net
      // income shows as its own line, as the balance sheet shows it (round 3 item 6).
      add(ch ? `chart:${ch}` : "gifi:3660", ch ?? fileAccountNumber("Equity", taken), ch ? chart.get(ch)!.name : "Retained earnings", ch ? chart.get(ch)!.line_no : "3600.00", -opening.reClosingCents,
        openMeta("gifi:3849", "Retained earnings at the start of the year (last year's 3849)"));
    }
    const reOff = opening.reStatedCents !== null && opening.reStatedCents !== opening.reClosingCents;
    if (reOff) {
      const t = `Opening retained earnings ${dollars(opening.reClosingCents)} (3660 + net income − dividends + adjustments) does not equal last year's 3849 of ${dollars(opening.reStatedCents!)}`;
      diffs.push(t); causes.push({ text: t, cents: opening.reClosingCents - opening.reStatedCents! });
    }
    // Whatever does not tie sits here for the reviewer; with both checks passing there is nothing.
    const others = [...rows.values()].reduce((t, r) => t + r.cents, 0);
    // Anything the causes above do not explain: last year's balances themselves do not balance.
    const rest = -others - causes.reduce((t, c) => t + c.cents, 0);
    if (rest) {
      const t = `Last year's balances as entered in step 2 do not balance: debits and credits differ by ${dollars(Math.abs(rest))}`;
      diffs.push(t); causes.push({ text: t, cents: rest });
    }
    if (diffs.length || others) add(OPENING, "", "Opening balances to enter", null, -others, openMeta("", "Difference with last year's closing balances"), diffs.join(". ") || "Last year's balances do not balance.");
  }
  for (const l of lines) {
    const b = byId.get(l.account_id);
    if (!b) continue;
    // Round 24 (Hashim, Nov 16, 2026; QuickBooks Online's bank feed, where "For review" lines are not in the books):
    // an imported line is in the bank feed, outside the ledger, until it is coded. A coded line posts its account
    // against the bank account; a flag (client question list, reviewer) does not change that. Round 20: the
    // money-in line of a matched transfer posts nothing (the transfer posts once, from the money-out line); a line
    // that clears last year's outstanding item posts nothing either.
    if (!linePosts(l)) continue;
    const m: Meta = { date: l.date ?? "", kind: "bank", ref: l.id ?? "", acct: b.id, label: l.description ?? "" };
    const debit = b.kind === "bank" ? l.cents : -l.cents;   // the bank or card side
    const toId = l.transfer_bank ?? l.transfer_to ?? null;
    const to = toId ? byId.get(toId) : undefined;
    // The rows the other side posts to: the account, or each row of a split (round 31).
    const parts = to ? [] : l.splits?.length ? l.splits.map((x) => ({ account: x.chart_account, tax: x.tax_code, debit: Math.sign(debit) * x.cents }))
      : [{ account: l.chart_account!, tax: l.tax_code, debit }];
    if (!to && parts.some((x) => !chart.get(x.account))) continue;
    add(bankKey(b), numberOf(b), "", null, debit, m);
    if (to) { add(bankKey(to), numberOf(to), "", null, -debit, m); continue; }
    for (const x of parts) {
      const c = chart.get(x.account)!;
      const code = x.tax ? codes.get(x.tax) ?? null : null;
      if (c.account_type === "Revenue") {
        const s = splitLine(x.debit, code, "sale", ctx);
        post(x.account, -s.netCents, m);
        if (s.gstCollectedCents) post("21500", -s.gstCollectedCents, m);
        if (s.pstCollectedCents) post("21550", -s.pstCollectedCents, m);
      } else {
        const s = splitLine(-x.debit, code, "purchase", ctx, c.account_type === "Asset");
        post(x.account, s.netCents + s.expenseTaxCents, m);
        if (s.itcCents) post("21500", s.itcCents, m);
      }
    }
  }
  // Clearing (10900) nets to nil: a balance left at year-end needs a decision (round 4 item 3).
  const clearing = rows.get("chart:10900");
  if (clearing && clearing.cents) clearing.reviewer = "Clearing should be nil at year-end: one side of a transfer is coded and the other is not. Clear it with an entry.";
  // Drop empty rows; the opening row stays while it has a reason, even at zero (retained earnings off).
  const out = [...rows.values()].filter((r) => r.cents !== 0 || r.lastCents !== 0 || r.key.startsWith("chart:") || r.key.startsWith("bank:") || (r.key === OPENING && !!r.reviewer));
  return { rows: out, postings, causes };
}
