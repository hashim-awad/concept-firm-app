// Piece 3 of the step 5 restructure (Hashim, Nov 18, 2026; benchmark CaseWare Cloud: a working paper linked to an
// adjusting entry by its W/P reference, with calculated amounts). The Vehicle schedule for the owner's own car:
// the per-km allowance at CRA's rates (Closebook rules › CRA rates) against the business share of the car's actual
// costs (paid by the company, from the books, and by the owner, typed), and the entry that books the one used.
// Pure and tested (tests/closebook-vehicle-schedule.test.ts): the window shows it, the server works it out again
// before saving, and the PDF prints it. Amounts in cents, km in whole km, rates in cents per km.
import { formatAmount } from "./amount.ts";

export type Method = "prorated" | "detailed";
export type Choice = "higher" | "allowance" | "actual";
export type VehicleInputs = {
  method: Method;
  businessKm: number | null;         // Prorated: business km in the year
  partKm: (number | null)[];         // Detailed: business km in each calendar-year part
  alreadyKm: number | null;          // Detailed: business km already driven earlier in the first calendar year
  totalKm: number | null;            // optional: needed only for actual costs
  ownerPaid: number | null;          // car costs the owner paid personally, tax included
  ownerGst: number | null;           // the GST/HST in those costs
  choice: Choice;                    // "higher" until "Use this instead"
  itc: boolean;                      // Claim the ITC (regular registrants only)
};
// One vehicle account's company-paid costs in the year: before tax and the GST/HST posted with them.
export type CompanyAccount = { account: string; number: string; name: string; cost: number; gst: number };
export type KmRates = { year: number; first_prov: number; after_prov: number; first_terr: number; after_terr: number };
export type VehicleCtx = {
  yearStart: string; yearEnd: string;
  province: string;                  // the client's province or territory code
  rates: KmRates[];                  // dollars per km, as saved on the CRA rates page
  factor: { numerator: number; denominator: number } | null;   // the province's ITC factor
  regular: boolean;                  // registered for GST/HST on the regular method (ITC claimed)
  company: CompanyAccount[];         // empty when another Vehicle schedule takes them
  taxCode: string | null;            // the sales tax code on lines that carry GST/HST (for the GST/HST return)
};

export const TERRITORIES = ["YT", "NT", "NU"];
export const PROVINCE_NAMES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
export const BAND_KM = 5000;
export const VEHICLE_ACCOUNTS = ["70600", "70650", "67300"];   // Vehicle expenses, Vehicle repairs, Vehicle lease
export const VEHICLE_GIFI = ["9281.00", "8962.00", "8915.00"]; // the same accounts' GIFI lines (a client's own books)
export const EXPENSE_ACCOUNT = "70600", ITC_ACCOUNT = "21500", SHAREHOLDER_ACCOUNT = "23000";
export const WP_REF = "Vehicle schedule", DESCRIPTION = "Vehicle, owner's car";

// Half up, for whole numbers (km or cents) times a fraction: round(a × b ÷ c), exact.
export function mulDiv(a: number, b: number, c: number): number {
  const n = BigInt(Math.round(a)) * BigInt(Math.round(b)), d = BigInt(Math.round(c));
  const neg = (n < BigInt(0)) !== (d < BigInt(0));
  const an = n < BigInt(0) ? -n : n, ad = d < BigInt(0) ? -d : d;
  const q = (BigInt(2) * an + ad) / (BigInt(2) * ad);
  return Number(neg ? -q : q);
}

// ---------- The year's calendar-year parts.
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNo = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (s: string, withYear = true) => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}${withYear ? `, ${s.slice(0, 4)}` : ""}`;

export type YearPart = { year: number; start: string; end: string; units: number; label: string };
// Split by month when the year starts on the 1st of a month and ends on a month's last day; otherwise by days.
export function yearParts(start: string, end: string) {
  const byMonth = +start.slice(8, 10) === 1 && +end.slice(8, 10) === daysIn(+end.slice(0, 4), +end.slice(5, 7));
  const parts: YearPart[] = [];
  for (let y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) {
    const s = y === +start.slice(0, 4) ? start : iso(y, 1, 1), e = y === +end.slice(0, 4) ? end : iso(y, 12, 31);
    const units = byMonth ? +e.slice(5, 7) - +s.slice(5, 7) + 1 : dayNo(e) - dayNo(s) + 1;
    parts.push({ year: y, start: s, end: e, units, label: `${shortDate(s, false)} to ${shortDate(e)}` });
  }
  // Km already driven earlier in the first calendar year: Jan 1 to the day before the year starts.
  const before = byMonth ? +start.slice(5, 7) - 1 : dayNo(start) - dayNo(iso(+start.slice(0, 4), 1, 1));
  const dayBefore = new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10) - 1)).toISOString().slice(0, 10);
  return { parts, byMonth, before, total: parts.reduce((n, p) => n + p.units, 0), startsJan1: before === 0,
    beforeLabel: before > 0 ? `Jan 1 to ${shortDate(dayBefore)}` : "" };
}

// ---------- The calculation.
export type PartRow = { year: number; label: string; km: number; firstKm: number; afterKm: number; first: number; after: number; amount: number; already: number };
export type SchedLine = {
  part: string;                       // the schedule part, kept on the entry line (the Schedule tag)
  chart?: string; account?: string;   // a standard chart account, or a file account id (company-paid lines)
  number: string; name: string;
  amount: number;                     // cents: debit positive, credit negative
  memo: string; tax_code?: string; is_tax?: boolean;
};
export type Problem = { field: "business" | "total" | "ownerGst" | "rates" | "factor" | "km"; text: string; hard: boolean };
export type VehicleResult = {
  parts: PartRow[]; byMonth: boolean; alreadyKm: number; businessKm: number;
  allowance: number | null; itc: number;
  company: { cost: number; gst: number; total: number };
  share: number | null;               // business ÷ total km, null when total km is not typed
  sharePct: string;                   // "60.00%"
  actual: number | null;
  higher: "allowance" | "actual"; used: "allowance" | "actual";
  lines: SchedLine[]; debits: number;
  problems: Problem[]; ready: boolean;
  working: string[];
};

const kmText = (n: number) => n.toLocaleString("en-CA");
const rateText = (c: number) => (c / 100).toFixed(2);
const nameOf: Record<string, string> = { "70600": "Vehicle expenses", "21500": "GST/HST payable", "23000": "Due to shareholder" };

export function calcVehicle(inp: VehicleInputs, ctx: VehicleCtx, names: Record<string, string> = nameOf): VehicleResult {
  const y = yearParts(ctx.yearStart, ctx.yearEnd);
  const problems: Problem[] = [];
  const terr = TERRITORIES.includes(ctx.province);
  // Business km per part, and km already driven before the year started.
  let partKm: number[], already: number;
  if (inp.method === "prorated") {
    const b = Math.max(0, Math.round(inp.businessKm ?? 0));
    let given = 0;
    partKm = y.parts.map((p, i) => { const k = i === y.parts.length - 1 ? b - given : mulDiv(b, p.units, y.total); given += k; return k; });
    already = y.before > 0 ? mulDiv(b, y.before, y.total) : 0;
  } else {
    partKm = y.parts.map((_, i) => Math.max(0, Math.round(inp.partKm[i] ?? 0)));
    already = y.before > 0 ? Math.max(0, Math.round(inp.alreadyKm ?? 0)) : 0;
  }
  const business = partKm.reduce((n, k) => n + k, 0);
  // The allowance per calendar-year part: the first 5,000 km of that calendar year at the first rate.
  const missing: number[] = [];
  const parts: PartRow[] = y.parts.map((p, i) => {
    const r = ctx.rates.find((x) => x.year === p.year);
    if (!r && partKm[i] > 0) missing.push(p.year);
    const first = r ? Math.round((terr ? r.first_terr : r.first_prov) * 100) : 0, after = r ? Math.round((terr ? r.after_terr : r.after_prov) * 100) : 0;
    const before = i === 0 ? already : 0;
    const firstKm = Math.min(partKm[i], Math.max(0, BAND_KM - before)), afterKm = partKm[i] - firstKm;
    return { year: p.year, label: p.label, km: partKm[i], firstKm, afterKm, first, after, amount: firstKm * first + afterKm * after, already: before };
  });
  for (const yr of missing) problems.push({ field: "rates", text: `Enter the ${yr} rates in Closebook rules › CRA rates.`, hard: true });
  const province = PROVINCE_NAMES[ctx.province] ?? ctx.province;
  if (ctx.regular && !ctx.factor) problems.push({ field: "factor", text: `Enter the ITC factor for ${province} in Closebook rules › CRA rates.`, hard: true });
  const total = inp.totalKm !== null && inp.totalKm > 0 ? Math.round(inp.totalKm) : null;
  if (total !== null && business > total) problems.push({ field: "business", text: "Business km can't be more than total km.", hard: true });
  const ownerPaid = Math.max(0, inp.ownerPaid ?? 0), ownerGst = ctx.regular ? Math.max(0, inp.ownerGst ?? 0) : 0;
  if (ownerGst > ownerPaid) problems.push({ field: "ownerGst", text: "The GST/HST can't be more than the costs the owner paid.", hard: true });
  if (total === null && (ownerPaid > 0 || ownerGst > 0)) problems.push({ field: "total", text: "Enter total km to compare actual costs.", hard: false });
  if (business <= 0) problems.push({ field: "km", text: "Enter the business km.", hard: true });

  const allowance = missing.length ? null : parts.reduce((n, p) => n + p.amount, 0);
  const company = { cost: ctx.company.reduce((n, a) => n + a.cost, 0), gst: ctx.regular ? ctx.company.reduce((n, a) => n + a.gst, 0) : 0, total: 0 };
  company.total = company.cost + company.gst;
  const ok = total !== null && business <= total;
  const actual = ok ? mulDiv(business, company.total + ownerPaid, total!) : null;
  const share = ok ? business / total! : null;
  const sharePct = ok ? `${(mulDiv(business, 10000, total!) / 100).toFixed(2)}%` : "";
  const higher: "allowance" | "actual" = actual !== null && (allowance === null || actual > allowance) ? "actual" : "allowance";
  const used: "allowance" | "actual" = inp.choice === "higher" ? higher : inp.choice === "actual" && actual !== null ? "actual" : "allowance";

  // ---------- The entry lines.
  const claim = ctx.regular && inp.itc && !!ctx.factor;
  const code = ctx.taxCode ?? undefined;
  const lines: SchedLine[] = [];
  const add = (l: SchedLine) => { if (l.amount) lines.push(l); };
  const std = (n: string) => ({ chart: n, number: n, name: names[n] ?? nameOf[n] ?? n });
  if (used === "allowance" && allowance) {
    const itc = claim ? mulDiv(allowance, ctx.factor!.numerator, ctx.factor!.denominator) : 0;
    add({ part: "allowance", ...std(EXPENSE_ACCOUNT), amount: allowance - itc, memo: "Per-km allowance", ...(itc && code ? { tax_code: code } : {}) });
    add({ part: "allowance_itc", ...std(ITC_ACCOUNT), amount: itc, memo: "ITC on the per-km allowance", is_tax: true });
    add({ part: "allowance_due", ...std(SHAREHOLDER_ACCOUNT), amount: -allowance, memo: "Per-km allowance owed to the owner" });
    // Every cost the company paid is the owner's own: to the shareholder account.
    const credits = ctx.company.map((a) => ({ a, c: a.cost })).filter((x) => x.c);
    const gst = company.gst;
    add({ part: "company_due", ...std(SHAREHOLDER_ACCOUNT), amount: credits.reduce((n, x) => n + x.c, 0) + gst, memo: "Car costs the company paid: the owner's" });
    for (const { a, c } of credits) add({ part: `company_cost:${a.account}`, account: a.account, number: a.number, name: a.name, amount: -c, memo: "Car costs the company paid", ...(ctx.regular && a.gst && code ? { tax_code: code } : {}) });
    add({ part: "company_gst", ...std(ITC_ACCOUNT), amount: -gst, memo: "GST/HST on car costs the company paid", is_tax: true });
  }
  if (used === "actual" && actual !== null) {
    // The business share of the costs the owner paid.
    const net = claim ? ownerPaid - ownerGst : ownerPaid;
    const exp = mulDiv(business, net, total!), itc = claim ? mulDiv(business, ownerGst, total!) : 0;
    add({ part: "owner", ...std(EXPENSE_ACCOUNT), amount: exp, memo: `Car costs the owner paid, business share ${sharePct}`, ...(itc && code ? { tax_code: code } : {}) });
    add({ part: "owner_itc", ...std(ITC_ACCOUNT), amount: itc, memo: "ITC on the business share", is_tax: true });
    add({ part: "owner_due", ...std(SHAREHOLDER_ACCOUNT), amount: -(exp + itc), memo: "Car costs the owner paid, business share" });
    // The personal share of the costs the company paid.
    const personal = total! - business;
    const credits = ctx.company.map((a) => ({ a, c: mulDiv(personal, a.cost, total!) })).filter((x) => x.c);
    const gst = ctx.regular ? mulDiv(personal, company.gst, total!) : 0;
    add({ part: "personal_due", ...std(SHAREHOLDER_ACCOUNT), amount: credits.reduce((n, x) => n + x.c, 0) + gst, memo: "Car costs the company paid, personal share" });
    for (const { a, c } of credits) add({ part: `personal_cost:${a.account}`, account: a.account, number: a.number, name: a.name, amount: -c, memo: "Car costs the company paid, personal share", ...(ctx.regular && a.gst && code ? { tax_code: code } : {}) });
    add({ part: "personal_gst", ...std(ITC_ACCOUNT), amount: -gst, memo: "GST/HST on the personal share", is_tax: true });
  }
  const debits = lines.reduce((n, l) => n + (l.amount > 0 ? l.amount : 0), 0);
  const itcShown = lines.filter((l) => l.part === "allowance_itc" || l.part === "owner_itc").reduce((n, l) => n + l.amount, 0);

  // ---------- The working, in small grey lines.
  const working = parts.filter((p) => p.km || parts.length === 1).map((p) => {
    const bits = [p.firstKm ? `${kmText(p.firstKm)} km × ${rateText(p.first)}` : "", p.afterKm ? `${kmText(p.afterKm)} km × ${rateText(p.after)}` : ""].filter(Boolean);
    const pre = p.already ? ` (after ${kmText(p.already)} km already driven)` : "";
    return `${p.year}, ${p.label}${pre}: ${bits.join(" + ") || "0 km"} = ${formatAmount(p.amount)}`;
  });
  if (allowance !== null) working.push(`Per-km allowance: ${formatAmount(allowance)}${claim && used === "allowance" ? ` (ITC ${formatAmount(itcShown)})` : ""}`);
  working.push(actual === null ? "Actual costs: not entered (total km needed)"
    : `Actual costs: ${sharePct} (${kmText(business)} ÷ ${kmText(total!)} km) × (${formatAmount(company.total)} company paid + ${formatAmount(ownerPaid)} owner paid) = ${formatAmount(actual)}`);

  const hard = problems.some((p) => p.hard);
  return {
    parts, byMonth: y.byMonth, alreadyKm: already, businessKm: business, allowance, itc: itcShown, company, share, sharePct, actual, higher, used,
    lines, debits, problems, ready: !hard && lines.length >= 2, working,
  };
}

// ---------- The schedule as stored with its entry.
// What the schedule was calculated with: kept, so later changes to the CRA rates or the books change nothing.
export type VehicleSnapshot = {
  province: string; regular: boolean; factor: { numerator: number; denominator: number } | null; taxCode: string | null;
  rates: KmRates[]; company: CompanyAccount[]; companyIn: string;   // companyIn: "in the first car's schedule (2026-003 AJE)"
};
export const emptyInputs = (): VehicleInputs => ({ method: "prorated", businessKm: null, partKm: [], alreadyKm: null, totalKm: null, ownerPaid: null, ownerGst: null, choice: "higher", itc: true });

// History: each input changed, in words ("Business km in the year: 12,000 → 10,000").
const show = (v: number | null | undefined, money = false) => (v === null || v === undefined ? "empty" : money ? formatAmount(v) : kmText(v));
export function inputChanges(was: VehicleInputs, now: VehicleInputs, yearStart: string, yearEnd: string) {
  const y = yearParts(yearStart, yearEnd);
  const out: { what: string; old: string; new: string }[] = [];
  if (was.method !== now.method) out.push({ what: "Method", old: methodName(was.method), new: methodName(now.method) });
  const pairs: [string, number | null, number | null, boolean][] = [
    ["Business km in the year", was.method === "prorated" ? was.businessKm : null, now.method === "prorated" ? now.businessKm : null, false],
    ...y.parts.map((p, i) => [`Business km, ${p.label}`, was.method === "detailed" ? was.partKm[i] ?? null : null, now.method === "detailed" ? now.partKm[i] ?? null : null, false] as [string, number | null, number | null, boolean]),
    ["Business km already driven", was.method === "detailed" ? was.alreadyKm : null, now.method === "detailed" ? now.alreadyKm : null, false],
    ["Total km in the year", was.totalKm, now.totalKm, false],
    ["Car costs the owner paid personally", was.ownerPaid, now.ownerPaid, true],
    ["GST/HST in those costs", was.ownerGst, now.ownerGst, true],
  ];
  for (const [what, a, b, money] of pairs) if ((a ?? null) !== (b ?? null)) out.push({ what, old: show(a, money), new: show(b, money) });
  if (was.choice !== now.choice) out.push({ what: "Used", old: choiceName(was.choice), new: choiceName(now.choice) });
  return out;
}
export const methodName = (m: Method) => (m === "prorated" ? "Prorated" : "Detailed");
export const choiceName = (c: Choice) => (c === "higher" ? "The higher one" : c === "allowance" ? "Per-km allowance" : "Actual costs");

// Reading what the window sends: whole km and cents, never negative.
export function readInputs(raw: unknown): VehicleInputs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  return {
    method: r.method === "detailed" ? "detailed" : "prorated",
    businessKm: num(r.businessKm), partKm: Array.isArray(r.partKm) ? r.partKm.slice(0, 5).map(num) : [], alreadyKm: num(r.alreadyKm),
    totalKm: num(r.totalKm), ownerPaid: num(r.ownerPaid), ownerGst: num(r.ownerGst),
    choice: r.choice === "allowance" || r.choice === "actual" ? r.choice : "higher", itc: r.itc !== false,
  };
}
