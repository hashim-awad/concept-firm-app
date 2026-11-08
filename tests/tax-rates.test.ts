// The CRA table the app loads: every province and territory once, HST only where CRA charges it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CRA_TABLE, CRA_RATES_PAGE } from "../src/lib/tax/cra-rates.ts";

test("13 provinces and territories, each once, GST/HST only", () => {
  const codes = CRA_TABLE.rates.map((r) => r.province).sort();
  assert.deepEqual(codes, ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
  for (const r of CRA_TABLE.rates) {
    assert.ok(["GST", "HST"].includes(r.tax));
    if (r.tax === "GST") assert.equal(r.rate, 5, `${r.name}: GST is 5%`);
    else assert.ok(r.rate > 5, `${r.name}: HST includes the provincial part`);
  }
  assert.match(CRA_RATES_PAGE, /^https:\/\/www\.canada\.ca\//);
});
