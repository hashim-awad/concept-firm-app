// Step 5, expenses paid personally (round 9, Hashim, Nov 27, 2026). Benchmark: the QuickBooks Online
// journal entry. The client fills the firm's sheet and sends it; Closebook does not read it. The preparer
// types each line's before-tax and GST/HST amounts from the sheet's Summary into the "Expenses paid
// personally" standard entry, and this works out the one entry: each line's account, the ITCs to 21500
// where allowed, and the credit to the shareholder loan. Pure and tested; the server runs it again before
// saving and the database checks the rules that must never slip.
import { formatAmount } from "./amount.ts";

export type ExpenseTax = "taxable" | "meals" | "none" | "auto";
// One line of the standard entry, as set in Settings, Closebook, Standard entries.
export type ExpenseDef = {
  key: string; name: string; account: string | null; tax: ExpenseTax; share: "none" | "km" | "phone";
  capital: boolean; to_reviewer: boolean; pick: boolean; note_required: boolean; choices: string[];
};
// What the preparer typed for a line, in cents. account: the picked account on a pick line; on any other line,
// the account chosen on the file (round 9b): a chart number, "acct:<id>" for the client's own account, or
// "new:<name>" for a new account in their books. Empty: the line's default.
export type ExpenseInput = { key: string; before: number; tax: number; account?: string; note?: string; receipts?: number; taxChecked?: boolean };
export type ExpenseHead = {
  summaryTotal: number | null;      // the Summary total, with tax, in cents
  kmTotal: number | null; kmBusiness: number | null;
  phonePct: number | null;          // the business share of phone and internet, 0 to 100
  shareholder: string;              // 23000 or 23050; on a client who keeps their own books, "acct:<id>" for their account
  sheet: boolean;                   // the client's sheet is attached
  autoEntry: boolean;               // the file already has an Auto expenses standard entry
  autoChecked: boolean;             // the preparer checked it is not booked twice
};
// registered and quick: the client's GST/HST (step 1). autoTax: the Auto expenses standard entry's
// sales tax setting ("none" adds the tax to the cost).
export type ExpenseCtx = { registered: boolean; quick: boolean; autoTax: string; taxCode: (account: string) => string | null };

export type ExpenseRow = {
  key: string; name: string; account: string; total: number; share: number | null;
  before: number; taxShare: number; itc: number; cost: number; leftOut: number; flag: string; toReviewer: string;
  needs: string;   // "km" or "share": the business share is missing, so nothing is worked out for the line
};
export type ExpenseRpcLine = { chart?: string; account?: string; new_name?: string; amount: number; memo: string; tax_code?: string; is_tax?: boolean };

const cents = (n: number) => Math.round(n);
export const OVER_RECEIPTS = 500000;   // a line over $5,000 needs its receipts attached

export function planExpenses(defs: ExpenseDef[], inputs: ExpenseInput[], head: ExpenseHead, ctx: ExpenseCtx) {
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const rows: ExpenseRow[] = [];
  const problems: string[] = [];
  const reviewer: string[] = [];
  const claim = ctx.registered && !ctx.quick;
  const kmShare = head.kmTotal && head.kmTotal > 0 && head.kmBusiness !== null && head.kmBusiness >= 0 && head.kmBusiness <= head.kmTotal ? head.kmBusiness / head.kmTotal : null;
  const phoneShare = head.phonePct !== null && head.phonePct >= 0 && head.phonePct <= 100 ? head.phonePct / 100 : null;
  let typed = 0, kmNeeded = false, phoneNeeded = false;
  for (const d of defs) {
    const i = byKey.get(d.key);
    if (!i || (!i.before && !i.tax)) continue;   // blank lines are dropped
    if (i.before < 0 || i.tax < 0) { problems.push(`${d.name}: type the amounts as positive numbers.`); continue; }
    const total = i.before + i.tax;
    typed += total;
    const account = d.pick ? i.account ?? "" : i.account || (d.account ?? "");
    if (d.pick && !account) problems.push(`${d.name}: choose the account.`);
    if (account.startsWith("new:") && account.slice(4).trim().length < 3) problems.push(`${d.name}: name the new account.`);
    if (d.pick && d.choices.length && account && !d.choices.includes(account)) problems.push(`${d.name}: choose one of ${d.choices.join(", ")}.`);
    if (d.note_required && (i.note ?? "").trim().length < 3) problems.push(`${d.name}: add a note saying what it is.`);
    if (total > OVER_RECEIPTS && !(i.receipts ?? 0)) problems.push(`${d.name} is over $5,000: attach the receipts.`);
    // The business share, applied to the cost and its tax; the personal share is left out.
    let share: number | null = null;
    if (d.share === "km") { kmNeeded = true; share = kmShare; }
    if (d.share === "phone") { phoneNeeded = true; share = phoneShare; }
    let toReviewer = d.to_reviewer ? (d.capital ? "Capital purchase" : "Passenger vehicle limits") : "";
    if (!toReviewer && d.capital && ctx.quick) toReviewer = "Capital purchase on the quick method";
    if (toReviewer) reviewer.push(`${d.name}: ${toReviewer.toLowerCase()}.`);
    // No business share yet: the line shows what it needs, never 100% of the cost and tax.
    if (d.share !== "none" && share === null) {
      rows.push({ key: d.key, name: d.name, account, total, share: null, before: 0, taxShare: 0, itc: 0, cost: 0, leftOut: 0, flag: "", toReviewer, needs: d.share === "km" ? "km" : "share" });
      continue;
    }
    const s = share ?? 1;
    const before = cents(i.before * s), taxShare = cents(i.tax * s);
    const rule = d.tax === "auto" ? (ctx.autoTax === "none" ? "none" : "taxable") : d.tax;
    let flag = "";
    if (rule === "none" && i.tax) {
      flag = "GST/HST typed on a line that normally has none.";
      if (!i.taxChecked) problems.push(`${d.name}: GST/HST is typed on a line that normally has none. Check the sheet, then tick "Checked".`);
    }
    // Sales tax is never split out of a total: it is typed. A regular registrant claims it (meals and
    // client gifts of food or drink: half); otherwise, and on a "No tax normally" line, it adds to the cost.
    const itc = claim && rule !== "none" ? (rule === "meals" ? cents(taxShare * 0.5) : taxShare) : 0;
    const cost = before + taxShare - itc;
    rows.push({ key: d.key, name: d.name, account, total, share: d.share === "none" ? null : share, before, taxShare, itc, cost, leftOut: total - before - taxShare, flag, toReviewer, needs: "" });
  }
  if (!rows.length) problems.unshift("Type the amounts from the Summary for the lines that apply.");
  if (kmNeeded && kmShare === null) problems.push("Vehicle lines: type the total km and the business km for the year (business km no more than total km).");
  if (phoneNeeded && phoneShare === null) problems.push("Phone and internet: type the business share (0 to 100%).");
  if (head.summaryTotal === null) problems.push("Type the Summary total, with tax.");
  else if (rows.length && typed !== head.summaryTotal) problems.push(`The lines add up to ${formatAmount(typed)}, not the Summary total of ${formatAmount(head.summaryTotal)}. Check the amounts typed.`);
  if (!head.sheet) problems.push("Attach the client's sheet as the source.");
  if (head.autoEntry && !head.autoChecked) problems.push("This file already has an Auto expenses entry. Check the vehicle costs are not booked twice, then tick the box.");
  if (!["23000", "23050"].includes(head.shareholder) && !head.shareholder.startsWith("acct:")) problems.push("Choose the shareholder.");

  const itcTotal = rows.reduce((n, r) => n + r.itc, 0);
  const debits = rows.reduce((n, r) => n + r.cost, 0) + itcTotal;
  const leftOut = rows.reduce((n, r) => n + r.leftOut, 0);
  const rpc: ExpenseRpcLine[] = rows.filter((r) => r.cost && r.account && !r.needs).map((r) => {
    // The sales tax code follows the line (meals stay 50% on any account), so it comes from the default.
    const code = r.itc ? ctx.taxCode(defs.find((d) => d.key === r.key)?.account ?? r.account) : null;
    const memo = `${r.name}${r.share !== null ? ` (business share ${Math.round(r.share * 1000) / 10}%)` : ""}${byKey.get(r.key)?.note?.trim() ? `: ${byKey.get(r.key)!.note!.trim()}` : ""}`;
    const def = defs.find((d) => d.key === r.key)?.account ?? "";
    const target = r.account.startsWith("acct:") ? { account: r.account.slice(5) }
      : r.account.startsWith("new:") ? { chart: def, new_name: r.account.slice(4).trim() } : { chart: r.account };
    return { ...target, amount: r.cost / 100, memo: memo.slice(0, 200), ...(code ? { tax_code: code } : {}) };
  });
  if (itcTotal) rpc.push({ chart: "21500", amount: itcTotal / 100, memo: "ITCs on expenses paid personally", is_tax: true });
  const credit = head.shareholder.startsWith("acct:") ? { account: head.shareholder.slice(5) } : { chart: head.shareholder };
  if (debits) rpc.push({ ...credit, amount: -debits / 100, memo: "Paid personally by the shareholder" });
  // The figures are true only when the lines typed add up to the Summary total and every line has its
  // business share; until then the screen shows what is missing, never a shareholder loan credit.
  const balanced = head.summaryTotal !== null && rows.length > 0 && typed === head.summaryTotal;
  const complete = balanced && !rows.some((r) => r.needs);
  return {
    rows, rpc, problems, reviewer, typed, itcTotal, leftOut, credit: debits, balanced, complete,
    summaryDiff: head.summaryTotal === null ? null : head.summaryTotal - typed,
    // The tie-out beside the entry: Summary total less the personal share = the shareholder loan credit.
    tieOut: complete && head.summaryTotal! - leftOut === debits,
    check: { summary_total: (head.summaryTotal ?? 0) / 100, km_total: head.kmTotal, km_business: head.kmBusiness, credit: debits / 100,
      lines: rows.map((r) => ({ key: r.key, total: r.total / 100, receipts: byKey.get(r.key)?.receipts ?? 0, account: r.account, note: byKey.get(r.key)?.note ?? "" })) },
    toReviewer: reviewer.length > 0,
  };
}
