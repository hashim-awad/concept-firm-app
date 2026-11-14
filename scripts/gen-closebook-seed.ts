// Writes Closebook's reference data (Phase 3 batch Appendices A and B, in docs/phase3/) into the
// structure migration, between the GENERATED markers. Run: node --experimental-strip-types scripts/gen-closebook-seed.ts
// tests/closebook-seed.test.ts checks the migration still matches the appendices.
import { readFileSync, writeFileSync } from "node:fs";
import { fromWorkbook, gifiFromCsv, seedSql } from "../src/lib/closebook/seed.ts";

const MIGRATION = "supabase/migrations/20261111000000_closebook_structure.sql";
const BEGIN = "-- BEGIN GENERATED (scripts/gen-closebook-seed.ts from docs/phase3 Appendices A and B)";
const END = "-- END GENERATED";

export function generated(): string {
  const wb = fromWorkbook(readFileSync("docs/phase3/archive/Closebook-master-lines-2026-11-11-seed.xlsx"));
  const gifi = gifiFromCsv(readFileSync("docs/phase3/GIFI-Concept-RC4088-Rev23.csv", "utf8"));
  return seedSql(gifi, wb);
}

if (process.argv[1]?.endsWith("gen-closebook-seed.ts")) {
  const sql = readFileSync(MIGRATION, "utf8");
  const a = sql.indexOf(BEGIN), b = sql.indexOf(END);
  if (a < 0 || b < a) throw new Error("Markers not found in " + MIGRATION);
  writeFileSync(MIGRATION, sql.slice(0, a + BEGIN.length) + "\n" + generated() + "\n" + sql.slice(b));
  console.log("Wrote the Closebook seed into " + MIGRATION);
}
