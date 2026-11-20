// Run with: npm test
// Step 8's GST/HST return (round 13): QuickBooks Online's lines and figures, the quick method from
// CRA RC4058, the periods and due dates, the instalments pre-filled, and the check against 21500.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bankLineItems, buildReturn, buildYear, buildYearPrefilled, checkAgainstBooks, gstPeriods, prefillInstalments, type BankTaxLine, type GstItem, type GstPayment } from "../src/lib/closebook/gst-return.ts";
import type { TaxCode } from "../src/lib/closebook/sales-tax.ts";

const DUE = { annual: 3, period: 1 };
const sale = (date: string, net: number, tax: number, code = "HST_ON"): GstItem => ({ date, source: "bank", ref: date, label: "Commission", account: "40000", accountName: "Commission income", code, sale: true, netCents: net, taxCents: tax });
const buy = (date: string, net: number, tax: number, code = "HST_ON"): GstItem => ({ date, source: "bank", ref: date, label: "Supplies", account: "64310", accountName: "Office supplies", code, sale: false, netCents: net, taxCents: tax });

test("periods: one for an annual filer, quarters or months inside the fiscal year, due dates from the settings", () => {
  assert.deepEqual(gstPeriods("2026-01-01", "2026-12-31", "annual", DUE).map((p) => [p.start, p.end, p.due]), [["2026-01-01", "2026-12-31", "2027-03-31"]]);
  const q = gstPeriods("2026-01-01", "2026-12-31", "quarterly", DUE);
  assert.deepEqual(q.map((p) => [p.start, p.end, p.due]), [["2026-01-01", "2026-03-31", "2026-04-30"], ["2026-04-01", "2026-06-30", "2026-07-31"], ["2026-07-01", "2026-09-30", "2026-10-31"], ["2026-10-01", "2026-12-31", "2027-01-31"]]);
  assert.equal(gstPeriods("2026-05-01", "2026-10-31", "monthly", DUE).length, 6);
  // A short first year: the last quarter ends at the year end.
  assert.deepEqual(gstPeriods("2026-05-01", "2026-10-31", "quarterly", DUE).map((p) => p.end), ["2026-07-31", "2026-10-31"]);
  // CRA's example: an August 31 year end is due November 30.
  assert.equal(gstPeriods("2025-09-01", "2026-08-31", "annual", DUE)[0].due, "2026-11-30");
});

test("regular method: the QuickBooks Online lines; out of scope left out of 101; refunds reverse ITCs; meals as coded", () => {
  const items = [sale("2026-03-01", 1000000, 130000), sale("2026-04-01", 50000, 0, "EXEMPT"), sale("2026-05-01", 20000, 0, "OUT_OF_SCOPE"),
    buy("2026-03-02", 200000, 26000), buy("2026-03-03", 10000, 650, "MEALS_HST_50"), buy("2026-06-01", -5000, -650)];
  const r = buildReturn(items, gstPeriods("2026-01-01", "2026-12-31", "annual", DUE)[0], false, { rate: null, creditRate: null, creditLimitCents: null }, 40000);
  assert.equal(r.lines["101"], 1050000, "10,000 taxable + 500 exempt; out of scope left out");
  assert.equal(r.lines["103"], 130000);
  assert.equal(r.lines["106"], 26000 + 650 - 650);
  assert.equal(r.lines["109"], 130000 - 26000);
  assert.equal(r.lines["110"], 40000);
  assert.equal(r.lines["113"], 130000 - 26000 - 40000);
  assert.equal(r.drill["106"]!.length, 3);
  assert.deepEqual(r.problems, []);
});

test("quick method: 101 eligible sales with the tax, to the dollar; 103 at the remittance rate; ITCs on capital only; the credit up to its limit", () => {
  const q = { rate: 0.088, creditRate: 0.01, creditLimitCents: 3000000 };
  // 45,000 of eligible sales including HST, as CRA's example; a capital purchase's ITC (the build gives ITCs on capital only).
  const items = [sale("2026-02-01", 3982301, 517699), sale("2026-02-02", 100000, 0, "ZERO_RATED"), { ...buy("2026-02-03", 300000, 39000), account: "15000" }];
  const r = buildReturn(items, gstPeriods("2026-01-01", "2026-12-31", "annual", DUE)[0], true, q, 0);
  assert.equal(r.lines["101"], 4500000, "zero-rated left out; the tax included");
  assert.equal(r.lines["103"], 396000, "45,000 x 8.8%");
  assert.equal(r.lines["107"], 30000, "1% of the first 30,000: $300, as CRA's example");
  assert.equal(r.lines["106"], 39000);
  assert.equal(r.lines["109"], 396000 - 39000 - 30000);
  // No rates in Settings: the return says so, and does not guess.
  const none = buildReturn(items, r.period, true, { rate: null, creditRate: null, creditLimitCents: null }, 0);
  assert.equal(none.problems.length, 2);
  assert.equal(none.lines["103"], 0);
});

test("quick method, quarterly: the credit runs across the year's quarters until its limit", () => {
  const q = { rate: 0.088, creditRate: 0.01, creditLimitCents: 3000000 };
  const ps = gstPeriods("2026-01-01", "2026-12-31", "quarterly", DUE);
  const items = [sale("2026-02-01", 1769912, 230088), sale("2026-05-01", 1769912, 230088)];   // 20,000 a quarter, tax in
  const rs = buildYear(items, ps, true, q, new Map());
  assert.deepEqual(rs.map((r) => r.lines["107"]), [20000, 10000, 0, 0], "1% of 20,000, then of the 10,000 left");
});

test("instalments pre-filled from payments in the period; last year's balance is not an instalment", () => {
  const ps = gstPeriods("2026-01-01", "2026-12-31", "annual", DUE);
  const pay = [{ date: "2026-03-30", ref: "a", label: "CRA", cents: 210000 }, { date: "2026-04-30", ref: "b", label: "CRA", cents: 50000 }, { date: "2026-07-31", ref: "c", label: "CRA", cents: 50000 }];
  const p = prefillInstalments(pay, ps, 210000);
  assert.equal(p.lastYear?.ref, "a");
  assert.equal(p.byPeriod.get(1), 100000);
});

test("quarterly: a payment of last quarter's balance is not an instalment", () => {
  const ps = gstPeriods("2026-01-01", "2026-12-31", "quarterly", DUE);
  const items = [sale("2026-02-10", 2000000, 260000), buy("2026-03-20", 100000, 13000), sale("2026-05-12", 1500000, 195000)];
  const pay = [{ date: "2026-04-28", ref: "q1", label: "CRA", cents: 247000 }, { date: "2026-06-15", ref: "inst", label: "CRA", cents: 10000 }];
  const { returns, prefill } = buildYearPrefilled(items, ps, false, { rate: null, creditRate: null, creditLimitCents: null }, pay, 0);
  assert.equal(returns[0].lines["113"], 247000);
  assert.equal(returns[1].lines["110"], 10000, "only the June payment is an instalment; April's paid the first quarter");
  assert.deepEqual(prefill.balances.map((x) => x.ref), ["q1"]);
});

test("the check against 21500: tied, and with a difference", () => {
  const ps = gstPeriods("2026-01-01", "2026-12-31", "annual", DUE);
  const r = buildReturn([sale("2026-03-01", 1000000, 130000), buy("2026-03-02", 200000, 26000)], ps[0], false, { rate: null, creditRate: null, creditLimitCents: null }, 100000);
  const pay = [{ date: "2026-03-30", ref: "a", label: "CRA", cents: 210000 }, { date: "2026-04-30", ref: "b", label: "CRA", cents: 100000 }];
  const tied = checkAgainstBooks(210000, [r], pay, 4000);
  assert.equal(tied.owingCents, 210000 + 104000 - 310000);
  assert.equal(tied.diffCents, 0);
  assert.equal(r.lines["113"], 4000, "the balance still owing is the return's balance");
  assert.equal(checkAgainstBooks(210000, [r], pay, 4500).diffCents, 500);
});

test("entries as posted: the meals line's ITC is the 6.50 the entry booked, not 13% of 106.50 halved (round 13 fix)", async () => {
  const { itemsFromEntry } = await import("../src/lib/closebook/gst-return.ts");
  const HST = { code: "HST_ON", name: "HST ON", parts: [{ name: "HST ON", rate: 0.13, recoverable: true, liability: "gst_hst" as const }] };
  const MEALS = { code: "MEALS_HST_50", name: "Meals HST 50", parts: [{ name: "ITC", rate: 0.065, recoverable: true, liability: "gst_hst" as const }, { name: "NoITC", rate: 0.065, recoverable: false, liability: "gst_hst" as const }] };
  const L = (cents: number, code: typeof HST | null, account: string, isTax = false) => ({ cents, code, codeName: code?.code ?? "", accountType: "Expense", account, accountName: account, isTax, on21500: account === "21500" });
  // AJE 10 on Birch: meals 106.50 (100.00 + the 6.50 not claimable), fuel 750.00, ITCs 104.00 to 21500.
  const items = itemsFromEntry({ date: "2026-12-31", ref: "aje10", label: "AJE 10" }, [L(10650, MEALS, "60200"), L(75000, HST, "70600"), L(10400, null, "21500", true)], { registered: true, quick: false });
  assert.deepEqual(items.map((x) => [x.account, x.netCents, x.taxCents]), [["60200", 10000, 650], ["70600", 75000, 9750]]);
  assert.equal(items.reduce((n, x) => n + x.taxCents, 0), 10400, "the ITCs posted, to the cent");
});

test("quick method: the sales before tax for step 5 are the eligible sales without the tax", () => {
  const r = buildReturn([sale("2026-02-01", 1000000, 130000), sale("2026-02-02", 50000, 0, "ZERO_RATED")], gstPeriods("2026-01-01", "2026-12-31", "annual", DUE)[0], true,
    { rate: 0.088, creditRate: 0.01, creditLimitCents: 3000000 }, 0);
  assert.equal(r.salesNetCents, 1000000);
  assert.equal(r.lines["101"], 1130000);
});

// Round 20 (Hashim, Nov 15, 2026): two quick method rates, Services and Goods for resale. The client's step 1
// answer picks one; the return says which rate it used; a missing rate is named and never guessed. The
// rates below are dummy figures for the tests, not CRA's.
test("quick method, round 20: the client's type picks the rate, and the return says which one it used", async () => {
  const { quickRateFor, quickType } = await import("../src/lib/closebook/gst-return.ts");
  const rates = [{ province: "ON", services: 0.05, goods: 0.02, from: "2025-01-01" }, { province: "ON", services: 0.06, goods: 0.03, from: "2026-07-01" }, { province: "AB", services: 0.04, goods: null, from: null }];
  const base = { rate: null, creditRate: 0.01, creditLimitCents: 3000000, province: "ON", rates };
  const year = gstPeriods("2026-01-01", "2026-12-31", "annual", DUE)[0];
  const items = [sale("2026-02-01", 1000000, 130000)];   // 11,300 of eligible sales with the HST
  const services = buildReturn(items, year, true, { ...base, type: "services" }, 0);
  assert.equal(services.lines["103"], 56500, "11,300 x 5%: the rate in effect on the period's first day");
  assert.equal(services.rateUsed, "Quick method rate, services, Ontario: 5%");
  const goods = buildReturn(items, year, true, { ...base, type: "goods" }, 0);
  assert.equal(goods.lines["103"], 22600, "11,300 x 2%");
  assert.equal(goods.rateUsed, "Quick method rate, goods for resale, Ontario: 2%");
  assert.deepEqual(goods.problems, []);
  // No answer in step 1: services.
  assert.equal(buildReturn(items, year, true, base, 0).rateUsed, "Quick method rate, services, Ontario: 5%");
  assert.equal(quickType(undefined), "services");
  assert.equal(quickType("goods"), "goods");
  // A later period takes the later rate; a row with no start date applies to every period.
  const q3 = gstPeriods("2026-01-01", "2026-12-31", "quarterly", DUE)[2];
  assert.equal(quickRateFor(rates, "ON", "services", q3.start), 0.06);
  assert.equal(quickRateFor(rates, "ON", "goods", "2024-12-31"), null, "before the first rate starts: none");
  assert.equal(quickRateFor(rates, "AB", "services", "2020-01-01"), 0.04);
});

test("quick method, round 20: a missing rate is named and line 103 is not guessed", () => {
  const rates = [{ province: "AB", services: 0.04, goods: null, from: null }];
  const year = gstPeriods("2026-01-01", "2026-12-31", "annual", DUE)[0];
  const r = buildReturn([sale("2026-02-01", 1000000, 50000, "GST")], year, true, { rate: null, creditRate: 0.01, creditLimitCents: 3000000, province: "AB", type: "goods", rates }, 0);
  assert.equal(r.lines["103"], 0);
  assert.equal(r.rateUsed, null);
  assert.deepEqual(r.problems, ["No approved quick method rate for goods for resale in Alberta for the period from Jan 1, 2026. An Admin loads it from CRA and approves it in Settings, Sales tax rates, Quick method rates."]);
  // No approved rows at all (another province): missing too.
  const none = buildReturn([sale("2026-02-01", 1000000, 130000)], year, true, { rate: null, creditRate: 0.01, creditLimitCents: 3000000, province: "ON", type: "services", rates }, 0);
  assert.equal(none.lines["103"], 0);
  assert.match(none.problems[0], /^No approved quick method rate for services in Ontario/);
});

// Piece GST-SPLIT (Hashim, Nov 20, 2026): a split bank line counts row by row, each row with its own account and code.
test("GST-SPLIT: a split deposit counts its HST ON row only; the return matches the books", () => {
  const g = (rate: number) => ({ name: "GST", rate, recoverable: true, liability: "gst_hst" as const });
  const codes = new Map<string, TaxCode>([["HST_ON", { code: "HST_ON", name: "HST ON", parts: [g(0.13)] }], ["OUT_OF_SCOPE", { code: "OUT_OF_SCOPE", name: "Out of Scope", parts: [] }]]);
  const chart = new Map([["40000", { name: "Sales", account_type: "Revenue" }], ["68300", { name: "Licences and permits", account_type: "Expense" }],
    ["64310", { name: "Office supplies", account_type: "Expense" }], ["21500", { name: "GST/HST payable", account_type: "Liability" }]]);
  const ctx = { registered: true, quick: false };
  const items: GstItem[] = [], payments: GstPayment[] = [];
  // The real shape: a deposit of 1,007.41 split 847.50 Sales HST ON and 159.91 Licences and permits Out of Scope.
  const deposit: BankTaxLine = { status: "done", date: "2025-11-27", id: "dep", description: "Deposit", cents: 100741, chart_account: null, tax_code: null,
    splits: [{ chart_account: "40000", tax_code: "HST_ON", cents: 84750 }, { chart_account: "68300", tax_code: "OUT_OF_SCOPE", cents: 15991 }] };
  bankLineItems(deposit, true, chart, codes, ctx, items, payments);
  assert.deepEqual(items.map((i) => [i.account, i.code, i.sale, i.netCents, i.taxCents]), [["40000", "HST_ON", true, 75000, 9750], ["68300", "OUT_OF_SCOPE", false, -15991, 0]]);
  // A split cheque (money out): the HST ON row's ITC only; the Out of Scope row adds nothing to 106.
  const cheque: BankTaxLine = { status: "done", date: "2025-11-28", id: "chq", description: "Cheque", cents: -14300, chart_account: null, tax_code: null,
    splits: [{ chart_account: "64310", tax_code: "HST_ON", cents: 11300 }, { chart_account: "68300", tax_code: "OUT_OF_SCOPE", cents: 3000 }] };
  const its: GstItem[] = [];
  bankLineItems(cheque, true, chart, codes, ctx, its, payments);
  assert.deepEqual(its.map((i) => [i.account, i.sale, i.netCents, i.taxCents]), [["64310", false, 10000, 1300], ["68300", false, 3000, 0]]);
  // A line with no split is unchanged; a line not done is left out.
  const one: GstItem[] = [];
  bankLineItems({ status: "done", date: "2025-11-29", id: "s", cents: 11300, chart_account: "40000", tax_code: "HST_ON" }, true, chart, codes, ctx, one, payments);
  bankLineItems({ status: "pending", date: "2025-11-29", id: "p", cents: 11300, chart_account: "40000", tax_code: "HST_ON" }, true, chart, codes, ctx, one, payments);
  assert.deepEqual(one.map((i) => [i.netCents, i.taxCents]), [[10000, 1300]]);
  // The real file's year: before the split, 101 = 54,335.00 and 103 = 7,063.55. With it: 101 = 55,085.00, 103 = 7,161.05,
  // 106 = 4,993.95, 109 = 2,167.10, 110 = 404.94, 113 = 1,762.16.
  const rest = [sale("2025-06-01", 5433500, 706355), buy("2025-06-02", 3841500, 499395)];
  const r = buildReturn([...rest, ...items], gstPeriods("2025-01-01", "2025-12-31", "annual", DUE)[0], false, { rate: null, creditRate: null, creditLimitCents: null }, 40494);
  assert.deepEqual(["101", "103", "106", "109", "110", "113"].map((k) => r.lines[k as keyof typeof r.lines]), [5508500, 716105, 499395, 216710, 40494, 176216]);
});
