// Run with: npm test
// Negative amounts (Hashim, Nov 15, 2026, item C): on PDFs, Excel and client documents a negative shows in
// black brackets, (1,234.00), never red and never a minus sign. CSV files keep a leading minus (machine-read).
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { bracketAmount, negativeTone } from "../src/lib/closebook/amount.ts";
import { money as wpMoney, tbFlatSection, type WpCtx } from "../src/lib/closebook/wp-doc.ts";
import { n as fsAmount } from "../src/lib/closebook/fs-model.ts";
import { money as fsTextMoney } from "../src/lib/closebook/fs-text.ts";
import { money as emailMoney } from "../src/lib/closebook/fs-email.ts";
import { reportXlsx } from "../src/lib/closebook/xlsx-write.ts";
import { readXlsx } from "../src/lib/closebook/xlsx.ts";
import { money as quoteMoney } from "../src/lib/t1-quote/render.ts";
import { formatCents } from "../src/lib/screening/engine.ts";
import { accountCsv, accountXlsx } from "../src/lib/statements/export.ts";
import { money as checksMoney } from "../src/lib/statements/checks.ts";
import { money as stmtMoney, parseMoney } from "../src/app/(app)/statements/format.ts";
import type { StatementAccount } from "../src/lib/statements/types.ts";
import type { TbLine } from "../src/lib/closebook/reports.ts";

const ctx: WpCtx = { client: "Dummy Co", yearEnd: "2026-12-31", yearStart: "2026-01-01", packageName: "Test", stamp: "Working paper", generated: "", preparedBy: "", reviewedBy: "", wpBox: false };
const line = (cents: number): TbLine => ({ key: "k", number: "1000", name: "Test account", line_no: null, last: 0, opening: 0, activity: 0, prelim: cents, adjust: 0, reclass: 0, final: cents, diff: cents });
// Every pdfmake node in a definition, depth first.
const nodes = (x: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
  if (Array.isArray(x)) x.forEach((y) => nodes(y, out));
  else if (x && typeof x === "object") { out.push(x as Record<string, unknown>); Object.values(x).forEach((y) => nodes(y, out)); }
  return out;
};

test("PDF working papers: (1,234.00) in black, no minus sign", () => {
  assert.equal(wpMoney(-123400), "(1,234.00)");
  assert.equal(wpMoney(123400), "1,234.00");
  const cells = nodes(tbFlatSection(ctx, [line(-123400)], line(-123400), "TB")).filter((c) => c.text === "(1,234.00)");
  assert.ok(cells.length >= 3, "prelim, final and $ change");
  for (const c of cells) assert.ok(c.color === undefined || c.color === "#000000", `black, not ${String(c.color)}`);
  assert.ok(!nodes(tbFlatSection(ctx, [line(-123400)], line(-123400), "TB")).some((c) => typeof c.text === "string" && /^-\d/.test(c.text)), "never a minus sign");
});

test("financial statements and client documents: black brackets, never a minus sign", () => {
  assert.equal(fsAmount(-1234), "(1,234)");
  assert.equal(fsTextMoney(-1234), "($1,234)");
  assert.equal(fsTextMoney(1234), "$1,234");
  assert.equal(emailMoney(-1234.5), "($1,234.50)");
  assert.equal(emailMoney(1234), "$1,234");
  assert.equal(quoteMoney(-123400), "($1,234.00)");
  assert.equal(quoteMoney(54700), "$547.00", "positive amounts are unchanged");
  assert.equal(formatCents(-123400), "($1,234.00)");
});

test("Excel: the amount format is #,##0.00;(#,##0.00) with no [Red], and the amount stays a number", async () => {
  const x = reportXlsx({ title: "Test", columns: ["Account", "Amount"], numeric: [false, true], rows: [{ cells: ["Dummy", -123400] }] }, [], "Working paper");
  const zip = await JSZip.loadAsync(x);
  const styles = await zip.file("xl/styles.xml")!.async("string");
  assert.match(styles, /formatCode="#,##0\.00;\(#,##0\.00\)/);
  assert.doesNotMatch(styles, /\[Red\]/i);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const cell = /<c r="B\d+" s="(\d+)"><v>(-1234\.00)<\/v><\/c>/.exec(sheet);
  assert.ok(cell, "a number Excel can add up");
  // Style 2 (amount) uses font 0, which has no colour.
  const xf = [...styles.matchAll(/<xf numFmtId="(\d+)" fontId="(\d+)"[^>]*xfId="0"/g)][Number(cell![1])];
  assert.equal(xf[1], "164");
  const font = [...styles.matchAll(/<font>(.*?)<\/font>/g)][Number(xf[2])][1];
  assert.doesNotMatch(font, /color/);
});

const card = (opening: number): StatementAccount => ({
  key: "a1", last4: "9034", name: "Visa Business", kind: "card", periodStart: "2026-02-16", periodEnd: "2026-03-15",
  opening, closing: opening - 150000, summary: null,
  lines: [{ id: "l1", date: "2026-02-24", description: "PAYMENT", amountCents: 150000, dir: "out", balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read" }],
});

test("statements tool: Excel heading in brackets; the CSV keeps its minus (template layout unchanged)", () => {
  const rows = readXlsx(accountXlsx(card(-25000), "Northern Dummy Bank"))[0].rows.map((r) => r.map((c) => String(c ?? "")));
  assert.ok(rows.some((r) => r[0] === "Opening balance: ($250.00)"));
  assert.equal(accountCsv(card(-25000)).split("\r\n")[1], "2026-02-24,PAYMENT,-1500.00");
  assert.equal(checksMoney(-5025), "($50.25)");
});

test("on screen: brackets for the verify screen, red by class; a minus or brackets typed both read as negative", () => {
  assert.equal(stmtMoney(-6267900), "(62,679.00)");
  assert.equal(parseMoney("(62,679.00)"), -6267900);
  assert.equal(parseMoney("-62,679.00"), -6267900);
  assert.equal(bracketAmount(-100), "(1.00)");
  assert.equal(negativeTone(-1), "text-danger");
  assert.equal(negativeTone(0), "");
  assert.equal(negativeTone(null), "");
});
