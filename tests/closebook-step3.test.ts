// Run with: npm test
// Closebook step 3 rework (round 22, Hashim, Nov 16, 2026): placement and numbers, the year cut-off and
// edges, the upload statuses, coverage by cycle, ties, outstanding items, possible accounts and "Next:".
// Dummy data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountName, cardStatus, cardSummary, coverageStrip, edge, gapSegments, nextNumber, placement, possibleAccounts, ties, todoList, uploadState, yearCut, type FileAccount, type TodoFacts } from "../src/lib/closebook/step3.ts";
import type { StatementAccount, StatementLine } from "../src/lib/statements/types.ts";

const Y0 = "2025-09-01", Y1 = "2026-08-31";
const line = (n: number, date: string, amountCents: number, dir: "in" | "out", postedDate: string | null = null): StatementLine =>
  ({ id: `l${n}`, date, postedDate, description: `LINE ${n}`, amountCents, dir, balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read" });

test("placement: decisions 2 and 3", () => {
  assert.deepEqual([placement("chequing", false).base, placement("chequing", false).gifi], ["10000", "1002"]);
  assert.deepEqual([placement("savings", false).base, placement("savings", false).gifi], ["10100", "1002"]);
  assert.deepEqual([placement("card", false).base, placement("card", false).gifi], ["22000", "2707"]);
  assert.deepEqual([placement("loc", false).base, placement("loc", false).gifi], ["22100", "2701"]);
  assert.deepEqual([placement("loc", true).base, placement("loc", true).gifi], ["25300", "3149"]);
  assert.deepEqual([placement("loan", false).base, placement("loan", false).gifi], ["22110", "2701"]);
  assert.deepEqual([placement("loan", true).base, placement("loan", true).gifi, placement("loan", true).stdName], ["25000", "3143", "Bank loan"]);
  assert.equal(placement("card", true).base, "22000", "long-term only for a line of credit or a loan");
  const chart = new Set(["10000", "10100", "10200", "22000", "22100"]);
  assert.equal(nextNumber("10000", chart, new Set()), "10000");
  assert.equal(nextNumber("10000", chart, new Set(["10000", "10010"])), "10020");
  assert.equal(nextNumber("10000", chart, new Set(["10000", "10010", "10020", "10030", "10040", "10050", "10060", "10070", "10080", "10090"])), "10110", "skips 10100 Savings");
  assert.equal(accountName("chequing", false, " MDB ", "••2201"), "Chequing · MDB ••• 2201");
});

test("a bank statement crossing the year start: one line imports, the edge is worked out", () => {
  const acc: StatementAccount = { key: "a1", last4: "2201", name: "Business chequing", kind: "bank", periodStart: "2025-08-03", periodEnd: "2025-09-02", opening: 293510, closing: 320762, summary: null,
    lines: [line(1, "2025-08-05", 41230, "out"), line(2, "2025-08-08", 120000, "in"), line(3, "2025-08-14", 105000, "out"), line(4, "2025-08-20", 38968, "out"), line(5, "2025-08-27", 32550, "out"), line(6, "2025-09-02", 125000, "in")] };
  const c = yearCut(acc, Y0, Y1);
  assert.deepEqual([c.inYear.map((l) => l.id), c.before.length, c.crossesStart, c.crossesEnd, c.atStart, c.atEnd], [["l6"], 5, true, false, 195762, null]);
});

test("a card statement crossing the year end: the purchase date decides, the posting date does not", () => {
  const acc: StatementAccount = { key: "a1", last4: "4405", name: "Visa", kind: "card", periodStart: "2026-08-16", periodEnd: "2026-09-15", opening: 184620, closing: 110345,
    summary: { inTotal: 110345, inCount: 5, outTotal: 184620, outCount: 1, interest: 0, fees: 0 },
    lines: [line(1, "2026-08-18", 8640, "in", "2026-08-19"), line(2, "2026-08-22", 184620, "out", "2026-08-23"), line(3, "2026-08-25", 41275, "in", "2026-08-26"),
      line(4, "2026-08-30", 12990, "in", "2026-09-02"), line(5, "2026-09-03", 30115, "in", "2026-09-04"), line(6, "2026-09-10", 17325, "in", "2026-09-11")] };
  const c = yearCut(acc, Y0, Y1);
  assert.deepEqual([c.inYear.map((l) => l.id), c.after.length, c.crossesEnd, c.atEnd], [["l1", "l2", "l3", "l4"], 2, true, 62905]);
  assert.deepEqual(cardSummary(acc, 110345, 184620), { previous: 184620, purchases: 110345, interest: 0, fees: 0, payments: 184620, newBalance: 110345, ties: true });
  const withInterest = cardSummary({ ...acc, summary: { ...acc.summary!, interest: 1240 } }, 110345, 184620);
  assert.deepEqual([withInterest.purchases, withInterest.ties], [109105, true]);
  // Entirely outside the year.
  assert.equal(yearCut({ ...acc, periodStart: "2025-07-16", periodEnd: "2025-08-15", lines: [] }, Y0, Y1).outside, true);
});

test("upload statuses: reading, outside, already, wrong account, no account, no digits, ready", () => {
  const accts: FileAccount[] = [{ id: "c1", number: "22000", name: "Credit card · MDB ••• 4405", kind: "card", last4: "4405" }, { id: "b2", number: "10010", name: "Chequing · NDB ••• 3302", kind: "bank", last4: "3302" }];
  const ctx = { yearStart: Y0, yearEnd: Y1, accounts: accts, target: accts[0], importedShas: new Set(["sha-x"]), importedPeriods: [{ account_id: "c1", period_start: "2025-09-16", period_end: "2025-10-15" }] };
  const row = (o: object) => ({ id: "r", status: "ready", period_start: "2025-10-16", period_end: "2025-11-15", found: [{ name: "Visa", last4: "4405", kind: "card" as const }], ...o });
  assert.equal(uploadState(row({ status: "reading" }), ctx).status, "reading");
  assert.equal(uploadState(row({ period_start: "2025-07-16", period_end: "2025-08-15" }), ctx).status, "outside");
  assert.equal(uploadState(row({ file_sha256: "sha-x" }), ctx).status, "already");
  assert.equal(uploadState(row({ period_start: "2025-09-16", period_end: "2025-10-15" }), ctx).status, "already");
  const w = uploadState(row({ found: [{ name: "Chequing", last4: "3302", kind: "bank" }] }), ctx);
  assert.deepEqual([w.status, w.other?.id, w.reason], ["wrong_account", "b2", "It is for 10010 Chequing · NDB ••• 3302."]);
  const n = uploadState(row({ found: [{ name: "Chequing", last4: "8812", kind: "bank" }] }), ctx);
  assert.deepEqual([n.status, n.reason], ["no_account", "No account in this file ends in 8812."]);
  assert.equal(uploadState(row({ found: [{ name: "Chequing", last4: "", kind: "bank" }] }), ctx).status, "no_digits");
  assert.deepEqual([uploadState(row({}), ctx).status, uploadState(row({ status: "needs_look" }), ctx).status], ["ready", "needs_look"]);
});

test("coverage: calendar months, a card's own cycles, gaps, breaks and the opened date", () => {
  const months = Array.from({ length: 12 }, (_, k) => { const d = new Date(Date.UTC(2025, 8 + k, 1)); const e = new Date(Date.UTC(2025, 9 + k, 0));
    return { period_start: d.toISOString().slice(0, 10), period_end: e.toISOString().slice(0, 10), opening: k * 10, closing: (k + 1) * 10 }; });
  const noFeb = months.filter((m) => !m.period_start.startsWith("2026-02"));
  const c = coverageStrip(Y0, Y1, noFeb);
  assert.deepEqual([c.cells.length, c.cells.map((x) => x.label).join(""), c.missing.map((x) => x.from), c.breaks.length], [12, "SONDJFMAMJJA", ["2026-02-01"], 1]);
  assert.equal(c.cells.find((x) => x.from === "2026-03-01")!.state, "check");
  const cards = Array.from({ length: 13 }, (_, k) => { const s = new Date(Date.UTC(2025, 7 + k, 16)); const e = new Date(Date.UTC(2025, 8 + k, 15));
    return { period_start: s.toISOString().slice(0, 10), period_end: e.toISOString().slice(0, 10), opening: k, closing: k + 1 }; });
  const cc = coverageStrip(Y0, Y1, cards);
  assert.deepEqual([cc.cycleDay, cc.cells.length, cc.missing.length, cc.cells[0].from, cc.cells[12].to], [16, 13, 0, "2025-09-01", "2026-08-31"]);
  const opened = coverageStrip(Y0, Y1, [], { opened: "2026-03-01" });
  assert.deepEqual([opened.cells.filter((x) => x.state === "na").length, opened.missing.length], [6, 6]);
});

test("edges, ties and possible accounts", () => {
  assert.deepEqual(edge(586000, 541000, [{ id: "i", account_id: "b2", edge: "start", item_date: "2025-08-28", description: "Cheque #204", dir: "out", amount: 45000, cleared_line: null }]),
    { statements: 586000, books: 541000, items: -45000, difference: -45000, explained: true });
  assert.equal(edge(586000, 541000, []).explained, false);
  assert.equal(edge(null, 541000, []).explained, true, "no statement at the edge yet: nothing to explain");
  const t = ties([{ number: "10000", gifi: "1002", books: 195762 }, { number: "10010", gifi: "1002", books: 511000 }, { number: "22000", gifi: "2707", books: 132208 }],
    new Map([["1002", 736762], ["2707", 132208]]), true);
  assert.deepEqual(t.map((x) => [x.gifi, x.books, x.t2, x.ties]), [["1002", 706762, 736762, false], ["2707", 132208, 132208, true]]);
  assert.deepEqual(ties([], new Map(), false), []);
  const accts: FileAccount[] = [{ id: "c1", number: "22000", name: "Credit card · MDB ••• 4405", kind: "card", last4: "4405" }];
  const p = possibleAccounts([
    { date: "2025-12-24", description: "ONLINE PAYMENT MC 4455", cents: -121000, bank: true },
    { date: "2026-03-24", description: "ONLINE PAYMENT MC 4455", cents: -98450, bank: true },
    { date: "2026-03-15", description: "ONLINE PAYMENT MDB VISA 4405", cents: -50000, bank: true },
    { date: "2026-03-16", description: "VISA 9999 REFUND", cents: 5000, bank: true },
  ], accts, new Set());
  assert.deepEqual(p.map((x) => [x.label, x.count, x.example.cents]), [["MC ••• 4455", 2, 121000]]);
  assert.deepEqual(possibleAccounts([{ date: "2025-12-24", description: "ONLINE PAYMENT MC 4455", cents: -1, bank: true }], accts, new Set(["4455"])), []);
});

test("the to-do list: the first item is Next; each item in order", () => {
  const ok = { statements: null, books: null, items: 0, difference: null, explained: true };
  const base: TodoFacts = { accounts: [], waiting: [], reading: 0, failed: 0, wrong: 0, ties: [], possible: [], signed: false };
  const a = (o: Partial<TodoFacts["accounts"][number]> = {}) => ({ id: "a", label: "10000 Chequing · MDB ••• 2201", statements: 13, gaps: [], breaks: 0, books: 195762, reason: false,
    start: ok, end: ok, startDay: "Aug 31, 2025", endDay: "Aug 31, 2026", ...o });
  assert.equal(todoList(base)[0].kind, "add");
  assert.equal(todoList({ ...base, accounts: [a({ books: null })] })[0].kind, "books");
  assert.equal(todoList({ ...base, accounts: [a()], waiting: [{ account: "c", label: "22000 Credit card · MDB ••• 4405", n: 3 }] })[0].text, "Check 3 statements for 22000 Credit card · MDB ••• 4405.");
  assert.equal(todoList({ ...base, accounts: [a({ statements: 0 })] })[0].text, "Upload statements for 10000 Chequing · MDB ••• 2201, or record why there are none.");
  assert.equal(todoList({ ...base, accounts: [a({ gaps: ["February 2026"] })] })[0].text, "Upload the February 2026 statement for 10000 Chequing · MDB ••• 2201, or record why there is none.");
  assert.equal(todoList({ ...base, accounts: [a({ gaps: ["February 2026"], reason: true })] })[0].kind, "sign", "a reason recorded clears the gap");
  const tie = { gifi: "1002", numbers: ["10000"], books: 706762, t2: 736762, ties: false };
  assert.equal(todoList({ ...base, accounts: [a()], ties: [tie] })[0].text, "GIFI 1002: the accounts open at 7,067.62, last year's T2 has 7,367.62, a difference of 300.00. Check each account's balance in the books, or step 2.");
  const off = { statements: 586000, books: 511000, items: 0, difference: -75000, explained: false };
  const e = todoList({ ...base, accounts: [a({ start: off })] })[0];
  assert.deepEqual([e.kind, e.edge, e.text], ["edge", "start", "10000 Chequing · MDB ••• 2201: the statements show 5,860.00 on Aug 31, 2025 and the books 5,110.00. Explain the difference of 750.00."]);
  const p = { last4: "4455", label: "MC ••• 4455", count: 3, example: { date: "2025-11-24", description: "ONLINE PAYMENT MC 4455", cents: 121000 } };
  assert.equal(todoList({ ...base, accounts: [a()], possible: [p] })[0].kind, "possible");
  // Everything at once: one list, in order.
  const all = todoList({ ...base, accounts: [a({ gaps: ["February 2026"], start: off })], waiting: [{ account: "a", label: "10000", n: 1 }], ties: [tie], possible: [p], failed: 1 });
  assert.deepEqual(all.map((x) => x.kind), ["check", "failed", "gap", "tie", "edge", "possible"]);
  assert.equal(todoList({ ...base, accounts: [a()] })[0].text, "Sign as preparer.");
  assert.equal(todoList({ ...base, accounts: [a()], signed: true })[0].kind, "done");
});

test("gap rows and card status words", () => {
  const sts = [{ period_start: "2026-01-01", period_end: "2026-01-31", opening: 0, closing: 10 }, { period_start: "2026-03-01", period_end: "2026-03-31", opening: 20, closing: 30 }];
  const c = coverageStrip("2025-09-01", "2026-08-31", sts);
  const g = gapSegments(c.cells, sts, c.breaks);
  assert.deepEqual(g.map((x) => [x.from, x.to, x.after?.period_end ?? null, x.before?.period_start ?? null]),
    [["2025-09-01", "2025-12-31", null, "2026-01-01"], ["2026-02-01", "2026-02-28", "2026-01-31", "2026-03-01"], ["2026-04-01", "2026-08-31", "2026-03-31", null]]);
  assert.deepEqual(cardStatus({ waiting: 3, gaps: 1, notExplained: true, books: 1, statements: 2, reason: false }).word, "3 to check");
  assert.deepEqual(cardStatus({ waiting: 0, gaps: 1, notExplained: true, books: 1, statements: 2, reason: false }).word, "1 gap");
  assert.deepEqual(cardStatus({ waiting: 0, gaps: 0, notExplained: true, books: 1, statements: 2, reason: false }).word, "Not explained");
  assert.deepEqual(cardStatus({ waiting: 0, gaps: 0, notExplained: false, books: 1, statements: 0, reason: false }).word, "None yet");
  assert.deepEqual(cardStatus({ waiting: 0, gaps: 0, notExplained: false, books: 1, statements: 0, reason: true }).word, "Complete");
});

test("coverage: statements waiting to check show yellow and give a card its cycle before any import", () => {
  const c = coverageStrip("2025-09-01", "2026-08-31", [], {}, [{ period_start: "2025-08-16", period_end: "2025-09-15" }, { period_start: "2025-09-16", period_end: "2025-10-15" }]);
  assert.deepEqual([c.cycleDay, c.cells.length, c.cells.slice(0, 3).map((x) => x.state), c.missing.length], [16, 13, ["wait", "wait", "missing"], 11]);
});
