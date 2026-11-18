// Piece 4 (Hashim, Nov 18, 2026, version 2; benchmark CaseWare Cloud: a working paper that calculates amounts and
// fills its adjusting entry). The Home office schedule: the business share of the home costs the owner paid, the ITC
// on the GST/HST in them, and the entry that books both and what is owed to the owner. Pure and tested
// (tests/closebook-home-office.test.ts): the window shows it, the server works it out again before saving, the PDF
// prints it. Amounts in cents; the maths is done on the totals, so cents never drift.
import { formatAmount } from "./amount.ts";
import { mulDiv, PROVINCE_NAMES, type SchedLine } from "./vehicle-schedule.ts";

export const HOME_EXPENSE = "65100", ITC_ACCOUNT = "21500", SHAREHOLDER_ACCOUNT = "23000";
export const HOME_WP_REF = "Home office schedule", HOME_DESCRIPTION = "Home office";
export type CostKey = "heat" | "electricity" | "water" | "insurance" | "property_tax" | "mortgage_interest" | "rent" | "repairs" | "other";
// The nine fixed rows. auto: GST/HST fills itself (Ontario and Alberta); none: it reads "none"; typed: the preparer types it.
export const COST_ROWS: { key: CostKey; label: string; gst: "auto" | "none" | "typed" }[] = [
  { key: "heat", label: "Heat", gst: "auto" }, { key: "electricity", label: "Electricity", gst: "auto" },
  { key: "water", label: "Water", gst: "none" }, { key: "insurance", label: "Home insurance", gst: "none" },
  { key: "property_tax", label: "Property tax", gst: "none" }, { key: "mortgage_interest", label: "Mortgage interest", gst: "none" },
  { key: "rent", label: "Rent", gst: "none" }, { key: "repairs", label: "Repairs and maintenance", gst: "auto" },
  { key: "other", label: "Other", gst: "typed" },
];
// GST/HST fills itself only where the amount paid holds no provincial sales tax of its own and the factor applies.
export const AUTO_GST_PROVINCES = ["ON", "AB"];

export type HomeCost = { paid: number | null; gst: number | null };   // gst null: the default (filled, "none" or empty)
export type HomeInputs = {
  mode: "area" | "pct";
  homeSqft: number | null; officeSqft: number | null;
  pctBp: number | null;                 // "Type the % instead": the share in hundredths of a percent (12.50% = 1250)
  costs: Partial<Record<CostKey, HomeCost>>;
  itc: boolean;
  paidTo?: string | null;
};
export type HomeCtx = {
  province: string; regular: boolean;
  factor: { numerator: number; denominator: number } | null;
  taxCode: string | null;
  payees?: { id: string; name: string }[];
  bnMissing?: boolean;
};
export type HomeProblem = { field: "area" | "pct" | "factor" | "paidTo" | "bn" | "share" | "paid" | CostKey; text: string; hard: boolean };
export type HomeRow = { key: CostKey; label: string; paid: number; gst: number; gstText: string; typedGst: boolean; business: number };
export type HomeResult = {
  shareNum: number; shareDen: number; sharePct: string;   // the share as a fraction, and "10.00%"
  rows: HomeRow[]; totalPaid: number; totalGst: number; totalBusiness: number;
  expense: number; itc: number; owed: number; claim: boolean;
  lines: SchedLine[]; record: { amount: number; gst: number; claim: boolean; payee: { id: string; name: string } | null };
  working: string; problems: HomeProblem[]; ready: boolean;
};

export const emptyHomeInputs = (): HomeInputs => ({ mode: "area", homeSqft: null, officeSqft: null, pctBp: null, costs: {}, itc: true, paidTo: null });
const pct = (num: number, den: number) => `${(mulDiv(num, 10000, den) / 100).toFixed(2)}%`;

// The GST/HST a row holds when nothing was typed.
export function defaultGst(row: (typeof COST_ROWS)[number], paid: number, ctx: HomeCtx): number | null {
  if (row.gst === "none") return 0;
  if (row.gst === "auto" && AUTO_GST_PROVINCES.includes(ctx.province) && ctx.factor && paid) return mulDiv(paid, ctx.factor.numerator, ctx.factor.denominator);
  return null;   // empty: the preparer types it
}

export function calcHome(inp: HomeInputs, ctx: HomeCtx, names: Record<string, string> = {}): HomeResult {
  const problems: HomeProblem[] = [];
  // The business share, as a fraction.
  let shareNum = 0, shareDen = 1;
  if (inp.mode === "pct") {
    if (inp.pctBp !== null && inp.pctBp > 10000) problems.push({ field: "pct", text: "The business share can't be more than 100%.", hard: true });
    else if (inp.pctBp) { shareNum = inp.pctBp; shareDen = 10000; }
  } else {
    const home = inp.homeSqft ?? 0, office = inp.officeSqft ?? 0;
    if (home > 0 && office > home) problems.push({ field: "area", text: "Office area can't be more than home area.", hard: true });
    else if (home > 0 && office > 0) { shareNum = office; shareDen = home; }
  }
  const gstOn = ctx.regular;   // not registered or quick method: no GST/HST IN IT column
  const rows: HomeRow[] = COST_ROWS.map((r) => {
    const c = inp.costs[r.key] ?? { paid: null, gst: null };
    const paid = Math.max(0, c.paid ?? 0);
    const dflt = defaultGst(r, paid, ctx);
    const gst = gstOn ? Math.max(0, c.gst ?? dflt ?? 0) : 0;
    if (gstOn && gst > paid) problems.push({ field: r.key, text: "GST/HST can't be more than the amount paid.", hard: true });
    const gstText = !gstOn ? "" : c.gst !== null && c.gst !== undefined ? formatAmount(gst) : dflt === null ? "" : r.gst === "none" ? "none" : formatAmount(gst);
    return { key: r.key, label: r.label, paid, gst, gstText, typedGst: c.gst !== null && c.gst !== undefined, business: mulDiv(shareNum, paid, shareDen) };
  });
  const totalPaid = rows.reduce((n, r) => n + r.paid, 0), totalGst = rows.reduce((n, r) => n + r.gst, 0);
  if (ctx.regular && !ctx.factor) problems.push({ field: "factor", text: `Enter the ITC factor for ${PROVINCE_NAMES[ctx.province] ?? ctx.province} in Closebook rules › CRA rates.`, hard: true });
  if (!shareNum && !problems.some((p) => p.field === "area" || p.field === "pct")) problems.push({ field: "share", text: inp.mode === "pct" ? "Enter the business share." : "Enter the home and office areas.", hard: true });
  if (!totalPaid) problems.push({ field: "paid", text: "Enter the amounts paid.", hard: true });

  // Maths on the totals.
  const claim = ctx.regular && inp.itc && !!ctx.factor;
  const expense = claim ? mulDiv(shareNum, totalPaid - totalGst, shareDen) : mulDiv(shareNum, totalPaid, shareDen);
  const itc = claim ? mulDiv(shareNum, totalGst, shareDen) : 0;
  const owed = expense + itc;
  const sharePct = shareNum ? pct(shareNum, shareDen) : "";

  // Who was paid, and the GST/HST number: only where the GST/HST record prints (version 2b, as the vehicle schedule).
  let payee: { id: string; name: string } | null = null;
  const prints = ctx.regular && inp.itc;
  if (ctx.payees && prints) {
    if (ctx.payees.length === 0) problems.push({ field: "paidTo", text: "Link the shareholder to the client record first.", hard: true });
    else if (ctx.payees.length === 1) payee = ctx.payees[0];
    else {
      payee = ctx.payees.find((p) => p.id === inp.paidTo) ?? null;
      if (!payee) problems.push({ field: "paidTo", text: "Choose who was paid.", hard: true });
    }
  }
  if (ctx.bnMissing && prints) problems.push({ field: "bn", text: "Add the business number to the client record first.", hard: true });

  const nm = (n: string, d: string) => names[n] ?? d;
  const lines: SchedLine[] = [];
  const code = ctx.taxCode ?? undefined;
  if (expense) lines.push({ part: "home", chart: HOME_EXPENSE, number: HOME_EXPENSE, name: nm(HOME_EXPENSE, "Office expenses"), amount: expense,
    memo: `Home office, business share ${sharePct}`, ...(itc && code ? { tax_code: code } : {}) });
  if (itc) lines.push({ part: "home_itc", chart: ITC_ACCOUNT, number: ITC_ACCOUNT, name: nm(ITC_ACCOUNT, "GST/HST payable"), amount: itc, memo: "ITC on the business share", is_tax: true });
  if (owed) lines.push({ part: "home_due", chart: SHAREHOLDER_ACCOUNT, number: SHAREHOLDER_ACCOUNT, name: nm(SHAREHOLDER_ACCOUNT, "Due to shareholder"), amount: -owed, memo: "Home office costs owed to the owner" });

  const working = !shareNum ? "" : claim
    ? `Expense ${sharePct} of ${formatAmount(totalPaid - totalGst)} before tax = ${formatAmount(expense)} · ITC ${sharePct} of ${formatAmount(totalGst)} = ${formatAmount(itc)} · Owed to the owner ${formatAmount(owed)}`
    : `Expense ${sharePct} of ${formatAmount(totalPaid)} = ${formatAmount(expense)} · Owed to the owner ${formatAmount(owed)}`;
  const hard = problems.some((p) => p.hard);
  return {
    shareNum, shareDen, sharePct, rows, totalPaid, totalGst, totalBusiness: rows.reduce((n, r) => n + r.business, 0),
    expense, itc, owed, claim, lines, record: { amount: owed, gst: itc, claim, payee }, working, problems, ready: !hard && lines.length >= 2,
  };
}

export const HOME_NATURE = "Reimbursement of the business share of home costs the owner paid. ITC under ETA s.175 on the GST/HST shown on the owner's bills.";

// History: each input changed, in words.
export function homeChanges(was: HomeInputs, now: HomeInputs, people: Record<string, string> = {}) {
  const out: { what: string; old: string; new: string }[] = [];
  const v = (n: number | null | undefined, money = false) => (n === null || n === undefined ? "empty" : money ? formatAmount(n) : n.toLocaleString("en-CA"));
  if (was.mode !== now.mode) out.push({ what: "Business share", old: was.mode === "area" ? "From the areas" : "Typed %", new: now.mode === "area" ? "From the areas" : "Typed %" });
  if ((was.homeSqft ?? null) !== (now.homeSqft ?? null)) out.push({ what: "Home area (sq ft)", old: v(was.homeSqft), new: v(now.homeSqft) });
  if ((was.officeSqft ?? null) !== (now.officeSqft ?? null)) out.push({ what: "Office area (sq ft)", old: v(was.officeSqft), new: v(now.officeSqft) });
  if ((was.pctBp ?? null) !== (now.pctBp ?? null)) out.push({ what: "Business share (%)", old: was.pctBp == null ? "empty" : `${(was.pctBp / 100).toFixed(2)}%`, new: now.pctBp == null ? "empty" : `${(now.pctBp / 100).toFixed(2)}%` });
  for (const r of COST_ROWS) {
    const a = was.costs[r.key] ?? { paid: null, gst: null }, b = now.costs[r.key] ?? { paid: null, gst: null };
    if ((a.paid ?? null) !== (b.paid ?? null)) out.push({ what: `${r.label}, amount paid`, old: v(a.paid, true), new: v(b.paid, true) });
    if ((a.gst ?? null) !== (b.gst ?? null)) out.push({ what: `${r.label}, GST/HST`, old: a.gst == null ? "as filled" : v(a.gst, true), new: b.gst == null ? "as filled" : v(b.gst, true) });
  }
  if ((was.paidTo ?? null) !== (now.paidTo ?? null)) out.push({ what: "Paid to", old: was.paidTo ? people[was.paidTo] ?? "someone no longer linked" : "empty", new: now.paidTo ? people[now.paidTo] ?? "" : "empty" });
  return out;
}

export function readHomeInputs(raw: unknown): HomeInputs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  const costs: Partial<Record<CostKey, HomeCost>> = {};
  const rc = (r.costs ?? {}) as Record<string, { paid?: unknown; gst?: unknown }>;
  for (const row of COST_ROWS) { const c = rc[row.key]; if (c) costs[row.key] = { paid: num(c.paid), gst: num(c.gst) }; }
  return {
    mode: r.mode === "pct" ? "pct" : "area", homeSqft: num(r.homeSqft), officeSqft: num(r.officeSqft), pctBp: num(r.pctBp), costs, itc: r.itc !== false,
    paidTo: typeof r.paidTo === "string" && /^[0-9a-f-]{36}$/.test(r.paidTo) ? r.paidTo : null,
  };
}
