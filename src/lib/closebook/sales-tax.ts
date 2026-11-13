// Sales tax on a bank or card line (Hashim, Nov 13, 2026; BRIEF.md "Sales tax codes"). Pure: the coding
// screen, the trial balance build and tests share it. Rates come from Settings (cb_sales_tax_parts),
// never from this file. Amounts are in cents and include tax, as on a bank statement.
//
// A code is made of parts. On a purchase, a recoverable part is an input tax credit (to the GST/HST
// account); every other part is added to the expense. On a sale, each part is tax collected: GST/HST
// to the GST/HST account, PST to PST payable. Not registered: no split at all. Quick method: operating
// expenses claim no ITC (capital purchases still do).

export type TaxPart = { name: string; rate: number; recoverable: boolean; liability: "gst_hst" | "pst" };
export type TaxCode = { code: string; name: string; parts: TaxPart[] };
export type TaxContext = { registered: boolean; quick: boolean };
export type Split = {
  netCents: number;          // to the expense or revenue account, before any non-recoverable tax
  itcCents: number;          // purchases: to the GST/HST account (debit)
  expenseTaxCents: number;   // purchases: tax added to the expense
  gstCollectedCents: number; // sales: to the GST/HST account (credit)
  pstCollectedCents: number; // sales: to PST payable (credit)
};

const ZERO = (amount: number): Split => ({ netCents: amount, itcCents: 0, expenseTaxCents: 0, gstCollectedCents: 0, pstCollectedCents: 0 });

export function splitLine(amountCents: number, code: TaxCode | null, side: "purchase" | "sale", ctx: TaxContext, capital = false): Split {
  if (!code || !ctx.registered) return ZERO(amountCents);
  const rate = code.parts.reduce((n, p) => n + p.rate, 0);
  if (rate === 0) return ZERO(amountCents);
  const net = Math.round(amountCents / (1 + rate));
  const tax = amountCents - net;
  // Each part's share of the tax, the last part taking the rounding.
  let given = 0;
  const shares = code.parts.map((p, i) => {
    const c = i === code.parts.length - 1 ? tax - given : Math.round((tax * p.rate) / rate);
    given += c;
    return { p, c };
  });
  const out: Split = { netCents: net, itcCents: 0, expenseTaxCents: 0, gstCollectedCents: 0, pstCollectedCents: 0 };
  for (const { p, c } of shares) {
    if (side === "sale") { if (p.liability === "pst") out.pstCollectedCents += c; else out.gstCollectedCents += c; continue; }
    const claim = p.recoverable && p.liability === "gst_hst" && (!ctx.quick || capital);
    if (claim) out.itcCents += c; else out.expenseTaxCents += c;
  }
  return out;
}

// The default code for a standard chart account in a province. The chart says "GST/HST", "None",
// "Check" or "Meals"; the province turns that into a code. "Check" has no default: the reviewer decides.
export function defaultTaxCode(chartDefault: string, province: string, accountNo: string): string | null {
  if (chartDefault === "Check") return null;
  if (accountNo === "60200") return province === "ON" ? "MEALS_HST_50" : "MEALS_GST_50";
  if (chartDefault === "GST/HST") return province === "ON" ? "HST_ON" : "GST";
  if (chartDefault === "Exempt") return "EXEMPT";
  return "OUT_OF_SCOPE";
}
