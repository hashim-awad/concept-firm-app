// Run with: npm test
// Step 8's GST/HST return (round 13): QuickBooks Online's lines and figures, the quick method from
// CRA RC4058, the periods and due dates, the instalments pre-filled, and the check against 21500.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReturn, buildYear, buildYearPrefilled, checkAgainstBooks, gstPeriods, prefillInstalments, type GstItem } from "../src/lib/closebook/gst-return.ts";

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
