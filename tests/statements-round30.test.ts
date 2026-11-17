// Round 30 (Hashim, Nov 17, 2026): a 3-page business card statement whose second cardholder's section starts with
// purchases dated two days before the period, posted inside it. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeResult } from "../src/lib/statements/fixture-reader.ts";
import { cardKindCheck, checkAccount } from "../src/lib/statements/checks.ts";
import { yearCut } from "../src/lib/closebook/step3.ts";
import type { ReadResult } from "../src/lib/statements/types.ts";

const read = (f: string) => normalizeResult(JSON.parse(readFileSync(new URL(`./fixtures/statements/round30/${f}`, import.meta.url), "utf8")) as ReadResult, 3).accounts[0];

for (const [f, what] of [["card-3p-2026-07-18.json", "with the posting dates"], ["card-3p-2026-07-18-noposted.json", "read without the second cardholder's posting dates"]] as const) {
  test(`3-page card statement ${what}: all lines read, every kind matches, nothing to fix`, () => {
    const a = read(f);
    const early = a.lines.filter((l) => l.date < a.periodStart);
    assert.deepEqual([a.lines.length, new Set(a.lines.map((l) => l.page)).size, early.length, new Set(early.map((l) => l.holder)).size], [50, 2, 4, 1]);
    assert.ok(early.every((l) => l.holder === "9032"), "the early purchases are in the second cardholder's section");
    const c = checkAccount(a);
    assert.deepEqual([c.differenceCents, c.review, c.ok], [0, [], true]);
    assert.ok(cardKindCheck(a).every((r) => r.off === 0));
    assert.deepEqual(early.map((l) => l.date), ["2026-07-16", "2026-07-16", "2026-07-17", "2026-07-17"], "the purchase date stays the line's date");
    assert.equal(yearCut(a, "2025-09-01", "2026-08-31").inYear.length, 50, "and decides the year");
  });
}

test("a card purchase more than 31 days before the period, with no posting date, is still a problem", () => {
  const a = read("card-3p-2026-07-18-noposted.json");
  const bad = { ...a, lines: a.lines.map((l, i) => (i === a.lines.length - 1 ? { ...l, date: "2026-06-01" } : l)) };
  assert.equal(checkAccount(bad).review.length, 1);
});
