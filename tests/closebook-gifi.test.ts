// Run with: npm test
// The GIFI export (Hashim, Nov 13, 2026): QuickBooks' layout, checked against docs/phase3/Sample-GIFI-TestCo.gfi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromWorkbook } from "../src/lib/closebook/seed.ts";
import type { Line } from "../src/lib/closebook/matching.ts";
import { gifiCodes, gifiFile, type GifiAccount } from "../src/lib/closebook/gifi.ts";

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
  const file = gifiFile({ bn: "000000000", legalName: "Test Co Inc.", address: "100 SAMPLE ST", city: "Kitchener", province: "ON", postal: "N2N 0A1", yearEnd: "2026-03-31", created: "2026-11-12" }, r.codes);
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
