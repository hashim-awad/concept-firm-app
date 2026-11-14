// Run with: npm test
// The standard chart file is the one source (round 14): the database test that compares it with the
// database after every migration must be generated from the file as it is now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, standardChartCheck } from "../scripts/gen-standard-chart-check.ts";

test("the standard chart database test is generated from the file, unchanged", () => {
  const file = readFileSync(new URL("../docs/phase3/Closebook-standard-chart-APPROVED.csv", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/tests/closebook_standard_chart_test.sql", import.meta.url), "utf8");
  assert.equal(sql, standardChartCheck(file), "run: node --experimental-strip-types scripts/gen-standard-chart-check.ts");
});

test("the file: five-digit numbers, 42400 on line 8230, quoted fields read whole", () => {
  const rows = parseCsv(readFileSync(new URL("../docs/phase3/Closebook-standard-chart-APPROVED.csv", import.meta.url), "utf8")).slice(1).filter((r) => r[0]);
  assert.ok(rows.every((r) => /^\d{5}$/.test(r[0]) && r.length === 9), "every row: a five-digit number and nine columns");
  assert.deepEqual(rows.find((r) => r[0] === "42400")?.slice(0, 4), ["42400", "GST/HST quick method gain", "Revenue", "8230.00"]);
  assert.deepEqual(parseCsv('a,"b, ""c""",d\n'), [["a", 'b, "c"', "d"]]);
});
