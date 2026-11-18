// Piece 4b (Hashim, Nov 18, 2026, version 2; benchmark CaseWare Cloud: a working paper that calculates amounts and fills
// its adjusting entry). The Expenses paid personally schedule: what the owner paid for the business, line by line, the
// business share of each, the ITC on its GST/HST, and the entry that books them and what is owed to the owner. Pure and
// tested (tests/closebook-expenses-schedule.test.ts): the window shows it, the server works it out again before saving,
// the PDF prints it. Amounts in cents; each line is worked out to cents and the totals are the sums of the lines.
import { formatAmount } from "./amount.ts";
import { mulDiv, PROVINCE_NAMES, type SchedLine } from "./vehicle-schedule.ts";

export const ITC_ACCOUNT = "21500", SHAREHOLDER_ACCOUNT = "23000";
export const EXP_WP_REF = "Expenses paid personally schedule", EXP_DESCRIPTION = "Expenses paid personally";
export const EXP_NATURE = "Reimbursement of business expenses the owner paid personally. ITC under ETA s.175 on the GST/HST shown on the owner's receipts.";
// GST/HST fills itself only where the amount paid holds no provincial sales tax of its own and the factor applies.
export const AUTO_GST_PROVINCES = ["ON", "AB"];
export const START_LINES = 3;

// An expense account the picker offers, with its sales tax treatment (the standard chart's "Sales tax (regular
// method)": GST/HST is taxable, None and Exempt have no tax, Check is for the preparer) and whether it is meals (its
// GIFI line's income tax code is M50: half the GST/HST is an ITC).
export type ExpAcct = { label: string; tax: "taxable" | "none" | "check"; meals: boolean };
export type ExpLine = { acct: string | null; what: string; paid: number | null; gst: number | null; pctBp: number | null };   // gst null: as filled; pctBp null: 100%
export type ExpInputs = { lines: ExpLine[]; itc: boolean; paidTo?: string | null };
export type ExpCtx = {
  province: string; regular: boolean;
  factor: { numerator: number; denominator: number } | null;
  taxCode: string | null; mealsCode: string | null;   // the province's codes for a taxable line and a meals line
  accts: Record<string, ExpAcct>;
  payee?: { id: string; name: string } | null;          // the Signing officer, "Name, Title"; null: none on the client record
  bnMissing?: boolean;
};
export type ExpProblem = { field: string; text: string; hard: boolean };   // field: "acct:<i>", "gst:<i>", "pct:<i>", "factor", "paidTo", "bn", "paid"
export type ExpRow = {
  i: number; acct: string | null; label: string; what: string; paid: number; gst: number; gstText: string; typedGst: boolean;
  pctBp: number; meals: boolean; expense: number; itc: number; owed: number; part: string | null;
};
export type ExpResult = {
  rows: ExpRow[]; expense: number; itc: number; owed: number; claim: boolean;
  lines: SchedLine[]; record: { amount: number; gst: number; claim: boolean; payee: { id: string; name: string } | null };
  working: string; problems: ExpProblem[]; ready: boolean;
};

export const blankExpLine = (): ExpLine => ({ acct: null, what: "", paid: null, gst: null, pctBp: null });
export const emptyExpInputs = (): ExpInputs => ({ lines: Array.from({ length: START_LINES }, blankExpLine), itc: true, paidTo: null });
export const pctText = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2));

// The GST/HST a line holds when nothing was typed: filled (taxable, Ontario or Alberta), 0 ("none"), or null (typed).
export function defaultExpGst(a: ExpAcct | undefined, paid: number, ctx: ExpCtx): number | null {
  if (!a) return null;
  if (a.tax === "none") return 0;
  if (a.tax === "taxable" && AUTO_GST_PROVINCES.includes(ctx.province) && ctx.factor && paid) return mulDiv(paid, ctx.factor.numerator, ctx.factor.denominator);
  return null;
}

export function calcExpenses(inp: ExpInputs, ctx: ExpCtx): ExpResult {
  const problems: ExpProblem[] = [];
  const gstOn = ctx.regular;   // not registered or quick method: no GST/HST IN IT column, no ITC
  const claim = ctx.regular && inp.itc && !!ctx.factor;
  let n = 0;
  const rows: ExpRow[] = inp.lines.map((l, i) => {
    const a = l.acct ? ctx.accts[l.acct] : undefined;
    const paid = Math.max(0, l.paid ?? 0);
    const pctBp = l.pctBp ?? 10000;
    const dflt = defaultExpGst(a, paid, ctx);
    const gst = gstOn ? Math.max(0, l.gst ?? dflt ?? 0) : 0;
    const gstText = !gstOn ? "" : l.gst !== null && l.gst !== undefined ? formatAmount(gst) : dflt === null ? "" : a?.tax === "none" ? "none" : formatAmount(gst);
    const meals = !!a?.meals;
    if (paid) {
      if (!l.acct) problems.push({ field: `acct:${i}`, text: "Choose the account for this line.", hard: true });
      else if (!a) problems.push({ field: `acct:${i}`, text: "Choose an expense account.", hard: true });
      if (gstOn && gst > paid) problems.push({ field: `gst:${i}`, text: "GST/HST can't be more than the amount paid.", hard: true });
    }
    if ((paid || l.pctBp !== null) && (pctBp < 100 || pctBp > 10000)) problems.push({ field: `pct:${i}`, text: "Business % must be from 1 to 100.", hard: true });
    // Per line, to cents. Meals: half the GST/HST is the ITC; the rest of the business share is the expense.
    let itc = 0, expense = 0;
    if (claim && !meals) { itc = mulDiv(pctBp, gst, 10000); expense = mulDiv(pctBp, paid - gst, 10000); }
    else if (claim && meals) { itc = mulDiv(pctBp, gst, 20000); expense = mulDiv(pctBp, paid, 10000) - itc; }
    else expense = mulDiv(pctBp, paid, 10000);
    const part = paid ? `exp_${++n}` : null;
    return { i, acct: l.acct, label: a?.label ?? "", what: l.what, paid, gst, gstText, typedGst: l.gst !== null && l.gst !== undefined, pctBp, meals, expense, itc, owed: expense + itc, part };
  });
  const used = rows.filter((r) => r.paid);
  if (ctx.regular && !ctx.factor) problems.push({ field: "factor", text: `Enter the ITC factor for ${PROVINCE_NAMES[ctx.province] ?? ctx.province} in Closebook rules › CRA rates.`, hard: true });
  if (!used.length) problems.push({ field: "paid", text: "Enter the amounts paid.", hard: true });
  const expense = used.reduce((s, r) => s + r.expense, 0), itc = used.reduce((s, r) => s + r.itc, 0), owed = expense + itc;

  // Who was paid, and the GST/HST number: only where the GST/HST record prints (as the other two schedules).
  let payee: { id: string; name: string } | null = null;
  const prints = ctx.regular && inp.itc;
  if (ctx.payee !== undefined && prints) {
    if (ctx.payee) payee = ctx.payee;
    else problems.push({ field: "paidTo", text: "Add the signing officer to the client record first.", hard: true });
  }
  if (ctx.bnMissing && prints) problems.push({ field: "bn", text: "Add the business number to the client record first.", hard: true });

  const lines: SchedLine[] = [];
  for (const r of used) {
    if (!r.expense) continue;
    const code = r.itc ? (r.meals ? ctx.mealsCode : ctx.taxCode) : null;
    lines.push({ part: r.part!, account: r.acct ?? undefined, number: "", name: r.label, amount: r.expense, memo: (r.what.trim() || r.label.replace(/^\d+\s+/, "")).slice(0, 200),
      ...(code ? { tax_code: code } : {}) });
  }
  if (itc) lines.push({ part: "exp_itc", chart: ITC_ACCOUNT, number: ITC_ACCOUNT, name: "GST/HST payable", amount: itc, memo: "ITC on the business share", is_tax: true });
  if (owed) lines.push({ part: "exp_due", chart: SHAREHOLDER_ACCOUNT, number: SHAREHOLDER_ACCOUNT, name: "Due to shareholder", amount: -owed, memo: "Expenses paid personally, owed to the owner" });

  const working = !used.length ? "" : claim
    ? `Expenses ${formatAmount(expense)} · ITC ${formatAmount(itc)} · Owed to the owner ${formatAmount(owed)}`
    : `Expenses ${formatAmount(expense)} · Owed to the owner ${formatAmount(owed)}`;
  const hard = problems.some((p) => p.hard);
  return { rows, expense, itc, owed, claim, lines, record: { amount: owed, gst: itc, claim, payee }, working, problems, ready: !hard && lines.length >= 2 };
}

// History: each line changed, in words.
export function expChanges(was: ExpInputs, now: ExpInputs, accts: Record<string, ExpAcct> = {}) {
  const out: { what: string; old: string; new: string }[] = [];
  const v = (c: number | null | undefined) => (c === null || c === undefined ? "empty" : formatAmount(c));
  const nm = (x: string | null) => (x ? accts[x]?.label ?? "another account" : "empty");
  const len = Math.max(was.lines.length, now.lines.length);
  for (let i = 0; i < len; i++) {
    const a = was.lines[i] ?? blankExpLine(), b = now.lines[i] ?? blankExpLine(), at = `Line ${i + 1}`;
    if ((a.acct ?? null) !== (b.acct ?? null)) out.push({ what: `${at}, account`, old: nm(a.acct), new: nm(b.acct) });
    if (a.what.trim() !== b.what.trim()) out.push({ what: `${at}, what it was`, old: a.what.trim() || "empty", new: b.what.trim() || "empty" });
    if ((a.paid ?? null) !== (b.paid ?? null)) out.push({ what: `${at}, amount paid`, old: v(a.paid), new: v(b.paid) });
    if ((a.gst ?? null) !== (b.gst ?? null)) out.push({ what: `${at}, GST/HST`, old: a.gst == null ? "as filled" : v(a.gst), new: b.gst == null ? "as filled" : v(b.gst) });
    if ((a.pctBp ?? 10000) !== (b.pctBp ?? 10000)) out.push({ what: `${at}, business %`, old: pctText(a.pctBp ?? 10000), new: pctText(b.pctBp ?? 10000) });
  }
  return out;
}

const ACCT = /^(chart:\d{4,5}|line:\d{4}\.\d{2}|[0-9a-f-]{36})$/;
export function readExpInputs(raw: unknown): ExpInputs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  const lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, 100).map((x) => {
    const l = (x ?? {}) as Record<string, unknown>;
    return { acct: typeof l.acct === "string" && ACCT.test(l.acct) ? l.acct : null, what: typeof l.what === "string" ? l.what.slice(0, 200) : "",
      paid: num(l.paid), gst: num(l.gst), pctBp: num(l.pctBp) };
  });
  return { lines: lines.length ? lines : emptyExpInputs().lines, itc: r.itc !== false, paidTo: null };
}
