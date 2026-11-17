// Round 28 (Hashim, Nov 17, 2026): statement rules for every account type, and loan statements. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromWire, INSTRUCTION } from "../src/lib/statements/reader.ts";
import { normalizeResult } from "../src/lib/statements/fixture-reader.ts";
import { cardKindCheck, checkAccount, loanWords } from "../src/lib/statements/checks.ts";
import { misread } from "../src/lib/closebook/banking.ts";
import { findTransfers } from "../src/lib/closebook/transfers.ts";
import { signedCents, type ReadResult, type StatementAccount } from "../src/lib/statements/types.ts";

const FIX = new URL("./fixtures/statements/round28/", import.meta.url);
const read = (f: string) => normalizeResult(JSON.parse(readFileSync(new URL(f, FIX), "utf8")) as ReadResult, 2).accounts[0] as StatementAccount;
const money = (c: number) => (c / 100).toFixed(2);

test("loan 2025-10-02: 4 principal lines and 1 information line; 4,000.00 - 800.00 + 1,100.00 = 4,300.00", () => {
  const a = read("loan-2025-10-02.json");
  const live = a.lines.filter((l) => !l.noEffect), info = a.lines.filter((l) => l.noEffect);
  assert.deepEqual(live.map((l) => money(signedCents(l))), ["-800.00", "600.00", "300.00", "200.00"]);
  assert.deepEqual(info.map((l) => [l.description, money(l.dir === "in" ? l.amountCents : -l.amountCents)]), [["Interest Payment", "-27.35"]]);
  const c = checkAccount(a);
  assert.deepEqual([money(a.opening), money(c.outTotal), money(c.inTotal), money(a.closing), c.differenceCents], ["4000.00", "800.00", "1100.00", "4300.00", 0]);
  assert.deepEqual(c.summaryOk, { in: true, out: true });
  assert.equal(c.runningBreak, null, "the running balance holds on every line");
  assert.deepEqual(c.review, [], "nothing to look at, the Sep 03 line (effective Sep 02) is inside the period by its Transaction Date");
  assert.deepEqual(cardKindCheck(a).map((r) => [r.label, money(r.printed), money(r.read), r.off]), [["Principal payments", "800.00", "800.00", 0], ["Borrowings", "1100.00", "1100.00", 0]]);
  assert.equal(loanWords(a), "Principal paid 800.00 = Total Payments 827.35 − interest 27.35 − insurance 0.00");
  assert.equal(misread(a), null);
  // The first line: bank date Sep 02 (Effective), Sep 03 kept as information.
  assert.deepEqual([a.lines[0].date, a.lines[0].printedDate], ["2025-09-02", "2025-09-03"]);
  assert.deepEqual([info[0].date, info[0].printedDate], ["2025-09-21", null], "no Effective Date: the Transaction Date");
});

test("loan 2026-08-03: 10 principal lines and 3 information lines; 8,000.00 - 15,800.00 + 7,800.00 = 0.00", () => {
  const a = read("loan-2026-08-03.json");
  const live = a.lines.filter((l) => !l.noEffect), info = a.lines.filter((l) => l.noEffect);
  assert.equal(live.length, 10);
  assert.deepEqual(info.map((l) => money(l.dir === "in" ? l.amountCents : -l.amountCents)), ["-52.10", "52.10", "-31.80"]);
  const c = checkAccount(a);
  assert.deepEqual([money(a.opening), money(c.outTotal), money(c.inTotal), money(a.closing), c.differenceCents], ["8000.00", "15800.00", "7800.00", "0.00", 0]);
  assert.deepEqual([c.summaryOk, c.runningBreak, c.review], [{ in: true, out: true }, null, []]);
  assert.equal(loanWords(a), "Principal paid 15,800.00 = Total Payments 15,831.80 − interest 31.80 − insurance 0.00");
});

test("a line is information only when both balances are printed and equal; a day's unprinted lines are never marked", () => {
  const base = { key: "a1", last4: "", name: "Chq", kind: "bank" as const, periodStart: "2026-03-01", periodEnd: "2026-03-31", opening: 10000, closing: 10000, summary: null };
  const L = (id: string, cents: number, bal: number | null) => ({ id, date: "2026-03-05", description: id, amountCents: Math.abs(cents), dir: cents > 0 ? "in" as const : "out" as const,
    balanceCents: bal, page: 1, unsure: false, unsureReason: "", source: "read" as const });
  // A bank printing one balance a day: +50 then -50, the balance printed only after the second, equal to the day before.
  const a = normalizeResult({ bank: "", pages: 1, accounts: [{ ...base, lines: [L("plus", 5000, null), L("minus", -5000, 10000)] }] }, 1).accounts[0];
  assert.deepEqual(a.lines.map((l) => !!l.noEffect), [false, false]);
  assert.equal(checkAccount(a).differenceCents, 0);
  // The loan shape: a payment with the balance unchanged right after a printed balance.
  const b = normalizeResult({ bank: "", pages: 1, accounts: [{ ...base, lines: [L("w", 5000, 15000), L("interest", -1234, 15000), L("p", -5000, 10000)] }] }, 1).accounts[0];
  assert.deepEqual(b.lines.map((l) => !!l.noEffect), [false, true, false]);
  assert.equal(checkAccount(b).differenceCents, 0, "the information line is in no total");
});

test("the reader: Effective Date is the bank date; the summary's Total Payments includes interest", () => {
  assert.match(INSTRUCTION, /Effective Date/);
  assert.match(INSTRUCTION, /Include a line even when the balance printed after it does not change/);
  const r = fromWire({ bank: "Dummy", pages: 2, accounts: [{ last_digits: "2468", name: "Operating loan", kind: "card", period_start: "2025-09-03", period_end: "2025-10-02",
    opening_balance: "4000.00", closing_balance: "4300.00",
    summary: { money_in_total: "1100.00", money_in_count: null, money_out_total: "827.35", money_out_count: null, purchases_total: null, cash_advances_total: null, interest_total: null, fees_total: null,
      loan: { total_payments: "827.35", total_borrowings: "1100.00", total_interest_paid: "27.35", total_insurance_paid: "0.00" } },
    lines: [
      { date: "2025-09-03", posted_date: null, effective_date: "2025-09-02", description: "Payment", amount: "800.00", direction: "out", balance: "3200.00", page: 2, card_kind: "payment", cardholder_digits: "", unsure: false, unsure_reason: "" },
      { date: "2025-09-10", posted_date: null, effective_date: "2025-09-09", description: "Withdrawal", amount: "600.00", direction: "in", balance: "3800.00", page: 2, card_kind: "purchase", cardholder_digits: "", unsure: false, unsure_reason: "" },
      { date: "2025-09-21", posted_date: null, effective_date: null, description: "Interest Payment", amount: "27.35", direction: "out", balance: "3800.00", page: 2, card_kind: "interest", cardholder_digits: "", unsure: false, unsure_reason: "" },
      { date: "2025-09-24", posted_date: null, effective_date: "2025-09-23", description: "Withdrawal", amount: "500.00", direction: "in", balance: "4300.00", page: 2, card_kind: "purchase", cardholder_digits: "", unsure: false, unsure_reason: "" }] }] }, 2);
  const a = r.accounts[0];
  assert.deepEqual(a.lines.map((l) => [l.date, l.printedDate, !!l.noEffect]), [["2025-09-02", "2025-09-03", false], ["2025-09-09", "2025-09-10", false], ["2025-09-21", null, true], ["2025-09-23", "2025-09-24", false]]);
  assert.deepEqual([a.summary?.outTotal, a.summary?.inTotal, a.summary?.loan], [80000, 110000, { payments: 82735, borrowings: 110000, interest: 2735, insurance: 0 }]);
  assert.equal(checkAccount(a).differenceCents, 0);
});

test("transfers: the loan's Payment pairs with chequing's LOAN PAYMENT on Sep 2; each Withdrawal with a LOAN CREDIT", () => {
  const loan = read("loan-2025-10-02.json"), chq = normalizeResult(JSON.parse(readFileSync(new URL("chq-2025-09.json", FIX), "utf8")) as ReadResult, 1).accounts[0];
  const accounts = [{ id: "L", name: "Line of credit · 1111", kind: "card" as const }, { id: "C", name: "Chequing · 1357", kind: "bank" as const }];
  const lines = [...loan.lines.filter((l) => !l.noEffect).map((l) => ({ id: `L-${l.id}`, account_id: "L", txn_date: l.date, amount: signedCents(l) / 100, status: "new" })),
    ...chq.lines.map((l) => ({ id: `C-${l.id}`, account_id: "C", txn_date: l.date, amount: signedCents(l) / 100, status: "new" }))];
  const t = findTransfers(lines, accounts);
  const first = (id: string) => { const c = t.get(id)?.[0]; return c ? `${c.otherId} ${c.days}d` : "none"; };
  assert.equal(first("C-l1"), "L-l1 0d", "LOAN PAYMENT 800.00 Sep 2 with the Payment effective Sep 2");
  assert.deepEqual([first("C-l2"), first("C-l4"), first("C-l5")], ["L-l2 0d", "L-l4 0d", "L-l5 0d"], "each LOAN CREDIT with its Withdrawal, same day");
  assert.equal(first("C-l3"), "none", "the interest from chequing is not a transfer");
});
