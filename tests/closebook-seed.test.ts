// Run with: npm test
// Closebook reference data (Phase 3 batch, Appendices A and B): the migration holds exactly what the
// appendices say, with today's package captions on the statement lines (batch section 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromWorkbook, gifiFromCsv, parseCsv, seedSql, PACKAGE_CAPTIONS } from "../src/lib/closebook/seed.ts";
import { readXlsx } from "../src/lib/closebook/xlsx.ts";

const wb = fromWorkbook(readFileSync(new URL("../docs/phase3/Closebook-master-lines-APPROVED.xlsx", import.meta.url)));
const gifi = gifiFromCsv(readFileSync(new URL("../docs/phase3/GIFI-Concept-RC4088-Rev23.csv", import.meta.url), "utf8"));
const migration = readFileSync(new URL("../supabase/migrations/20261111000000_closebook_structure.sql", import.meta.url), "utf8");

test("the migration's seed is generated from the appendices, unchanged", () => {
  const a = migration.indexOf("-- BEGIN GENERATED"), b = migration.indexOf("-- END GENERATED");
  const inFile = migration.slice(migration.indexOf("\n", a) + 1, b).trim();
  assert.equal(inFile, seedSql(gifi, wb).trim(), "run: node --experimental-strip-types scripts/gen-closebook-seed.ts");
});

test("the batch's numbers", () => {
  assert.equal(gifi.length, 404);
  assert.deepEqual(gifi.filter((g) => g.required).map((g) => g.code), ["2599", "3499", "3620", "3849", "8299", "9368", "9999"]);
  assert.equal(wb.lines.length, 419);
  assert.equal(wb.lines.filter((l) => !l.mappable).length, 23);
  assert.equal(wb.lines.filter((l) => !l.line.endsWith(".00")).length, 15);
  assert.equal(wb.taxCodes.length, 11);
  assert.equal(wb.leadSheets.length, 20);
});

test("every line is consistent", () => {
  const nums = new Set(wb.lines.map((l) => l.line));
  for (const g of gifi) assert.ok(nums.has(`${g.code}.00`), `GIFI ${g.code} has its line`);
  for (const l of wb.lines) {
    assert.ok(l.line.startsWith(l.gifi + "."), l.line);
    if (l.pair) assert.ok(nums.has(l.pair), `${l.line} pairs with a real line`);
    if (l.mappable) assert.ok(l.leadSheet && l.statementLine && l.taxCode, `${l.line} has its lead sheet, statement line and tax code`);
    else assert.ok(!l.leadSheet && !l.taxCode, `${l.line} is a calculated total`);
  }
  const codes = new Set(wb.taxCodes.map((t) => t.code)), sheets = new Set(wb.leadSheets.map((s) => s.code));
  assert.ok(wb.lines.every((l) => !l.taxCode || codes.has(l.taxCode)) && wb.lines.every((l) => !l.leadSheet || sheets.has(l.leadSheet)));
});

test("today's package captions sit on the statement lines", () => {
  const sl = (n: string) => wb.lines.find((l) => l.line === n)!.statementLine;
  for (const [code, caption] of Object.entries(PACKAGE_CAPTIONS)) assert.equal(sl(`${code}.00`), caption, code);
  assert.equal(sl("1002.00"), "Cash and cash equivalents", "cash 1000 to 1059 merged");
  assert.equal(sl("1301.10"), wb.lines.find((l) => l.line === "1301.10")!.statementLine, "sub-lines keep their own caption");
});

test("CSV reader: quotes, commas and new lines inside fields", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi""\nthere"\n'), [["a", "b"], ["x, y", 'he said "hi"\nthere']]);
});

test("Excel reader: sheet names, text and numbers", () => {
  const sheets = readXlsx(readFileSync(new URL("../docs/phase3/Closebook-master-lines-APPROVED.xlsx", import.meta.url)));
  assert.deepEqual(sheets.map((s) => s.name), ["Read me", "Master lines", "Tax codes", "Lead sheets", "Decisions for Hashim"]);
  assert.equal(sheets[3].rows[1][1], 9, "a number stays a number");
  assert.equal(sheets[1].rows[0][0], "Line no.");
});
