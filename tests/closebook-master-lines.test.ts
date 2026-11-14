// Run with: npm test
// The master lines file is the one source (round 12): the database test that compares it with the
// database after every migration must be generated from the file as it is now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { masterLinesCheck } from "../scripts/gen-master-lines-check.ts";

test("the master lines database test is generated from the file, unchanged", () => {
  const file = readFileSync(new URL("../docs/phase3/Closebook-master-lines-APPROVED.xlsx", import.meta.url));
  const sql = readFileSync(new URL("../supabase/tests/closebook_master_lines_test.sql", import.meta.url), "utf8");
  assert.equal(sql, masterLinesCheck(file), "run: node --experimental-strip-types scripts/gen-master-lines-check.ts");
});
