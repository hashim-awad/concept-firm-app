// Step 8, the GST/HST return for year-end clients (round 13, Hashim, Nov 14, 2026). Benchmark: QuickBooks
// Online's GST/HST return: the same lines with their CRA line numbers (GST34), the figures to the cent,
// and each line drilling to the postings behind it. Pure: no database. Amounts in cents.
//
// Regular method: 101 sales and other revenue (every sale with a sales tax code, out of scope left out);
// 103 GST/HST collected; 106 ITCs (as coded: meals at 50%, refunds reverse them); 109 net tax; 110
// instalments; 113 balance (owing +, refund -).
// Quick method (CRA RC4058): 101 eligible sales including the GST/HST, to the dollar; 103 = 101 x the
// remittance rate; 106 ITCs on capital purchases only; 107 the credit on the first part of the year's
// eligible sales. The rates, the credit and its limit are settings (Settings, Closebook), never this file.
import { addMonths } from "./fs-email.ts";

export type GstItem = {
  date: string; source: "bank" | "entry"; ref: string; label: string; account: string; accountName: string; code: string;
  sale: boolean;      // a sale (revenue account): net = revenue, tax = GST/HST collected; else a purchase: net = cost, tax = ITC claimed
  netCents: number; taxCents: number;
};
export type GstPayment = { date: string; ref: string; label: string; cents: number };   // to the CRA (+) or refund received (-)
export type Frequency = "annual" | "quarterly" | "monthly";
export type Period = { n: number; start: string; end: string; label: string; due: string };
export type QuickSettings = { rate: number | null; creditRate: number | null; creditLimitCents: number | null };
export const LINE_NAMES: [string, string][] = [
  ["101", "Sales and other revenue"], ["103", "GST/HST collected or collectible"], ["104", "Adjustments"], ["105", "Total GST/HST and adjustments for the period"],
  ["106", "Input tax credits (ITCs) for the current period"], ["107", "Adjustments"], ["108", "Total ITCs and adjustments"], ["109", "Net tax"],
  ["110", "Instalments and net tax paid"], ["111", "Rebates"], ["112", "Total other credits"], ["113", "Balance (owing, or refund in brackets)"],
];
export type Line = keyof typeof EMPTY;
const EMPTY = { "101": 0, "103": 0, "104": 0, "105": 0, "106": 0, "107": 0, "108": 0, "109": 0, "110": 0, "111": 0, "112": 0, "113": 0 };
export type GstReturn = { period: Period; lines: Record<Line, number>; drill: Partial<Record<Line, GstItem[]>>; problems: string[]; notes: string[]; eligibleCents: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const D = (s: string) => new Date(`${s}T12:00:00Z`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (s: string) => { const d = D(s); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };

// The periods inside the fiscal year: one for an annual filer; the quarters or months otherwise (the last
// one ends at the year end). The due date follows CRA's rule, held in Settings: months after the period.
export function gstPeriods(yearStart: string, yearEnd: string, freq: Frequency, due: { annual: number; period: number }): Period[] {
  if (freq === "annual") return [{ n: 1, start: yearStart, end: yearEnd, label: `Year ${short(yearStart)} to ${short(yearEnd)}`, due: iso(addMonths(D(yearEnd), due.annual)) }];
  const step = freq === "quarterly" ? 3 : 1;
  const out: Period[] = [];
  let start = D(yearStart), n = 1;
  while (iso(start) <= yearEnd) {
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, start.getUTCDate(), 12));
    const endD = new Date(next.getTime() - 86400000);
    const end = iso(endD) > yearEnd ? yearEnd : iso(endD);
    out.push({ n, start: iso(start), end, label: `${freq === "quarterly" ? "Quarter" : "Month"} ${n}: ${short(iso(start))} to ${short(end)}`, due: iso(addMonths(D(end), due.period)) });
    start = next; n++;
  }
  return out;
}

const inPeriod = (p: Period) => (x: { date: string }) => x.date >= p.start && x.date <= p.end;

export function buildReturn(all: GstItem[], period: Period, quick: boolean, q: QuickSettings, instalmentsCents: number, creditUsedCents = 0): GstReturn {
  const items = all.filter(inPeriod(period));
  const L = { ...EMPTY };
  const drill: Partial<Record<Line, GstItem[]>> = {};
  const problems: string[] = [], notes: string[] = [];
  const sales = items.filter((x) => x.sale && x.code !== "OUT_OF_SCOPE");
  const purchases = items.filter((x) => !x.sale && x.taxCents !== 0);
  let eligible = 0;
  if (!quick) {
    L["101"] = sales.reduce((n, x) => n + x.netCents, 0);
    L["103"] = sales.reduce((n, x) => n + x.taxCents, 0);
    drill["101"] = sales; drill["103"] = sales.filter((x) => x.taxCents !== 0);
  } else {
    // Eligible supplies: taxable sales, the GST/HST included; zero-rated and exempt sales are left out.
    const el = sales.filter((x) => x.taxCents !== 0);
    eligible = el.reduce((n, x) => n + x.netCents + x.taxCents, 0);
    L["101"] = Math.round(eligible / 100) * 100;
    drill["101"] = el; drill["103"] = el;
    if (q.rate === null) problems.push("Set the quick method remittance rate in Settings, Closebook, GST/HST.");
    else L["103"] = Math.round(L["101"] * q.rate);
    if (q.creditRate === null || q.creditLimitCents === null) problems.push("Set the quick method credit and its limit in Settings, Closebook, GST/HST.");
    else {
      const room = Math.max(0, q.creditLimitCents - creditUsedCents);
      L["107"] = Math.round(Math.min(L["101"], room) * q.creditRate);
      notes.push(`Quick method credit: ${(q.creditRate * 100).toFixed(2)}% of ${(Math.min(L["101"], room) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} (eligible sales up to ${(q.creditLimitCents / 100).toLocaleString("en-US")} a fiscal year; ${(creditUsedCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} used before this period).`);
    }
    notes.push("Quick method: GST/HST on taxable supplies that are not eligible for the quick method is not added to line 103. Check there are none.");
  }
  L["106"] = purchases.reduce((n, x) => n + x.taxCents, 0);
  drill["106"] = purchases;
  L["105"] = L["103"] + L["104"];
  L["108"] = L["106"] + L["107"];
  L["109"] = L["105"] - L["108"];
  L["110"] = instalmentsCents;
  L["112"] = L["110"] + L["111"];
  L["113"] = L["109"] - L["112"];
  return { period, lines: L, drill, problems, notes, eligibleCents: L["101"] };
}

// All the returns of the year. The quick method credit runs across the year's periods until its limit.
export function buildYear(items: GstItem[], periods: Period[], quick: boolean, q: QuickSettings, instalments: Map<number, number>): GstReturn[] {
  let used = 0;
  return periods.map((p) => {
    const r = buildReturn(items, p, quick, q, instalments.get(p.n) ?? 0, used);
    if (quick) used += r.eligibleCents;
    return r;
  });
}

// The instalments pre-filled for the preparer to confirm: payments to the CRA coded to GST/HST in the
// period. A payment of a balance is not an instalment: a payment that equals last year's balance owing, or
// the balance of an earlier return of the year (a quarterly filer paying last quarter's return), is left out.
export function prefillInstalments(payments: GstPayment[], periods: Period[], lastYearOwingCents: number, earlierBalances: (n: number) => number[] = () => []): { byPeriod: Map<number, number>; lastYear: GstPayment | null; balances: GstPayment[] } {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const lastYear = lastYearOwingCents > 0 ? sorted.find((x) => x.cents === lastYearOwingCents) ?? null : null;
  const used = new Set<GstPayment>(lastYear ? [lastYear] : []);
  const byPeriod = new Map<number, number>();
  for (const p of periods) {
    const owed = earlierBalances(p.n).filter((c) => c > 0);
    for (const x of sorted.filter(inPeriod(p))) {
      const i = owed.indexOf(x.cents);
      if (!used.has(x) && i >= 0) { used.add(x); owed.splice(i, 1); }
    }
    byPeriod.set(p.n, sorted.filter((x) => !used.has(x) && x.cents > 0).filter(inPeriod(p)).reduce((n, x) => n + x.cents, 0));
  }
  return { byPeriod, lastYear, balances: [...used].filter((x) => x !== lastYear) };
}

// The year's returns with the instalments pre-filled period by period (each period's pre-fill needs the
// balances of the returns before it). Typed instalments, when given, are used as they are.
export function buildYearPrefilled(items: GstItem[], periods: Period[], quick: boolean, q: QuickSettings, payments: GstPayment[], lastYearOwingCents: number, typed?: Map<number, number>) {
  const returns: GstReturn[] = [];
  let used = 0, pre = prefillInstalments(payments, periods, lastYearOwingCents);
  for (const p of periods) {
    pre = prefillInstalments(payments, periods, lastYearOwingCents, (n) => returns.filter((r) => r.period.n < n).map((r) => r.lines["113"]));
    const r = buildReturn(items, p, quick, q, typed?.get(p.n) ?? pre.byPeriod.get(p.n) ?? 0, used);
    if (quick) used += r.eligibleCents;
    returns.push(r);
  }
  return { returns, prefill: pre };
}

// The check against the books: GST/HST payable (21500) at year end must equal the balances still owing on
// the year's returns: last year's balance, plus the net tax of the year's returns, less every payment to
// the CRA in the year (instalments and balances), plus refunds received.
export type GstCheck = { openingCents: number; netTaxCents: number; paymentsCents: number; owingCents: number; bookCents: number; diffCents: number };
export function checkAgainstBooks(openingOwingCents: number, returns: GstReturn[], payments: GstPayment[], bookOwingCents: number): GstCheck {
  const netTax = returns.reduce((n, r) => n + r.lines["109"], 0);
  const paid = payments.reduce((n, x) => n + x.cents, 0);
  const owing = openingOwingCents + netTax - paid;
  return { openingCents: openingOwingCents, netTaxCents: netTax, paymentsCents: paid, owingCents: owing, bookCents: bookOwingCents, diffCents: bookOwingCents - owing };
}
