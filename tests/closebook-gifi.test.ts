// Run with: npm test
// The GIFI export (Hashim, Nov 13, 2026): QuickBooks' layout, checked against docs/phase3/Sample-GIFI-TestCo.gfi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromWorkbook } from "../src/lib/closebook/seed.ts";
import type { Line } from "../src/lib/closebook/matching.ts";
import { businessNumber, gifiCodes, gifiFile, type GifiAccount } from "../src/lib/closebook/gifi.ts";
import { gifiChecks, gifiFileName, taxWorkpaper, tieOut } from "../src/lib/closebook/t2.ts";

const wb = fromWorkbook(readFileSync(new URL("../docs/phase3/Closebook-master-lines-APPROVED.xlsx", import.meta.url)));
const lines: Line[] = wb.lines.map((l) => ({ line_no: l.line, name: l.name, gifi_code: l.gifi, line_type: l.type, lead_sheet: l.leadSheet, statement_line: l.statementLine, default_tax_code: l.taxCode, mappable: l.mappable, pair_line: l.pair, locked: ["1301.00", "2781.00", "3701.00"].includes(l.line) }));
const byNo = new Map(lines.map((l) => [l.line_no, l]));
const sample = readFileSync(new URL("../docs/phase3/Sample-GIFI-TestCo.gfi", import.meta.url), "utf8");
const sampleCodes = sample.split("\r\n").slice(1).map((r) => { const [c, v] = r.split(","); return [c.replace(/"/g, ""), Number(v)] as [string, number]; });

// A trial balance that gives the sample: one account per GIFI code, on the code's main line (.00), with
// the debit-positive balance that produces the sample's amount.
function trialBalance(): GifiAccount[] {
  return sampleCodes.map(([code, amt], i) => {
    const lineNo = code === "3660" ? "3600.00" : `${code}.00`;
    const l = byNo.get(lineNo)!;
    const credit = l.line_type === "Liability" || l.line_type === "Revenue" || l.line_type === "Equity";
    return { id: `a${i}`, number: String(1000 + i), name: `Account ${code}`, line_no: lineNo, this_year: credit ? -amt : amt, needs_reviewer: false };
  });
}

test("the sample trial balance gives the sample's codes and amounts exactly", () => {
  const r = gifiCodes(trialBalance(), new Map(), byNo);
  assert.deepEqual(r.codes, sampleCodes);
});

test("the file matches QuickBooks' layout: header positions, CRLF, 2 decimals, no total lines", () => {
  const tb = trialBalance();
  const r = gifiCodes(tb, new Map(), byNo);
  const file = gifiFile({ bn: "000000000RC0001", legalName: "Test Co Inc.", address: "100 SAMPLE ST", city: "Kitchener", province: "ON", postal: "N2N 0A1", yearEnd: "2026-03-31", created: "2026-11-12" }, r.codes);
  const [head, ...rows] = file.split("\r\n");
  const ours = head.split(","), theirs = sample.split("\r\n")[0].split(",");
  assert.equal(ours.length, theirs.length, "24 header fields");
  for (const i of [0, 13, 14, 16, 17, 18, 19, 21, 22]) assert.equal(ours[i], theirs[i], `header field ${i + 1}`);
  assert.deepEqual(rows, sample.split("\r\n").slice(1), "the code lines, byte for byte");
  assert.ok(!file.endsWith("\r\n"), "no line break after the last line, as the sample");
  assert.ok(!/"(2599|3499|3620|3640|8299|9368|9999|3849)"/.test(file), "no total lines");
});

test("contra and deficit balances are negative; revenue and expenses positive", () => {
  const r = gifiCodes(trialBalance(), new Map(), byNo);
  const m = new Map(r.codes);
  assert.ok(m.get("1743")! < 0 && m.get("3660")! < 0 && m.get("8000")! > 0 && m.get("9060")! > 0);
});

test("the required totals are checked: a trial balance out of balance is refused", () => {
  const tb = trialBalance();
  tb[0].this_year += 10;
  const r = gifiCodes(tb, new Map(), byNo);
  assert.ok(r.problems.some((p) => /out by/.test(p)));
  assert.ok(r.problems.some((p) => /do not equal total liabilities and equity/.test(p)));
});

test("unmatched, reviewer and locked accounts stop the export", () => {
  const tb = trialBalance();
  tb.push({ id: "x1", number: "9999", name: "Suspense", line_no: null, this_year: 0.01, needs_reviewer: false });
  tb.push({ id: "x2", number: "2100", name: "Shareholder loan", line_no: "2781.00", this_year: -0.01, needs_reviewer: false });
  const r = gifiCodes(tb, new Map(), new Map([...byNo].map(([k, l]) => [k, k === "2781.00" ? { ...l, locked: true } : l])));
  assert.ok(r.problems.some((p) => /Suspense is not matched/.test(p)));
  assert.ok(r.problems.some((p) => /locked line/.test(p)));
});

test("the made-up sample itself does not tie: 2599 is 1,654.27 more than 3640, so Closebook would refuse it", () => {
  const r = gifiCodes(trialBalance(), new Map(), byNo);
  assert.equal(Math.round((r.totals["2599"] - r.totals["3640"]) * 100) / 100, 1654.27);
  assert.ok(r.problems.length > 0);
});

test("a balanced trial balance ties and is ready", () => {
  const tb = trialBalance();
  tb.push({ id: "fix", number: "3001", name: "Balancing", line_no: "3500.00", this_year: -1654.27, needs_reviewer: false });
  const r = gifiCodes(tb, new Map(), byNo);
  assert.deepEqual(r.problems, []);
  assert.equal(r.totals["2599"], r.totals["3640"]);
});

// Round 10 (Hashim, Nov 27, 2026).
const head = { bn: "000000000RC0001", legalName: "Test Co Inc.", address: "100 SAMPLE ST", city: "Kitchener", province: "ON", postal: "N2N 0A1", yearEnd: "2026-03-31", created: "2026-11-12" };

test("round 10: with QuickBooks' own vendor and software, the file is the sample byte for byte", () => {
  const r = gifiCodes(trialBalance(), new Map(), byNo);
  assert.equal(gifiFile({ ...head, vendor: "Intuit Inc.", software: "QuickBooks Online" }, r.codes), sample);
});

test("round 10: Closebook's header: field 6 Concept Accounting, 11 Concept Studio, 14 the 15-character BN, the rest as the sample", () => {
  const r = gifiCodes(trialBalance(), new Map(), byNo);
  const ours = gifiFile(head, r.codes).split("\r\n")[0].split(","), theirs = sample.split("\r\n")[0].split(",");
  assert.equal(ours.length, 24);
  assert.equal(ours[5], '"Concept Accounting"');
  assert.equal(ours[10], '"Concept Studio"');
  for (let i = 0; i < 24; i++) if (i !== 5 && i !== 10) assert.equal(ours[i], theirs[i], `field ${i + 1}`);
});

test("round 10: a Business Number of 9 digits gets RC0001; 15 characters stay; anything else is refused", () => {
  assert.equal(businessNumber("123456789"), "123456789RC0001");
  assert.equal(businessNumber("123456789RC0002"), "123456789RC0002");
  assert.equal(businessNumber(""), null);
  assert.equal(businessNumber("12345"), null);
});

test("round 10: file names", () => {
  assert.equal(gifiFileName("Birch Dummy Realty Inc.", "2026-12-31", "before_tax"), "Birch Dummy Realty Inc. GIFI 2026-12-31 before tax entries.gfi");
  assert.equal(gifiFileName("A/B: Co", "2026-12-31", "final"), "AB Co GIFI 2026-12-31 final.gfi");
});

test("round 10: the five checks, with their figures; the sample fails the balance sheet check by 1,654.27", () => {
  const r = gifiCodes(trialBalance(), new Map(), byNo);
  const c = gifiChecks(r, r.totals["3660"]);
  assert.deepEqual(c.map((x) => x.key), ["tb", "bs", "ni", "re", "opening"]);
  assert.equal(c.find((x) => x.key === "bs")!.ok, false);
  assert.equal(c.find((x) => x.key === "bs")!.rows.at(-1)!.amount, 1654.27);
  assert.equal(c.find((x) => x.key === "opening")!.ok, true);
  const tb = trialBalance();
  tb.push({ id: "fix", number: "3001", name: "Balancing", line_no: "3500.00", this_year: -1654.27, needs_reviewer: false });
  const ok = gifiChecks(gifiCodes(tb, new Map(), byNo), -80534.59);
  assert.ok(ok.every((x) => x.ok), JSON.stringify(ok.filter((x) => !x.ok).map((x) => x.result)));
  const noStep2 = gifiChecks(gifiCodes(tb, new Map(), byNo), null).find((x) => x.key === "opening")!;
  assert.equal(noStep2.ok, false);
  const off = gifiChecks(gifiCodes(tb, new Map(), byNo), -80000).find((x) => x.key === "opening")!;
  assert.equal(off.result, "Off by (534.59)");
});

test("round 10: retained earnings: start + net income − dividends + prior period + other = end", () => {
  const tb = trialBalance();
  tb.push({ id: "fix", number: "3001", name: "Balancing", line_no: "3500.00", this_year: -1654.27, needs_reviewer: false });
  tb.push({ id: "div", number: "3700", name: "Dividends", line_no: "3700.00", this_year: 5000, needs_reviewer: false });
  tb.push({ id: "cash", number: "1001", name: "Cash", line_no: "1002.00", this_year: -5000, needs_reviewer: false });
  const r = gifiCodes(tb, new Map(), byNo);
  assert.equal(r.re.dividends, 5000);
  assert.equal(new Map(r.codes).get("3700"), -5000, "dividends are written negative (rule 1, Nov 14)");
  const re = gifiChecks(r, -80534.59).find((x) => x.key === "re")!;
  assert.ok(re.ok);
  assert.equal(r.totals["3849"], Math.round((r.totals["3660"] + r.totals["9999"] - 5000) * 100) / 100);
});

test("round 10: tax workpaper: meals add back 50%, amortization and income tax 100%, a REVIEW line waits for the reviewer", () => {
  const codes = new Map([["M50", { name: "Meals", rule: "Add back 50%" }], ["AMORT", { name: "Amortization", rule: "" }], ["INCTAX", { name: "Income tax", rule: "" }], ["REVIEW", { name: "Reviewer decides", rule: "" }]]);
  const w = taxWorkpaper([
    { label: "60200 Meals", line_no: "8523.00", gifi: "8523", lineType: "Expense", code: "M50", amount: 1000 },
    { label: "70100 Amortization", line_no: "8670.00", gifi: "8670", lineType: "Expense", code: "AMORT", amount: 1960 },
    { label: "72000 Income tax", line_no: "9990.00", gifi: "9990", lineType: "Expense", code: "INCTAX", amount: 800 },
    { label: "40800 FX gain", line_no: "8231.00", gifi: "8231", lineType: "Revenue", code: "REVIEW", amount: 120 },
    { label: "61000 Bank fees", line_no: "8710.00", gifi: "8710", lineType: "Expense", code: "FULL", amount: 300 },
  ], codes, new Map());
  assert.deepEqual(w.map((x) => [x.code, x.total, x.effect, x.open]), [["M50", 1000, 500, 0], ["AMORT", 1960, 1960, 0], ["INCTAX", 800, 800, 0], ["REVIEW", 120, 0, 1]]);
  const set = taxWorkpaper([{ label: "40800 FX gain", line_no: "8231.00", gifi: "8231", lineType: "Revenue", code: "REVIEW", amount: 120 }], codes, new Map([["8231.00", "deduct100"]]));
  assert.equal(set[0].effect, -120);
});

test("round 10: tie-out: Closebook less ProFile; within $5 is rounding; over it stays open until accepted at that signed amount; CCA skipped with book amortization", () => {
  const cb = { ni: 1036.63, assets: 65624.5, amort: 1960, tax: 800 };
  // Birch in ProFile: every line rounded to whole dollars.
  const t = tieOut(cb, { ni: 1036, assets: 65625, cca: 1960, tax: 800 }, {}, false);
  assert.deepEqual(t.map((x) => [x.key, x.diff, x.rounding, x.open]), [["ni", 0.63, true, false], ["assets", -0.5, true, false], ["cca", 0, false, false], ["tax", 0, false, false]]);
  const d = tieOut(cb, { ni: 1036, assets: 65625, cca: 1960, tax: 812.5 }, {}, false);
  assert.deepEqual(d.filter((x) => x.open).map((x) => [x.key, x.diff]), [["tax", -12.5]], "(12.50): Closebook less ProFile");
  const acc = tieOut(cb, { ni: 1036, assets: 65625, cca: 1500, tax: 812.5 }, { tax: { diff: -12.5, by: "o", at: "", reason: "Late change" } }, true);
  assert.deepEqual(acc.filter((x) => x.open).map((x) => x.key), [], "accepted, and CCA not compared");
  const flip = tieOut(cb, { ni: 1036, assets: 65625, cca: 1960, tax: 787.5 }, { tax: { diff: -12.5, by: "o", at: "", reason: "Late change" } }, false);
  assert.ok(flip.find((x) => x.key === "tax")!.open, "12.50 is not (12.50)");
  assert.ok(tieOut(cb, { ni: 1036, assets: 65625, cca: 1960, tax: 800 }, {}, false, 0).find((x) => x.key === "ni")!.open, "the rounding allowed is a setting");
});
