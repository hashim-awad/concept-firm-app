// Run with: npm test
// Step 9, the year-end package (round 11): Appendix C's rules on Closebook's figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFs, caption, n, periodOf, type FsLine } from "../src/lib/closebook/fs-model.ts";

const L = (code: string, name: string, cap: string): [string, FsLine] => [code, { code, name, caption: cap }];
const lines = new Map<string, FsLine>([
  L("1002", "Deposits in Canadian banks", "Cash and cash equivalents"), L("1001", "Cash on hand", "Cash and cash equivalents"),
  L("1060", "Accounts receivable", "Accounts receivable"), L("1774", "Computer equipment/software", "Accumulated amortization of machinery, equipment, furniture, and fixtures"),
  L("1775", "Accumulated amortization of computer", "Accumulated amortization of machinery, equipment, furniture, and fixtures"),
  L("2620", "Amounts payable and accrued liabilities", "Accounts payable and accrued liabilities"), L("2680", "Taxes payable", "Income taxes payable"),
  L("2781", "Due to individual shareholder(s)", "Due to shareholder(s)/director(s)"), L("2860", "Due to related parties", "Due to related parties"),
  L("3500", "Common shares", "Share capital"), L("8121", "Commission income on real estate transactions", "Commission revenue"),
  L("8523", "Meals and entertainment", "Meals and entertainment"), L("8670", "Amortization of tangible assets", "Amortization"), L("9990", "Current income taxes", "Current income taxes"),
]);
// A small Birch-like year, GIFI-signed and in balance. Assets 300.25 + 50,000.25 + 5,500 + 9,800 − 5,880 = 59,720.50.
// Net income 9,000 − 234.75 − 1,960 − 800 = 6,005.25; equity 100 + 41,730 − 500 + 6,005.25 = 47,335.25;
// liabilities 7,350 + 1,272.57 + 3,762.68 = 12,385.25; 12,385.25 + 47,335.25 = 59,720.50.
const cur = new Map<string, number>([
  ["1001", 300.25], ["1002", 50000.25], ["1060", 5500], ["1774", 9800], ["1775", -5880], ["2620", 7350], ["2680", 1272.57], ["2781", 3762.68],
  ["3500", 100], ["3660", 41730], ["3720", -500], ["8121", 9000], ["8523", 234.75], ["8670", 1960], ["9990", 800],
]);
const base = { name: "Birch Dummy Realty Inc.", address: { street: "1 Dummy St", city: "Kitchener", prov: "ON", postal: "N2A 0A1" }, yearStart: "2026-01-01", yearEnd: "2026-12-31",
  cur, prior: null, lines, hst: 1272.57 - 800, related: {}, shTerms: "", note1Policy: "amortization_equals_cca" };

test("period: a full year, or the period from X to Y under 358 days", () => {
  assert.equal(periodOf("2026-01-01", "2026-12-31").period, "For the year ended December 31, 2026");
  assert.equal(periodOf("2026-05-01", "2026-10-31").period, "For the period from May 1, 2026 to October 31, 2026");
  assert.equal(periodOf("2026-05-01", "2026-10-31").isYear, false);
});

test("captions: the statement line, cash merged, and the GIFI name when the statement line contradicts its line", () => {
  assert.equal(caption(lines.get("1774"), "1774"), "Computer equipment/software");
  assert.equal(caption(lines.get("1775"), "1775"), "Accumulated amortization of machinery, equipment, furniture, and fixtures");
  const m = buildFs(base);
  assert.deepEqual(m.bs.ca.map((r) => r.cap), ["Cash and cash equivalents", "Accounts receivable"]);
  assert.equal(m.bs.ca[0].cur, 50301, "1001 and 1002 merged: 300.25 + 50,000.25 = 50,300.50, rounded");
});

test("codes that share a statement line print as one line; a receivable captioned as an allowance falls back", () => {
  const ls = new Map([...lines, L("8810", "Office expenses", "Office expenses"), L("8811", "Office stationery and supplies", "Office expenses"),
    L("1062", "Trade accounts receivable", "Allowance for doubtful accounts")]);
  const m = buildFs({ ...base, lines: ls, cur: new Map([...cur, ["8810", 100], ["8811", 134.75], ["1002", 49765.50], ["1062", 0]]) });
  assert.deepEqual(m.is.exp.filter((r) => r.cap === "Office expenses").map((r) => r.cur), [235]);
  assert.equal(caption(ls.get("1062"), "1062"), "Trade accounts receivable");
  assert.deepEqual(m.failed, []);
});

test("HST is split out of taxes payable (2680) with the GST/HST payable account", () => {
  const m = buildFs(base);
  const cl = m.bs.cl.map((r) => [r.cap, r.cur]);
  assert.deepEqual(cl.slice(1, 3), [["Income taxes payable", 800], ["GST/HST payable", 473]]);
});

test("last year's GST/HST is split out too, when Closebook has the account", () => {
  const good = new Map<string, number>([["1002", 54080], ["2620", 1750], ["2680", 2500], ["3500", 100], ["3660", 29480], ["8121", 30000], ["8670", 9750]]);
  const m = buildFs({ ...base, prior: good, hstPrior: 2500 });
  const hst = m.bs.cl.find((r) => r.code === "HST")!;
  assert.deepEqual([hst.cur, hst.pri], [473, 2500]);
  assert.equal(m.bs.cl.find((r) => r.code === "2680")!.pri, 0);
  assert.deepEqual(m.failed, []);
});

test("ProFile's rounding: each GIFI line to the dollar, lines and totals add, the balance sheet balanced on its largest line", () => {
  const m = buildFs(base);
  const S = (rs: { cur: number }[]) => rs.reduce((a, r) => a + r.cur, 0);
  // Net income from the rounded lines: 9,000 − 235 − 1,960 − 800 = 6,005 (ProFile), not 6,005.25 rounded.
  assert.equal(m.is.ni.cur, 9000 - 235 - 1960 - 800);
  assert.equal(S(m.is.rev) - S(m.is.exp) - m.is.tax.cur, m.is.ni.cur);
  assert.equal(m.is.reOpen.cur + m.is.ppa.cur + m.is.ni.cur - m.is.div.cur, m.is.reClose.cur);
  // Assets 300 + 50,000 + 5,500 + 9,800 − 5,880 = 59,720; liabilities 7,350 + 1,273 + 3,763 = 12,386;
  // equity 100 + 47,235 = 47,335; out by 1: 1002 (the largest line) goes from 50,000 to 50,001.
  assert.deepEqual(m.profileFix, { code: "1002", name: "Deposits in Canadian banks", from: 50000, to: 50001 });
  const TA = S(m.bs.ca) + S(m.bs.nca), TL = S(m.bs.cl) + S(m.bs.ncl), EQ = S(m.bs.eq);
  assert.equal(TA, TL + EQ);
  assert.equal(TA, 59721);
  assert.equal(m.bs.eq.at(-1)!.cur, m.is.reClose.cur, "retained earnings on the balance sheet = the end of the statement");
  assert.deepEqual(m.failed, []);
});

test("a line of exactly 2,500.00 prints 2,500; the GST/HST parts add to the rounded 2680; a nil line is left out", () => {
  const ls = new Map([...lines, L("8860", "Professional fees", "Professional fees")]);
  const c = new Map([...cur, ["8860", 2500], ["1002", 47500.25]]);
  const m = buildFs({ ...base, lines: ls, cur: c });
  assert.equal(m.is.exp.find((r) => r.cap === "Professional fees")?.cur, 2500);
  const t = m.bs.cl.find((r) => r.code === "2680")!.cur + m.bs.cl.find((r) => r.code === "HST")!.cur;
  assert.equal(t, 1273, "800 + 473 = the rounded 1,272.57");
  assert.equal(buildFs(base).profileFix?.code, "1002");
  // All of 2680 is GST/HST: "Income taxes payable" is nil and left out.
  const all = buildFs({ ...base, hst: 1272.57 });
  assert.equal(all.bs.cl.some((r) => r.code === "2680"), false);
  assert.equal(all.notes.has_tax, false);
});

test("no prior-year column in the first year; a prior column that does not tie stops the package by name", () => {
  assert.equal(buildFs(base).hasPrior, false);
  const prior = new Map<string, number>([["1002", 48210], ["2620", 4250], ["3500", 100], ["3660", 29480], ["8121", 30000], ["8670", 9750]]);
  // Last year: assets 48,210 against liabilities 4,250 + equity (100 + 29,480 + 20,250) = 54,080: off.
  const m = buildFs({ ...base, prior });
  assert.equal(m.hasPrior, true);
  assert.ok(m.failed.some((t) => t.column === "prior" && t.name.startsWith("Total assets = total liabilities")));
  const good = new Map<string, number>([["1002", 54080], ["2620", 4250], ["3500", 100], ["3660", 29480], ["8121", 30000], ["8670", 9750]]);
  assert.deepEqual(buildFs({ ...base, prior: good }).failed, []);
});

test("notes: only those that apply, numbered in order: prior period adjustment, due to shareholder, related parties (capital assets waits for round 12)", () => {
  const m = buildFs({ ...base, cur: new Map([...cur, ["2860", 0]]), related: {} });
  assert.equal(m.notes.ppa?.n, 2);
  assert.equal(m.notes.ppa?.amount, -500);
  assert.equal(m.notes.shareholder?.n, 3);
  assert.equal("amortization" in m.notes, false);
  assert.equal(m.notes.related, null, "no related-party balance");
  assert.ok(m.notes.has_hst && m.notes.has_ap && m.notes.has_ar && m.notes.has_tax);
  assert.match(m.notes.shareholder!.terms, /non-interest bearing, unsecured, and has no set terms of repayment\. It is classified as a current liability\./);
  const rel = buildFs({ ...base, cur: new Map([...cur, ["2860", 1000], ["1002", 51000.25]]), related: { "2860": "Birch Holdings Inc." } });
  assert.equal(rel.notes.related?.n, 4);
  assert.equal(rel.bs.cl.find((r) => r.code === "2860")?.cap, "Due to related parties (Birch Holdings Inc.)");
});

test("dividends: written negative in the codes, shown as a deduction in retained earnings", () => {
  const m = buildFs({ ...base, cur: new Map([...cur, ["3701", -5000], ["1002", 45000.25]]) });
  assert.equal(m.is.div.cur, 5000);
  assert.deepEqual(m.failed, []);
});

test("amounts print as Appendix C: commas, brackets, a dash for zero", () => {
  assert.equal(n(1234567), "1,234,567");
  assert.equal(n(-500), "(500)");
  assert.equal(n(0), "-");
});
