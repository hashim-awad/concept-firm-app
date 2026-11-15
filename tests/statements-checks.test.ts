// Run with: npm test
// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026): the checks on a statement read from a PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { checkAccount, closebookWarnings, resultProblem, statementStatus, statementSummary, summaryWords } from "../src/lib/statements/checks.ts";
import type { ReadResult, StatementAccount, StatementLine } from "../src/lib/statements/types.ts";

let n = 0;
const line = (date: string, cents: number, dir: "in" | "out", bal: number | null = null, extra: Partial<StatementLine> = {}): StatementLine =>
  ({ id: `l${++n}`, date, description: `SAMPLE LINE ${n}`, amountCents: cents, dir, balanceCents: bal, page: 1, unsure: false, unsureReason: "", source: "read", ...extra });

// Bank: opening 1,000.00; +500.00 in; -200.00 out; -50.25 out; closing 1,249.75.
const bank = (): StatementAccount => ({
  key: "a1", last4: "4321", name: "Business chequing", kind: "bank", periodStart: "2026-01-01", periodEnd: "2026-01-31",
  opening: 100000, closing: 124975,
  summary: { inTotal: 50000, inCount: 1, outTotal: 25025, outCount: 2 },
  lines: [line("2026-01-03", 50000, "in", 150000), line("2026-01-10", 20000, "out", 130000), line("2026-01-20", 5025, "out", 124975)],
});

test("a statement that ties: difference 0.00, summary matches, running balance matches, nothing to review", () => {
  const c = checkAccount(bank());
  assert.equal(c.differenceCents, 0);
  assert.deepEqual([c.inTotal, c.inCount, c.outTotal, c.outCount], [50000, 1, 25025, 2]);
  assert.deepEqual(c.summaryOk, { in: true, out: true });
  assert.equal(c.runningBreak, null);
  assert.deepEqual(c.review, []);
  assert.equal(c.ok, true);
  assert.equal(statementStatus({ accounts: [bank()] }), "ready");
});

test("the difference to the cent: closing - (opening + lines)", () => {
  const a = { ...bank(), closing: 124976 };
  const c = checkAccount(a);
  assert.equal(c.differenceCents, 1);
  assert.equal(c.ok, false);
});

test("a misread amount: the first line where the running balance stops matching goes to For review, with the reason", () => {
  const a = bank();
  a.lines[1].amountCents = 2000; // 200.00 read as 20.00
  const c = checkAccount(a);
  assert.equal(c.differenceCents, -18000);
  assert.deepEqual(c.runningBreak, { lineId: a.lines[1].id, expected: 148000, printed: 130000 });
  assert.equal(c.review.length, 1);
  assert.equal(c.review[0].lineId, a.lines[1].id);
  assert.match(c.review[0].reason, /shows a balance of \$1,300\.00 after this line, but the lines add up to \$1,480\.00/);
  assert.equal(c.summaryOk.out, false);
  assert.equal(c.ok, false);
});

test("a missing line: the break is on the next line with a printed balance", () => {
  const a = bank();
  a.lines.splice(1, 1);
  const c = checkAccount(a);
  assert.equal(c.runningBreak?.lineId, a.lines[1].id);
  assert.equal(c.summaryOk.out, false);
  assert.match(summaryWords(a, c)[1], /Total money out is \$50\.25 on 1 line, but the statement shows \$250\.25 on 2 lines\./);
});

test("printed balances only on some lines are checked where printed; newest-first statements read bottom up", () => {
  const a = bank();
  a.lines[0].balanceCents = null;
  assert.equal(checkAccount(a).ok, true);
  const rev = bank();
  rev.lines.reverse();
  // Newest first: 1,249.75 printed after the last line is first, and so on; bottom up it ties.
  rev.lines = rev.lines.map((l) => ({ ...l }));
  const c = checkAccount(rev);
  assert.equal(c.runningBreak, null);
  assert.equal(c.ok, true);
});

test("a card: charges raise the balance owing, payments lower it", () => {
  const card: StatementAccount = {
    key: "a1", last4: "9034", name: "Visa Business", kind: "card", periodStart: "2026-02-16", periodEnd: "2026-03-15",
    opening: 50000, closing: 20000, summary: null,
    lines: [line("2026-02-20", 10000, "in", 60000), line("2026-02-24", 40000, "out", 20000)],
  };
  const c = checkAccount(card);
  assert.equal(c.differenceCents, 0);
  assert.deepEqual(c.summaryOk, { in: null, out: null });
  assert.equal(c.ok, true);
  assert.deepEqual(summaryWords(card, c), []);
});

test("unsure lines and lines outside the period go to For review", () => {
  const a = bank();
  a.lines[0].unsure = true;
  a.lines[0].unsureReason = "last digit of the amount is cut off";
  a.lines[2].date = "2026-02-02";
  const c = checkAccount(a);
  assert.deepEqual(c.review.map((r) => r.lineId), [a.lines[0].id, a.lines[2].id]);
  assert.match(c.review[0].reason, /^The reader was not sure: last digit of the amount is cut off/);
  assert.match(c.review[1].reason, /outside the statement period \(2026-01-01 to 2026-01-31\)/);
  assert.equal(c.differenceCents, 0);
  assert.equal(c.ok, false);
  assert.equal(statementStatus({ accounts: [a] }), "needs_look");
});

test("the printed summary counts: a count not printed is not checked", () => {
  const a = bank();
  a.summary = { inTotal: 50000, inCount: null, outTotal: 25025, outCount: 3 };
  const c = checkAccount(a);
  assert.deepEqual(c.summaryOk, { in: true, out: false });
});

test("Closebook warnings: last digits, kind, and a period outside the file's year", () => {
  const a = bank();
  const year = { yearStart: "2026-01-01", yearEnd: "2026-12-31" };
  assert.deepEqual(closebookWarnings(a, { ...year, chosen: { last4: "4321", kind: "bank", name: "TD chequing" } }), []);
  assert.deepEqual(closebookWarnings(a, { ...year, chosen: { last4: "1234", kind: "bank", name: "TD chequing" } }),
    ["The statement is for an account ending in 4321, but TD chequing ends in 1234."]);
  assert.match(closebookWarnings(a, { ...year, chosen: { last4: null, kind: "card", name: "Visa" } })[0], /bank account statement, but Visa is a credit card/);
  assert.match(closebookWarnings(a, { yearStart: "2025-01-01", yearEnd: "2025-12-31", chosen: null })[0], /is outside the file's year \(2025-01-01 to 2025-12-31\)/);
  assert.match(closebookWarnings(a, { yearStart: "2026-01-15", yearEnd: "2027-01-14", chosen: null })[0], /^Part of the statement period/);
  assert.deepEqual(closebookWarnings(a, { ...year, chosen: null }), []);
});

test("the list summary: the account furthest off sets the difference; review lines add up", () => {
  const off = { ...bank(), key: "a2", closing: 124900 };
  const s = statementSummary({ accounts: [bank(), off] });
  assert.deepEqual(s, { accounts: 2, lines: 6, difference_cents: -75, review: 0 });
  assert.deepEqual(statementSummary(null), { accounts: 0, lines: 0, difference_cents: null, review: 0 });
  assert.equal(statementStatus({ accounts: [] }), "needs_look");
});

test("a working copy from the screen is checked before it is saved", () => {
  const ok: ReadResult = { bank: "Northern Dummy Bank", pages: 1, accounts: [bank()] };
  assert.equal(resultProblem(ok), null);
  assert.equal(resultProblem({}), "The statement has no accounts.");
  const bad = structuredClone(ok);
  bad.accounts[0].lines[0].date = "2026-13-01";
  assert.match(resultProblem(bad)!, /every line needs a date/);
  const neg = structuredClone(ok);
  neg.accounts[0].lines[0].amountCents = -5;
  assert.match(resultProblem(neg)!, /positive number/);
  const dupId = structuredClone(ok);
  dupId.accounts[0].lines[1].id = dupId.accounts[0].lines[0].id;
  assert.match(resultProblem(dupId)!, /its own id/);
});

// Agent E's dummy statements: what a perfect reader returns ties; the "mismatch" one has a reader mistake.
const FIX = new URL("./fixtures/statements/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, FIX), "utf8")) as ReadResult;
test("the dummy statements: every account ties to the cent and its running balance holds", { skip: !existsSync(new URL("card.json", FIX)) }, () => {
  for (const name of ["card.json", "chequing-savings.json", "locked.json", "two-page.json", "long-400.json"]) {
    const r = fixture(name);
    for (const a of r.accounts) {
      const c = checkAccount(a);
      assert.equal(c.differenceCents, 0, `${name} ${a.key}`);
      assert.equal(c.runningBreak, null, `${name} ${a.key}`);
      assert.notEqual(c.summaryOk.in, false, `${name} ${a.key}`);
      assert.notEqual(c.summaryOk.out, false, `${name} ${a.key}`);
    }
  }
  assert.equal(fixture("chequing-savings.json").accounts.length, 2);
  assert.ok(fixture("long-400.json").accounts[0].lines.length >= 400);
});

test("the dummy mismatch: the misread line is the first break, and the statement needs a look", { skip: !existsSync(new URL("mismatch.json", FIX)) }, () => {
  const r = fixture("mismatch.json");
  const c = checkAccount(r.accounts[0]);
  assert.notEqual(c.differenceCents, 0);
  assert.ok(c.runningBreak);
  const broken = r.accounts[0].lines.find((l) => l.id === c.runningBreak!.lineId)!;
  assert.equal(broken.amountCents, 152000);
  assert.ok(c.review.some((x) => r.accounts[0].lines.find((l) => l.id === x.lineId)?.unsure));
  assert.equal(statementStatus(r), "needs_look");
});
