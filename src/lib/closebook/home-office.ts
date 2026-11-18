// Piece 4 (Hashim, Nov 18, 2026, version 2; benchmark CaseWare Cloud: a working paper that calculates amounts and
// fills its adjusting entry). The Home office schedule: the business share of the home costs the owner paid, the ITC
// on the GST/HST in them, and the entry that books both and what is owed to the owner. Pure and tested
// (tests/closebook-home-office.test.ts): the window shows it, the server works it out again before saving, the PDF
// prints it. Amounts in cents; the maths is done on the totals, so cents never drift.
import { formatAmount } from "./amount.ts";
import { mulDiv, PROVINCE_NAMES, type SchedLine } from "./vehicle-schedule.ts";

export const HOME_EXPENSE = "65100", ITC_ACCOUNT = "21500", SHAREHOLDER_ACCOUNT = "23000";
export const HOME_WP_REF = "Home office schedule", HOME_DESCRIPTION = "Home office";
// Piece 4c (Hashim, Nov 18, 2026): the rows of the client's home office form, in its order. auto: GST/HST fills itself
// (Ontario and Alberta); none: it reads "none"; typed: the preparer types it. office: repairs to the office only, 100% business.
export type CostKey = "rent" | "mortgage_interest" | "property_tax" | "repairs" | "office_repairs" | "insurance" | "condo_fees" | "utilities" | "water"
  | "internet_phone" | "security" | "other";
type LegacyKey = "heat" | "electricity";   // piece 4 rows, read from schedules saved before piece 4c
type Row = { key: CostKey | LegacyKey; label: string; gst: "auto" | "none" | "typed"; office?: boolean };
export const COST_ROWS: (Row & { key: CostKey })[] = [
  { key: "rent", label: "Rent", gst: "none" }, { key: "mortgage_interest", label: "Interest on mortgage", gst: "none" },
  { key: "property_tax", label: "Property tax", gst: "none" }, { key: "repairs", label: "General repairs and maintenance", gst: "auto" },
  { key: "office_repairs", label: "Repairs to the office only", gst: "auto", office: true }, { key: "insurance", label: "Home insurance", gst: "none" },
  { key: "condo_fees", label: "Condominium fees", gst: "none" }, { key: "utilities", label: "Electricity and heat", gst: "auto" },
  { key: "water", label: "Water and sewer", gst: "none" }, { key: "internet_phone", label: "Home internet and phone", gst: "auto" },
  { key: "security", label: "Security system fees", gst: "auto" }, { key: "other", label: "Other", gst: "typed" },
];
const LEGACY_ROWS: Row[] = [{ key: "heat", label: "Heat", gst: "auto" }, { key: "electricity", label: "Electricity", gst: "auto" }];
// GST/HST fills itself only where the amount paid holds no provincial sales tax of its own and the factor applies.
export const AUTO_GST_PROVINCES = ["ON", "AB"];

export type HomeCost = { paid: number | null; gst: number | null };   // gst null: the default (filled, "none" or empty)
export type HomeInputs = {
  mode: "area" | "pct";
  homeSqft: number | null; officeSqft: number | null;
  pctBp: number | null;                 // "Type the % instead": the share in hundredths of a percent (12.50% = 1250)
  costs: Partial<Record<CostKey | LegacyKey, HomeCost>>;
  itc: boolean;
  paidTo?: string | null;
};
export type HomeCtx = {
  province: string; regular: boolean;
  factor: { numerator: number; denominator: number } | null;
  taxCode: string | null;
  payee?: { id: string; name: string } | null;   // the Signing officer, "Name, Title"; null: none on the client record
  bnMissing?: boolean;
};
export type HomeProblem = { field: "area" | "pct" | "factor" | "paidTo" | "bn" | "share" | "paid" | CostKey; text: string; hard: boolean };
export type HomeRow = { key: CostKey; label: string; office: boolean; paid: number; gst: number; gstText: string; typedGst: boolean; business: number };
export type HomeResult = {
  shareNum: number; shareDen: number; sharePct: string;   // the share as a fraction, and "10.00%"
  rows: HomeRow[]; totalPaid: number; totalGst: number; totalBusiness: number;
  expense: number; itc: number; owed: number; claim: boolean;
  lines: SchedLine[]; record: { amount: number; gst: number; claim: boolean; payee: { id: string; name: string } | null };
  working: string; problems: HomeProblem[]; ready: boolean;
};

export const emptyHomeInputs = (): HomeInputs => ({ mode: "area", homeSqft: null, officeSqft: null, pctBp: null, costs: {}, itc: true, paidTo: null });
// Piece 4c: two decimals when the share is exact to two, else four (15.3846%). The maths always uses the full share.
const pct = (num: number, den: number) => ((num * 10000) % den === 0 ? `${(mulDiv(num, 10000, den) / 100).toFixed(2)}%` : `${(mulDiv(num, 1000000, den) / 10000).toFixed(4)}%`);

// The GST/HST a row holds when nothing was typed.
export function defaultGst(row: Row, paid: number, ctx: HomeCtx): number | null {
  if (row.gst === "none") return 0;
  if (row.gst === "auto" && AUTO_GST_PROVINCES.includes(ctx.province) && ctx.factor && paid) return mulDiv(paid, ctx.factor.numerator, ctx.factor.denominator);
  return null;   // empty: the preparer types it
}

// Piece 4c: a schedule saved with the piece 4 rows, read with the new ones. Heat and Electricity add into "Electricity and
// heat" (paid added; GST/HST added, each as it was filled or typed, so the totals and the entry stay exactly as saved).
// Water, Repairs and maintenance and the other rows keep their keys (only their labels changed). Nothing is written back.
export function upgradeHomeInputs(inp: HomeInputs, ctx: HomeCtx): HomeInputs {
  const { heat, electricity, ...rest } = inp.costs;
  if (!heat && !electricity) return inp;
  const parts = [[LEGACY_ROWS[0], heat], [LEGACY_ROWS[1], electricity]] as const;
  const paidOf = (c?: HomeCost) => Math.max(0, c?.paid ?? 0);
  const paid = parts.some(([, c]) => c?.paid != null) ? parts.reduce((n, [, c]) => n + paidOf(c), 0) : null;
  const typed = parts.some(([, c]) => c?.gst != null);
  const each = parts.map(([r, c]) => (c?.gst != null ? Math.max(0, c.gst) : defaultGst(r, paidOf(c), ctx)));
  const sum = each.reduce<number>((n, g) => n + (g ?? 0), 0);
  // Left as filled when filling the added amount gives the same GST/HST; otherwise the sum, as if typed.
  const filled = defaultGst(COST_ROWS.find((r) => r.key === "utilities")!, paid ?? 0, ctx);
  const gst = !typed && each.every((g) => g === null) ? null : !typed && filled === sum ? null : sum;
  return { ...inp, costs: { ...rest, utilities: { paid, gst } } };
}

export function calcHome(inp0: HomeInputs, ctx: HomeCtx, names: Record<string, string> = {}): HomeResult {
  const inp = upgradeHomeInputs(inp0, ctx);
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
    return { key: r.key, label: r.label, office: !!r.office, paid, gst, gstText, typedGst: c.gst !== null && c.gst !== undefined,
      business: r.office ? paid : mulDiv(shareNum, paid, shareDen) };
  });
  const totalPaid = rows.reduce((n, r) => n + r.paid, 0), totalGst = rows.reduce((n, r) => n + r.gst, 0);
  const shareRows = rows.filter((r) => !r.office), off = rows.find((r) => r.office)!;
  const sharePaid = shareRows.reduce((n, r) => n + r.paid, 0), shareGst = shareRows.reduce((n, r) => n + r.gst, 0);
  if (ctx.regular && !ctx.factor) problems.push({ field: "factor", text: `Enter the ITC factor for ${PROVINCE_NAMES[ctx.province] ?? ctx.province} in Closebook rules › CRA rates.`, hard: true });
  if (!shareNum && !problems.some((p) => p.field === "area" || p.field === "pct")) problems.push({ field: "share", text: inp.mode === "pct" ? "Enter the business share." : "Enter the home and office areas.", hard: true });
  if (!totalPaid) problems.push({ field: "paid", text: "Enter the amounts paid.", hard: true });

  // Maths on the totals: the office share on the shared rows, 100% on the office-only row.
  const claim = ctx.regular && inp.itc && !!ctx.factor;
  const shareExp = claim ? mulDiv(shareNum, sharePaid - shareGst, shareDen) : mulDiv(shareNum, sharePaid, shareDen);
  const shareItc = claim ? mulDiv(shareNum, shareGst, shareDen) : 0;
  const offExp = claim ? off.paid - off.gst : off.paid, offItc = claim ? off.gst : 0;
  const expense = shareExp + offExp, itc = shareItc + offItc;
  const owed = expense + itc;
  const sharePct = shareNum ? pct(shareNum, shareDen) : "";
  // Piece 4c: the BUSINESS column totals exactly "Owed to the owner"; a rounding difference goes on the largest row.
  const used = rows.filter((r) => r.paid);
  if (shareNum && used.length) {
    const diff = owed - used.reduce((n, r) => n + r.business, 0);
    if (diff) used.reduce((a, b) => (b.business > a.business ? b : a)).business += diff;
  }

  // Who was paid, and the GST/HST number: only where the GST/HST record prints (version 2b, as the vehicle schedule).
  let payee: { id: string; name: string } | null = null;
  const prints = ctx.regular && inp.itc;
  // Piece 4: Paid to is the client record's Signing officer with their Signer title (CaseWare takes the person from the client profile).
  if (ctx.payee !== undefined && prints) {
    if (ctx.payee) payee = ctx.payee;
    else problems.push({ field: "paidTo", text: "Add the signing officer to the client record first.", hard: true });
  }
  if (ctx.bnMissing && prints) problems.push({ field: "bn", text: "Add the business number to the client record first.", hard: true });

  const nm = (n: string, d: string) => names[n] ?? d;
  const lines: SchedLine[] = [];
  const code = ctx.taxCode ?? undefined;
  if (expense) lines.push({ part: "home", chart: HOME_EXPENSE, number: HOME_EXPENSE, name: nm(HOME_EXPENSE, "Office expenses"), amount: expense,
    memo: `Home office, business share ${sharePct}`, ...(itc && code ? { tax_code: code } : {}) });
  if (itc) lines.push({ part: "home_itc", chart: ITC_ACCOUNT, number: ITC_ACCOUNT, name: nm(ITC_ACCOUNT, "GST/HST payable"), amount: itc, memo: "ITC on the business share", is_tax: true });
  if (owed) lines.push({ part: "home_due", chart: SHAREHOLDER_ACCOUNT, number: SHAREHOLDER_ACCOUNT, name: nm(SHAREHOLDER_ACCOUNT, "Due to shareholder"), amount: -owed, memo: "Home office costs owed to the owner" });

  const f = formatAmount, plus = (a: number, total: number) => (off.paid ? `, plus office only ${f(a)} = ${f(total)}` : "");
  const working = !shareNum ? "" : claim
    ? `Expense ${sharePct} of ${f(sharePaid - shareGst)} before tax = ${f(shareExp)}${plus(offExp, expense)} · ITC ${sharePct} of ${f(shareGst)} = ${f(shareItc)}${plus(offItc, itc)} · Owed to the owner ${f(owed)}`
    : `Expense ${sharePct} of ${f(sharePaid)} = ${f(shareExp)}${plus(offExp, expense)} · Owed to the owner ${f(owed)}`;
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
  for (const r of [...COST_ROWS, ...LEGACY_ROWS]) {
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
  const costs: Partial<Record<CostKey | LegacyKey, HomeCost>> = {};
  const rc = (r.costs ?? {}) as Record<string, { paid?: unknown; gst?: unknown }>;
  for (const row of [...COST_ROWS, ...LEGACY_ROWS]) { const c = rc[row.key]; if (c) costs[row.key] = { paid: num(c.paid), gst: num(c.gst) }; }
  return {
    mode: r.mode === "pct" ? "pct" : "area", homeSqft: num(r.homeSqft), officeSqft: num(r.officeSqft), pctBp: num(r.pctBp), costs, itc: r.itc !== false,
    paidTo: typeof r.paidTo === "string" && /^[0-9a-f-]{36}$/.test(r.paidTo) ? r.paidTo : null,
  };
}
