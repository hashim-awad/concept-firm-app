// Corporate route (Phase 2 batch, sections 10 and 11): the answers, the routing, and the year-end
// price. Pure: the form, the server and the tests use the same rules. Prices come from the price
// book by code (YE-110/111/112/120/121, GST-110), never from this file.

export type Books = "bookkeeper" | "software" | "statements" | "paper";
export type CorpAnswers = {
  form: "corporate-v1";
  need: "year_end" | "monthly";
  extras: { gst: boolean; slips: boolean };
  books: Books;
  counts: { bank: number; cc: number; loc: number; loan: number; car: number }; // only for "statements"
  ye: { month: number; day: number } | null; // null = "I'm not sure"
  business: string;
  flags: { behind: boolean; multi: boolean; property: boolean; cra: boolean };
  monthly?: { revenue: "under_1m" | "1m_3m" | "3m_5m" | "over_5m"; people: "me" | "1_5" | "6_20" | "over_20"; uptodate: "yes" | "few_months" | "over_year" };
};

export const NEED = { year_end: "Year-end financial statements and tax return for my company", monthly: "Monthly bookkeeping all year, plus the year-end" };
export const BOOKS: Record<Books, string> = {
  bookkeeper: "A bookkeeper or accountant keeps them",
  software: "We keep them ourselves in accounting software, like QuickBooks or Xero",
  statements: "We don't keep books, but we have bank and credit card statements",
  paper: "We only have paper receipts",
};
export const COUNTS: [keyof CorpAnswers["counts"], string][] = [["bank", "Bank accounts"], ["cc", "Credit cards"], ["loc", "Lines of credit"], ["loan", "Bank loans"], ["car", "Car loans or leases"]];
export const FLAGS: [keyof CorpAnswers["flags"], string][] = [
  ["behind", "We are behind on our tax returns by more than one year"],
  ["multi", "We own more than one company"],
  ["property", "The company bought or sold a building, land or shares this year"],
  ["cra", "The CRA is reviewing the company"],
];
export const REVENUE = { under_1m: "Under $1 million", "1m_3m": "$1 million to $3 million", "3m_5m": "$3 million to $5 million", over_5m: "Over $5 million" };
export const PEOPLE = { me: "Just me", "1_5": "1 to 5", "6_20": "6 to 20", over_20: "More than 20" };
export const UPTODATE = { yes: "Yes, up to last month", few_months: "A few months behind", over_year: "More than a year behind" };
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Section 11 routing. Auto-price: year-end, books one of the first three answers, no box in question 7.
export function route(a: CorpAnswers): { path: "auto" | "call"; reasons: string[] } {
  const reasons: string[] = [];
  if (a.need === "monthly") reasons.push("Monthly bookkeeping all year");
  if (a.books === "paper") reasons.push("Paper receipts only");
  for (const [k, label] of FLAGS) if (a.flags[k]) reasons.push(label);
  return { path: reasons.length ? "call" : "auto", reasons };
}

export type PricedItem = { code: string; name: string; unit_label: string; amount_cents: number };
export type Line = { code: string; name: string; unit_label: string; person: null; quantity: number; unit_cents: number; total_cents: number };

const BASE: Record<Exclude<Books, "paper">, string> = { bookkeeper: "YE-110", software: "YE-111", statements: "YE-112" };

// Section 11 price. The bank-statements base includes 1 bank account and 1 credit card: each extra
// bank account, credit card or line of credit is YE-120; each bank loan or car loan or lease is YE-121.
export function priceLines(a: CorpAnswers, items: PricedItem[]): Line[] {
  if (route(a).path !== "auto" || a.books === "paper") return [];
  const by = new Map(items.map((i) => [i.code, i]));
  const line = (code: string, quantity: number): Line => {
    const i = by.get(code);
    if (!i) throw new Error(`Price book has no current price for ${code}.`);
    return { code, name: i.name, unit_label: i.unit_label, person: null, quantity, unit_cents: i.amount_cents, total_cents: i.amount_cents * quantity };
  };
  const out = [line(BASE[a.books], 1)];
  if (a.books === "statements") {
    const extra = Math.max(0, a.counts.bank - 1) + Math.max(0, a.counts.cc - 1) + a.counts.loc;
    const loans = a.counts.loan + a.counts.car;
    if (extra > 0) out.push(line("YE-120", extra));
    if (loans > 0) out.push(line("YE-121", loans));
  }
  if (a.extras.gst) out.push(line("GST-110", 1));
  return out;
}

// The year-end date for a year end in a given year, as YYYY-MM-DD.
export function yearEndDate(month: number, day: number, year: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

// Checks the answers the form sends (the server never trusts the browser).
export function checkAnswers(x: unknown): { ok: true; a: CorpAnswers } | { ok: false; error: string } {
  const a = x as CorpAnswers;
  const int = (n: unknown, max = 50) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
  if (!a || a.form !== "corporate-v1") return { ok: false, error: "Your answers could not be read." };
  if (!(a.need in NEED)) return { ok: false, error: "Choose what you need." };
  if (!(a.books in BOOKS)) return { ok: false, error: "Tell us how your company's books are kept." };
  if (a.books === "statements" && !COUNTS.every(([k]) => int(a.counts?.[k]))) return { ok: false, error: "Enter how many of each the company has (0 if none)." };
  if (a.ye !== null && !(int(a.ye?.month, 12) && a.ye.month >= 1 && int(a.ye?.day, 31) && a.ye.day >= 1)) return { ok: false, error: "Choose the year-end month and day, or tick I'm not sure." };
  if (typeof a.business !== "string" || !a.business.trim() || a.business.length > 200) return { ok: false, error: "Tell us what your company does." };
  if (a.need === "monthly" && !(a.monthly && a.monthly.revenue in REVENUE && a.monthly.people in PEOPLE && a.monthly.uptodate in UPTODATE)) return { ok: false, error: "Answer the three questions about your company's size and books." };
  return { ok: true, a: {
    form: "corporate-v1", need: a.need, extras: { gst: !!a.extras?.gst, slips: !!a.extras?.slips }, books: a.books,
    counts: a.books === "statements" ? { bank: a.counts.bank, cc: a.counts.cc, loc: a.counts.loc, loan: a.counts.loan, car: a.counts.car } : { bank: 0, cc: 0, loc: 0, loan: 0, car: 0 },
    ye: a.ye, business: a.business.trim(),
    flags: { behind: !!a.flags?.behind, multi: !!a.flags?.multi, property: !!a.flags?.property, cra: !!a.flags?.cra },
    ...(a.need === "monthly" ? { monthly: a.monthly } : {}),
  } };
}
