// Run with: npm test
// The dummy statements in tests/fixtures/statements (round 20, Hashim, Nov 15, 2026). Each <name>.json is what a
// perfect reader returns for that file, so it must tie to the cent: opening + lines = closing, the printed
// summary totals and counts match, and the running balance is right on every line that prints one.
// mismatch.json is the one exception: it has a reader mistake on purpose, so it must NOT tie out.
// The fixtures are made by tests/fixtures/statements/make.mjs.
import { normalizeResult } from "../src/lib/statements/fixture-reader.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { signedCents, type ReadResult, type StatementAccount } from "../src/lib/statements/types.ts";

const dir = new URL("./fixtures/statements/", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, dir));
const manifest = JSON.parse(read("manifest.json").toString("utf8")) as Record<string, { file: string; result?: string; error?: string }>;
const entries = Object.entries(manifest);
const results = entries.filter(([, v]) => v.result).map(([, v]) => ({ file: v.file, json: v.result!, r: normalize(JSON.parse(read(v.result!).toString("utf8")) as ReadResult) }));
// Round 28: as the app reads them (the test reader marks the lines with no effect on the balance).
function normalize(r: ReadResult): ReadResult { return normalizeResult(r, r.pages); }

type Tie = { difference: number; inTotal: number; inCount: number; outTotal: number; outCount: number; runningBreak: string | null };
function tie(a: StatementAccount): Tie {
  let bal = a.opening, inTotal = 0, inCount = 0, outTotal = 0, outCount = 0;
  let runningBreak: string | null = null;
  for (const l of a.lines) {
    bal += signedCents(l);
    if (l.noEffect) { /* information only: in no total */ } else if (l.dir === "in") { inTotal += l.amountCents; inCount++; } else { outTotal += l.amountCents; outCount++; }
    if (l.balanceCents !== null && l.balanceCents !== bal && !runningBreak) runningBreak = l.id;
  }
  return { difference: a.closing - bal, inTotal, inCount, outTotal, outCount, runningBreak };
}

test("the manifest: every file exists with the stated sha256, results and errors as planned", () => {
  assert.ok(entries.length >= 22);
  for (const [hash, v] of entries) {
    assert.ok(existsSync(new URL(v.file, dir)), `${v.file} is missing`);
    assert.equal(createHash("sha256").update(read(v.file)).digest("hex"), hash, `${v.file} hash`);
    assert.ok(Boolean(v.result) !== Boolean(v.error), `${v.file}: a result or an error, not both`);
    if (v.result) assert.ok(existsSync(new URL(v.result, dir)), `${v.result} is missing`);
  }
  const errors = Object.fromEntries(entries.filter(([, v]) => v.error).map(([, v]) => [v.file, v.error]));
  assert.deepEqual(errors, { "out-of-credits.pdf": "out_of_credits", "unreadable.pdf": "unreadable" });
  const names = results.map((x) => x.file);
  for (const f of ["chequing-savings.pdf", "card.pdf", "locked.pdf", "two-page.pdf", "scanned.pdf", "scanned-photo.jpg", "long-400.pdf", "mismatch.pdf"]) assert.ok(names.includes(f), f);
  assert.equal(names.filter((f) => f.startsWith("batch/")).length, 12);
});

test("every result has the ReadResult shape: ids in order, keys a1.., cents, dates and pages", () => {
  for (const { file, r } of results) {
    assert.ok(r.bank && r.pages >= 1 && r.accounts.length >= 1, file);
    let n = 0;
    r.accounts.forEach((a, k) => {
      assert.equal(a.key, `a${k + 1}`, file);
      assert.match(a.last4, /^\d{4}$/, file);
      assert.ok(a.kind === "bank" || a.kind === "card", file);
      assert.ok(a.periodStart <= a.periodEnd, file);
      assert.ok(Number.isInteger(a.opening) && Number.isInteger(a.closing), file);
      let page = 1;
      for (const l of a.lines) {
        assert.equal(l.id, `l${++n}`, `${file} ${l.id}`);
        assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok((l.postedDate || l.printedDate || l.date) >= a.periodStart && (l.postedDate || l.printedDate || l.date) <= a.periodEnd, `${file} ${l.id} date in the period`);
        assert.ok(Number.isInteger(l.amountCents) && l.amountCents > 0, `${file} ${l.id} amount`);
        assert.ok(l.dir === "in" || l.dir === "out");
        assert.ok(l.balanceCents === null || Number.isInteger(l.balanceCents));
        assert.ok(l.page >= page && l.page <= r.pages, `${file} ${l.id} page`);
        page = l.page;
        assert.equal(l.source, "read");
        assert.ok(l.description.length > 0);
        if (!l.unsure) assert.equal(l.unsureReason, "");
      }
    });
  }
});

test("every statement but mismatch ties to the cent: total, summary, running balance", () => {
  for (const { file, r } of results) {
    // Round 23: one statement read with an amount wrong, on purpose (the fix screen).
    if (file === "mismatch.pdf" || file === "round23/rbc-sav-2026-03-misread.pdf" || file === "round26/card-2025-10-18.pdf") continue;
    // Round 22: two lines the reader was not sure of, on purpose ("Needs a look"); the figures still tie.
    const unsureOnPurpose = file === "round22/mdb-visa-2025-11.pdf";
    for (const a of r.accounts) {
      const t = tie(a);
      assert.equal(t.difference, 0, `${file} ${a.key} difference`);
      assert.equal(t.runningBreak, null, `${file} ${a.key} running balance`);
      // Round 23: these statements print no summary, on purpose ("Find it" works without one). Round 24's are
      // copies of a round 23 statement (Replace file).
      if (file.startsWith("round23/") || file.startsWith("round24/") || file === "round28/chq-2025-09.pdf") { assert.equal(a.summary, null, `${file} prints no summary`); continue; }
      assert.ok(a.summary, `${file} ${a.key} summary`);
      assert.equal(a.summary.inTotal, t.inTotal, `${file} ${a.key} money in`);
      assert.equal(a.summary.outTotal, t.outTotal, `${file} ${a.key} money out`);
      if (a.summary.inCount !== null) assert.equal(a.summary.inCount, t.inCount, `${file} ${a.key} in count`);
      if (a.summary.outCount !== null) assert.equal(a.summary.outCount, t.outCount, `${file} ${a.key} out count`);
      if (!unsureOnPurpose) assert.ok(a.lines.every((l) => !l.unsure), `${file} nothing unsure`);
    }
  }
});

test("chequing-savings: the mock's numbers, two accounts, one page", () => {
  const { r } = results.find((x) => x.file === "chequing-savings.pdf")!;
  assert.equal(r.pages, 1);
  const [c, s] = r.accounts;
  assert.deepEqual([c.last4, c.opening, c.closing, c.lines.length], ["4821", 1248015, 1730640, 9]);
  assert.deepEqual(c.summary, { inTotal: 1245000, inCount: 3, outTotal: 762375, outCount: 6 });
  assert.deepEqual([s.last4, s.opening, s.closing, s.lines.length], ["7730", 2500000, 3004110, 2]);
  assert.deepEqual(s.summary, { inTotal: 504110, inCount: 2, outTotal: 0, outCount: 0 });
  assert.equal(s.lines[0].id, "l10");
});

test("card: a card account, charges in and payments out, about 20 lines, no running balance", () => {
  const { r } = results.find((x) => x.file === "card.pdf")!;
  const a = r.accounts[0];
  assert.equal(a.kind, "card");
  assert.ok(a.lines.length >= 18 && a.lines.length <= 25);
  assert.ok(a.lines.some((l) => l.dir === "out") && a.lines.some((l) => l.dir === "in"));
  assert.ok(a.lines.every((l) => l.balanceCents === null));
  assert.ok(a.closing > 0);
});

test("two-page and long-400: lines run onto later pages with the balance carried forward", () => {
  const two = results.find((x) => x.file === "two-page.pdf")!.r;
  assert.equal(two.pages, 2);
  const lines = two.accounts[0].lines;
  assert.ok(lines.length >= 40);
  assert.ok(lines.some((l) => l.page === 1) && lines.some((l) => l.page === 2));
  const long = results.find((x) => x.file === "long-400.pdf")!.r;
  assert.ok(long.accounts[0].lines.length >= 420);
  assert.ok(long.pages >= 5);
  assert.ok(long.accounts[0].lines.every((l) => l.balanceCents !== null));
});

test("batch: 12 months of account 4521, each closing is the next opening, 10 to 25 lines each", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const accs = months.map((m) => results.find((x) => x.file === `batch/Statement-${m}-2026.pdf`)!.r.accounts[0]);
  accs.forEach((a, i) => {
    assert.equal(a.last4, "4521");
    assert.equal(a.periodStart, `2026-${String(i + 1).padStart(2, "0")}-01`);
    assert.ok(a.lines.length >= 10 && a.lines.length <= 25, `${months[i]} has ${a.lines.length} lines`);
    if (i > 0) assert.equal(a.opening, accs[i - 1].closing, `${months[i]} opening`);
  });
});

test("mismatch: one amount misread, so the running balance breaks there and the difference is not 0", () => {
  const { r } = results.find((x) => x.file === "mismatch.pdf")!;
  const a = r.accounts[0];
  const t = tie(a);
  assert.notEqual(t.difference, 0);
  assert.equal(t.difference, 27000); // 1,250.00 read as 1,520.00
  const bad = a.lines.find((l) => l.amountCents === 152000)!;
  assert.equal(t.runningBreak, bad.id);
  assert.notEqual(a.summary!.outTotal, t.outTotal);
  const unsure = a.lines.filter((l) => l.unsure);
  assert.equal(unsure.length, 1);
  assert.equal(unsure[0].unsureReason, "Amount hard to read");
});

// Round 22 (Hashim, Nov 16, 2026): the Willow Dummy Realty statements for the step 3 rework.
test("round 22: the year edges and chains the step 3 screens rely on", () => {
  const acc = (f: string) => results.find((x) => x.file === `round22/${f}`)!.r.accounts[0];
  const atDate = (a: StatementAccount, d: string) => a.lines.filter((l) => l.date <= d).reduce((n, l) => n + signedCents(l), a.opening);
  assert.equal(atDate(acc("mdb-chq-2025-08.pdf"), "2025-08-31"), 195762);
  assert.equal(atDate(acc("mdb-visa-2025-08.pdf"), "2025-08-31"), 132208);
  const last = acc("mdb-visa-2026-08.pdf");
  assert.deepEqual([last.opening, last.closing, atDate(last, "2026-08-31")], [184620, 110345, 62905]);
  assert.ok(last.lines.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.postedDate ?? "")));
  assert.equal(acc("ndb-chq-2025-09.pdf").opening, 586000);
  // Each chain follows on: closing = the next opening.
  const chain = (names: string[]) => names.slice(1).forEach((n, i) => assert.equal(acc(n).opening, acc(names[i]).closing, n));
  const months = (prefix: string, from: [number, number], n: number, f = (s: string) => s) => Array.from({ length: n }, (_, k) => { const d = new Date(Date.UTC(from[0], from[1] - 1 + k, 1)); return f(`${prefix}-${d.toISOString().slice(0, 7)}.pdf`); });
  chain(months("mdb-chq", [2025, 8], 13));
  chain(months("mdb-visa", [2025, 8], 13));
  chain(months("ndb-chq", [2025, 9], 12, (s) => s.replace("2026-02.pdf", "2026-02-locked.pdf")));
  assert.equal(results.filter((x) => x.file.startsWith("round22/") && x.r.accounts[0].lines.some((l) => l.description === "ONLINE PAYMENT MC 4455")).length, 3);
});
