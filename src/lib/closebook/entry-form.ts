// Step 5, the entry form (Hashim, Nov 16, 2026, round 2 items 1, 2 and 11; benchmark: the QuickBooks Online
// journal entry screen). Pure: the form shows what it will post and why Save is off; the server action
// builds the same lines again from its own tax rates before saving.
import { entryLineTax, type TaxCode, type TaxContext } from "./sales-tax.ts";
import { formatAmount, parseAmount } from "./amount.ts";

// An account the form offers. value: a file account id, "chart:66000" (a standard chart account, added to
// the file on save), "line:8670.00" (a GIFI line with no chart account) or "new" (a new account in the
// books of a client who keeps their own, named on the line).
export type AcctOpt = { value: string; label: string; type: string; line_no: string; group: string };
export type FormLine = { acct: string; dr: string; cr: string; desc: string; tax: string; newName: string; newType: string; newLine: string };
export type FormHead = { kind: string; reason: string; wpRef: string; memo: string; reverse: boolean };
export type RpcLine = { account?: string; chart?: string; line?: string; new_name?: string; new_type?: string; amount: number; memo: string; tax_code?: string; is_tax?: boolean };
export type TaxRow = { label: string; cents: number };

// A standard entry's side, resolved to this file: value is the account the form picks ("" when the preparer
// must choose, with the reason in missing).
export type StdSide = { value: string; chart: string; label: string; line_no: string; missing: string };
export type StdOpt = { id: string; name: string; kind: string; reason: string; memo: string; wp_ref: string; reverse: boolean; debit: StdSide; credit: StdSide; tax: string; taxMode: string };

// Sales tax on a line: "none" (no tax), a code, or "" when it must still be chosen (a standard entry set to
// "Choose on the line", round 4 item 2).
export const blankLine = (): FormLine => ({ acct: "", dr: "", cr: "", desc: "", tax: "none", newName: "", newType: "", newLine: "" });
const taxCode = (t: string) => (t && t !== "none" ? t : "");
const isPpa = (line: string) => line.startsWith("3720") || line.startsWith("3600");

export function planEntry(head: FormHead, lines: FormLine[], opts: Map<string, AcctOpt>, codes: Map<string, TaxCode>, ctx: TaxContext, lineTypes: Map<string, string> = new Map()) {
  const out: RpcLine[] = [];
  let gst = 0, pst = 0, dr = 0, cr = 0;
  const problems: string[] = [];
  let ppaLine = false;
  // Every amount typed counts in the totals, account chosen or not (round 3 item 8): a missing account is
  // flagged on its own line, never as a difference.
  let typedDr = 0, typedCr = 0;
  lines.forEach((l, i) => {
    const d = parseAmount(l.dr) ?? 0, c = parseAmount(l.cr) ?? 0;
    if (!l.acct && !d && !c) return;
    const n = i + 1;
    if (!l.acct) { typedDr += d; typedCr += c; problems.push(`Line ${n} needs an account.`); return; }
    if (d && c) { problems.push(`Line ${n}: a debit or a credit, not both.`); return; }
    if (!d && !c) { problems.push(`Line ${n}: enter the amount.`); return; }
    const o = opts.get(l.acct);
    const lineNo = l.acct === "new" ? l.newLine : o?.line_no ?? "";
    const type = l.acct === "new" ? lineTypes.get(l.newLine) ?? "" : o?.type ?? "";
    if (l.acct === "new" && (l.newName.trim().length < 3 || !l.newType || !l.newLine)) problems.push(`Line ${n}: name the new account, with its QuickBooks type and GIFI line.`);
    if (isPpa(lineNo)) ppaLine = true;
    const net = d - c;
    if (ctx.registered && !l.tax) problems.push(`Line ${n}: choose the sales tax.`);
    const t = entryLineTax(net, taxCode(l.tax) ? codes.get(l.tax) ?? null : null, type, ctx);
    gst += t.gstHst; pst += t.pst;
    const amount = net + t.toLine;
    const target: Partial<RpcLine> = l.acct === "new" ? { line: l.newLine, new_name: l.newName.trim(), new_type: l.newType }
      : l.acct.startsWith("chart:") ? { chart: l.acct.slice(6) } : l.acct.startsWith("line:") ? { line: l.acct.slice(5) } : { account: l.acct };
    out.push({ ...target, amount: amount / 100, memo: l.desc.trim(), ...(taxCode(l.tax) ? { tax_code: l.tax } : {}) });
  });
  const taxRows: TaxRow[] = [];
  if (gst) { out.push({ chart: "21500", amount: gst / 100, memo: "Sales tax", is_tax: true }); taxRows.push({ label: "21500 GST/HST payable (sales tax)", cents: gst }); }
  if (pst) { out.push({ chart: "21550", amount: pst / 100, memo: "Sales tax", is_tax: true }); taxRows.push({ label: "21550 PST payable (sales tax)", cents: pst }); }
  for (const r of out) { const c = Math.round(r.amount * 100); if (c > 0) dr += c; else cr -= c; }
  dr += typedDr; cr += typedCr;
  const diff = dr - cr;
  // Each rule shows only when it is broken (item 11), in the order a preparer fills the form.
  if (out.filter((r) => !r.is_tax).length < 2 && !problems.length) problems.push("Enter at least two lines.");
  if (diff && !problems.length) problems.push(`Debits and credits differ by ${formatAmount(Math.abs(diff))}.`);
  if (ppaLine && head.reason !== "prior_period") problems.push("A line on 31500 Prior period adjustments needs the reason “Prior period adjustment”.");
  if (!ppaLine && head.reason === "prior_period") problems.push("The reason “Prior period adjustment” needs a line on 31500 Prior period adjustments.");
  if (head.reverse && head.reason !== "accrual") problems.push("Only an accrual reverses next year.");
  if (head.wpRef.trim().length < 3) problems.push("Add the W/P reference.");
  if (head.memo.trim().length < 3) problems.push("Add the memo.");
  return { rpc: out, taxRows, dr, cr, diff, problems };
}

// A standard entry's amount is the total paid, including tax (round 3 item 2; QuickBooks Online's "amounts
// are inclusive of tax"): the line before tax is the amount that, with its tax added, gives the total to
// the cent. 1,130.00 with HST ON gives 1,000.00 and 130.00.
export function netOfTax(grossCents: number, code: TaxCode | null, accountType: string, ctx: TaxContext): number {
  if (!code || !ctx.registered) return grossCents;
  const rate = code.parts.reduce((n, p) => n + p.rate, 0);
  const guess = Math.round(grossCents / (1 + rate));
  const total = (net: number) => { const t = entryLineTax(net, code, accountType, ctx); return net + t.gstHst + t.pst + t.toLine; };
  for (const net of [guess, guess - 1, guess + 1, guess - 2, guess + 2]) if (total(net) === grossCents) return net;
  return guess;
}
