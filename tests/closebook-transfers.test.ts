// Run with: npm test
// Transfers between the file's own accounts in step 4 (round 20, Hashim, Nov 15, 2026): the finder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, type BuildChart } from "../src/lib/closebook/tb-build.ts";
import { findTransfers, isMoneyOut, looksLikeTransfer, matchedLabel, shortDate, transferLabel, TRANSFER_WARNING, type TransferAccount, type TransferLine } from "../src/lib/closebook/transfers.ts";

const accounts: TransferAccount[] = [
  { id: "chq", name: "Chequing 4521", kind: "bank", chart_account: "10000" },
  { id: "sav", name: "Savings 7788", kind: "bank", chart_account: "10100" },
  { id: "visa", name: "Visa 1234", kind: "card", chart_account: "22000" },
];
const line = (id: string, account_id: string, txn_date: string, amount: number, status = "new"): TransferLine => ({ id, account_id, txn_date, amount, status });

test("money out and in: a bank payment and a card charge are out; a deposit and a card payment are in", () => {
  assert.equal(isMoneyOut("bank", -500), true);
  assert.equal(isMoneyOut("bank", 500), false);
  assert.equal(isMoneyOut("card", 11300), true, "a charge raises what is owed");
  assert.equal(isMoneyOut("card", -120000), false, "a payment lowers what is owed");
});

test("a transfer from chequing to savings is offered on both lines, named with the other account and date", () => {
  const found = findTransfers([line("a", "chq", "2026-03-13", -500), line("b", "sav", "2026-03-14", 500)], accounts);
  const a = found.get("a")!, b = found.get("b")!;
  assert.equal(a.length, 1);
  assert.equal(transferLabel(a[0]), "Transfer to Savings 7788 on Mar 14");
  assert.equal(transferLabel(b[0]), "Transfer from Chequing 4521 on Mar 13");
  assert.equal(a[0].otherId, "b");
  assert.equal(a[0].days, 1);
  assert.equal(matchedLabel("Chequing 4521", "2026-03-13"), "Matched to transfer from Chequing 4521 on Mar 13");
});

test("cents exact: a cent apart is not a transfer", () => {
  assert.equal(findTransfers([line("a", "chq", "2026-03-13", -500), line("b", "sav", "2026-03-13", 500.01)], accounts).size, 0);
  // Floating point never splits a match: 0.1 + 0.2 is 0.30.
  assert.equal(findTransfers([line("a", "chq", "2026-03-13", -(0.1 + 0.2)), line("b", "sav", "2026-03-13", 0.3)], accounts).size, 2);
});

test("dates within 5 days either way, across a month end", () => {
  const five = findTransfers([line("a", "chq", "2026-02-27", -250), line("b", "sav", "2026-03-04", 250)], accounts);
  assert.equal(five.get("a")?.[0].days, 5, "Feb 27 to Mar 4 is 5 days");
  const before = findTransfers([line("a", "chq", "2026-03-10", -250), line("b", "sav", "2026-03-05", 250)], accounts);
  assert.equal(before.get("a")?.[0].otherId, "b", "the money in may come first");
  assert.equal(findTransfers([line("a", "chq", "2026-03-10", -250), line("b", "sav", "2026-03-16", 250)], accounts).size, 0, "6 days is too far");
});

test("not a transfer: the same account, both money out, a line already coded or matched", () => {
  assert.equal(findTransfers([line("a", "chq", "2026-03-13", -500), line("b", "chq", "2026-03-13", 500)], accounts).size, 0, "a reversal in one account");
  assert.equal(findTransfers([line("a", "chq", "2026-03-13", -500), line("b", "sav", "2026-03-13", -500)], accounts).size, 0);
  for (const status of ["done", "matched", "reviewer", "ask_client"]) {
    assert.equal(findTransfers([line("a", "chq", "2026-03-13", -500), line("b", "sav", "2026-03-13", 500, status)], accounts).size, 0, status);
  }
  assert.equal(findTransfers([line("a", "chq", "2026-03-13", 0), line("b", "sav", "2026-03-13", 0)], accounts).size, 0, "zero lines");
  assert.equal(findTransfers([line("a", "gone", "2026-03-13", -500), line("b", "sav", "2026-03-13", 500)], accounts).size, 0, "an account not in the file");
});

test("paying the card from the bank: the bank's money out and the card's payment", () => {
  const found = findTransfers([line("p", "chq", "2026-03-20", -1200), line("q", "visa", "2026-03-21", -1200), line("r", "visa", "2026-03-22", 1200)], accounts);
  assert.equal(transferLabel(found.get("p")![0]), "Transfer to Visa 1234 on Mar 21");
  assert.equal(transferLabel(found.get("q")![0]), "Transfer from Chequing 4521 on Mar 20");
  assert.equal(found.get("p")!.length, 1, "a charge on the card is not the payment");
  assert.equal(found.has("r"), false, "a card charge pairs only with money coming in elsewhere");
  // A cash advance: a card charge into the bank is a transfer too.
  const adv = findTransfers([line("c", "visa", "2026-04-02", 300), line("d", "chq", "2026-04-02", 300)], accounts);
  assert.equal(transferLabel(adv.get("c")![0]), "Transfer to Chequing 4521 on Apr 2");
});

test("more than one fits: the closest date first, then the earlier date; the preparer can choose any", () => {
  const found = findTransfers([
    line("a", "chq", "2026-03-13", -500),
    line("far", "sav", "2026-03-17", 500), line("near", "sav", "2026-03-14", 500), line("same", "visa", "2026-03-12", -500),
  ], accounts);
  assert.deepEqual(found.get("a")!.map((c) => c.otherId), ["same", "near", "far"], "1 day each (Mar 12 and Mar 14): the earlier date first; 4 days last");
  assert.equal(found.get("far")![0].otherId, "a", "the other lines still offer it");
});

test("one line in one transfer: two equal transfers get two different first choices", () => {
  // Two 500.00 transfers a day apart. The closest pair (Mar 14 out, Mar 14 in) is taken first, so the
  // Mar 13 line is offered the Mar 15 line first, not the one already taken.
  const found = findTransfers([
    line("o1", "chq", "2026-03-13", -500), line("o2", "chq", "2026-03-14", -500),
    line("i1", "sav", "2026-03-14", 500), line("i2", "sav", "2026-03-15", 500),
  ], accounts);
  assert.equal(found.get("o2")![0].otherId, "i1");
  assert.equal(found.get("i1")![0].otherId, "o2");
  assert.equal(found.get("o1")![0].otherId, "i2", "its closest is taken: the next free one comes first");
  assert.equal(found.get("i2")![0].otherId, "o1");
  assert.deepEqual(found.get("o1")!.map((c) => c.otherId).sort(), ["i1", "i2"], "the taken one is still there to choose");
  const firsts = ["o1", "o2", "i1", "i2"].map((id) => found.get(id)![0].otherId);
  assert.equal(new Set(firsts).size, 4, "no line is anyone's first choice twice");
});

test("the order never changes between loads", () => {
  const ls = [line("x", "chq", "2026-03-13", -75), line("y2", "sav", "2026-03-14", 75), line("y1", "visa", "2026-03-12", -75)];
  const one = JSON.stringify([...findTransfers(ls, accounts)].sort());
  const two = JSON.stringify([...findTransfers([...ls].reverse(), accounts)].sort());
  assert.equal(one, two);
});

test("coded straight to another account's chart account: warned, not when it is its own or Clearing", () => {
  assert.equal(looksLikeTransfer("10100", "chq", accounts), true, "chequing coded to savings");
  assert.equal(looksLikeTransfer("22000", "chq", accounts), true, "chequing coded to the card");
  assert.equal(looksLikeTransfer("10000", "chq", accounts), false, "its own account");
  assert.equal(looksLikeTransfer("10900", "chq", accounts), false, "Clearing (round 4) stays as it is");
  assert.equal(looksLikeTransfer(null, "chq", accounts), false);
  assert.equal(TRANSFER_WARNING, "This looks like a transfer. Match it with the other account's line so it is not counted twice.");
  assert.equal(shortDate("2026-12-01"), "Dec 1");
});

// How a matched transfer posts (src/lib/closebook/tb-build.ts): once, on the money-out line.
const chart = new Map<string, BuildChart>([
  ["10000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }], ["10100", { name: "Savings", account_type: "Asset", line_no: "1002.00" }],
  ["10900", { name: "Clearing", account_type: "Asset", line_no: null }], ["22000", { name: "Credit card", account_type: "Liability", line_no: "2707.00" }],
]);
const ctx = { registered: true, quick: false };
const banks = [
  { id: "chq", name: "Chequing 4521", kind: "bank" as const, chart: "10000", number: "10000", openingCents: 500000 },
  { id: "sav", name: "Savings 7788", kind: "bank" as const, chart: "10100", number: "10100", openingCents: 0 },
  { id: "visa", name: "Visa 1234", kind: "card" as const, chart: "22000", number: "22000", openingCents: 120000 },
];
const row = (rows: { key: string; cents: number }[], key: string) => rows.find((r) => r.key === key)?.cents ?? 0;

test("a matched transfer posts once: Dr Savings 500.00, Cr Chequing 500.00; the matched line posts nothing", () => {
  const { rows, postings } = buildLedger(banks, [
    { id: "a", account_id: "chq", cents: -50000, status: "done", chart_account: "10100", tax_code: null, transfer_bank: "sav", date: "2026-03-13" },
    { id: "b", account_id: "sav", cents: 50000, status: "matched", chart_account: null, tax_code: null, date: "2026-03-14" },
  ], chart, new Map(), ctx, { lines: [], reClosingCents: 0, reStatedCents: null });
  assert.equal(row(rows, "chart:10000"), 500000 - 50000, "chequing: opening 5,000.00 less 500.00 = its statement");
  assert.equal(row(rows, "chart:10100"), 50000, "savings: 500.00 = its statement");
  assert.equal(row(rows, "uncoded"), 0, "nothing waits to be coded");
  assert.deepEqual(postings.filter((p) => p.ref === "a").map((p) => [p.key, p.cents]), [["chart:10000", -50000], ["chart:10100", 50000]]);
  assert.equal(postings.filter((p) => p.ref === "b").length, 0);
});

test("coded straight to the other account without the match counts it twice", () => {
  const { rows } = buildLedger(banks, [
    { id: "a", account_id: "chq", cents: -50000, status: "done", chart_account: "10100", tax_code: null, date: "2026-03-13" },
    { id: "b", account_id: "sav", cents: 50000, status: "done", chart_account: "10000", tax_code: null, date: "2026-03-14" },
  ], chart, new Map(), ctx, { lines: [], reClosingCents: 0, reStatedCents: null });
  assert.equal(row(rows, "chart:10100"), 100000, "savings shows 1,000.00 against a statement of 500.00: the warning's reason");
});

test("both sides through Clearing (round 4) still nets to nil", () => {
  const { rows } = buildLedger(banks, [
    { id: "a", account_id: "chq", cents: -50000, status: "done", chart_account: "10900", tax_code: "OUT_OF_SCOPE", date: "2026-03-13" },
    { id: "b", account_id: "sav", cents: 50000, status: "done", chart_account: "10900", tax_code: "OUT_OF_SCOPE", date: "2026-03-14" },
  ], chart, new Map([["OUT_OF_SCOPE", { code: "OUT_OF_SCOPE", name: "Out of Scope", parts: [] }]]), ctx, { lines: [], reClosingCents: 0, reStatedCents: null });
  assert.equal(row(rows, "chart:10900"), 0);
  assert.equal(row(rows, "chart:10100"), 50000);
});

test("paying the card: Dr Visa 1,200.00, Cr Chequing 1,200.00; a second account on the same chart keeps its own row", () => {
  const two = [...banks, { id: "chq2", name: "Chequing 9900", kind: "bank" as const, chart: "10000", number: "10010", openingCents: 0 }];
  const { rows } = buildLedger(two, [
    { id: "p", account_id: "chq", cents: -120000, status: "done", chart_account: "22000", tax_code: null, transfer_bank: "visa", date: "2026-03-20" },
    { id: "q", account_id: "visa", cents: -120000, status: "matched", chart_account: null, tax_code: null, date: "2026-03-21" },
    { id: "r", account_id: "chq", cents: -30000, status: "done", chart_account: "10000", tax_code: null, transfer_bank: "chq2", date: "2026-03-25" },
    { id: "s", account_id: "chq2", cents: 30000, status: "matched", chart_account: null, tax_code: null, date: "2026-03-25" },
  ], chart, new Map(), ctx, { lines: [], reClosingCents: 0, reStatedCents: null });
  assert.equal(row(rows, "chart:22000"), -120000 + 120000, "the card owed 1,200.00 and is paid off");
  assert.equal(row(rows, "chart:10000"), 500000 - 120000 - 30000);
  assert.equal(row(rows, "bank:chq2"), 30000, "the 10010 account gets the transfer, not the 10000 row");
  assert.equal(rows.reduce((n, r) => n + r.cents, 0), 0, "the trial balance balances");
});
