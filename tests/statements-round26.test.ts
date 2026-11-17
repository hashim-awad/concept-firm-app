// Round 26 (Hashim, Nov 17, 2026): business card statements with several cardholders, the card check by kind,
// the fix screen's words, card dates across the period and the year, and plain errors. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRequest, fromWire, INSTRUCTION, READ_SCHEMA, yearFixed } from "../src/lib/statements/reader.ts";
import { cardKindCheck, checkAccount, kindSentence } from "../src/lib/statements/checks.ts";
import { misread } from "../src/lib/closebook/banking.ts";
import { uploadState, type FileAccount } from "../src/lib/closebook/step3.ts";
import { FAULT, plainError } from "../src/lib/plain-error.ts";
import type { ReadResult, StatementAccount } from "../src/lib/statements/types.ts";

const FIX = new URL("./fixtures/statements/round26/", import.meta.url);
const read = (f: string) => (JSON.parse(readFileSync(new URL(f, FIX), "utf8")) as ReadResult).accounts[0] as StatementAccount;

test("reader: every cardholder section is one account; each line keeps its kind and cardholder digits", () => {
  assert.match(INSTRUCTION, /All those sections belong to ONE account/);
  assert.match(INSTRUCTION, /never leave a section out/);
  const line = (READ_SCHEMA.properties.accounts.items.properties.lines.items as { required: readonly string[] }).required;
  assert.ok(line.includes("card_kind") && line.includes("cardholder_digits"));
  const body = buildRequest({ bytes: new Uint8Array([37, 80, 68, 70]), mediaType: "application/pdf", pages: 1 });
  assert.equal(body.system, INSTRUCTION);
  const r = fromWire({ bank: "Dummy", pages: 1, accounts: [{ last_digits: "4417", name: "Card", kind: "card", period_start: "2025-09-18", period_end: "2025-10-17",
    opening_balance: "1250.00", closing_balance: "1049.75",
    summary: { money_in_total: "399.75", money_in_count: null, money_out_total: "600.00", money_out_count: null, purchases_total: "339.40", cash_advances_total: "0.00", interest_total: "21.35", fees_total: "39.00" },
    lines: [{ date: "2025-09-20", posted_date: "2025-09-22", description: "COFFEE DUMMY", amount: "12.75", direction: "in", balance: null, page: 1, card_kind: "purchase", cardholder_digits: "9032", unsure: false, unsure_reason: "" }] }] }, 1);
  const a = r.accounts[0];
  assert.deepEqual([a.lines[0].cardKind, a.lines[0].holder, a.summary?.purchases, a.summary?.cashAdvances], ["purchase", "9032", 33940, 0]);
});

test("the full read of a two-cardholder statement: every kind matches and it balances", () => {
  const a = read("card-2025-09-18.json");
  assert.equal(new Set(a.lines.map((l) => l.holder)).size, 2, "both cardholder sections");
  assert.equal(checkAccount(a).differenceCents, 0);
  assert.deepEqual(cardKindCheck(a).map((r) => [r.label, r.printed, r.read, r.off]), [
    ["Payments and credits", 60000, 60000, 0], ["Purchases and debits", 33940, 33940, 0], ["Cash advances", 0, 0, 0], ["Interest", 2135, 2135, 0], ["Fees", 3900, 3900, 0]]);
  assert.equal(misread(a), null);
});

test("a second cardholder's line left out: 'Lines missing', said by kind, no line guessed", () => {
  const m = misread(read("card-2025-10-18.json"))!;
  assert.equal(m.title, "Lines missing.");
  assert.equal(m.lineId, null, "no line is highlighted without a running balance");
  assert.deepEqual(m.rows, ["Purchases and debits: statement 108.09, lines read 83.59, 24.50 missing"]);
  const a = read("card-2025-09-18.json");
  a.lines = a.lines.filter((l) => l.description !== "PHONE DUMMY");
  assert.deepEqual(misread(a)!.rows, ["Purchases and debits: statement 339.40, lines read 235.20, 104.20 missing"]);
  a.lines.push({ ...a.lines[0], id: "x", description: "EXTRA", amountCents: 1000, dir: "out", cardKind: "payment" });
  assert.equal(kindSentence(cardKindCheck(a)[0]), "Payments and credits: statement 600.00, lines read 610.00, 10.00 more than the statement");
});

test("a running balance still points to its line", () => {
  const a: StatementAccount = { key: "a1", last4: "5678", name: "Savings", kind: "bank", periodStart: "2026-03-02", periodEnd: "2026-04-02", opening: 100000, closing: 90000, summary: null,
    lines: [{ id: "l1", date: "2026-03-03", description: "Fee", amountCents: 1000, dir: "out", balanceCents: 98000, page: 1, unsure: false, unsureReason: "", source: "read" },
      { id: "l2", date: "2026-03-09", description: "Cheque", amountCents: 8000, dir: "out", balanceCents: 90000, page: 1, unsure: false, unsureReason: "", source: "read" }] };
  const m = misread(a)!;
  assert.deepEqual([m.title, m.lineId], ["One line looks misread.", "l1"]);
});

test("dates: a December line given the next year comes back into the period; a purchase before the period stays", () => {
  assert.equal(yearFixed("2026-12-20", "2025-12-18", "2026-01-19"), "2025-12-20");
  assert.equal(yearFixed("2025-01-05", "2025-12-18", "2026-01-19"), "2026-01-05");
  assert.equal(yearFixed("2025-12-16", "2025-12-18", "2026-01-19"), "2025-12-16", "the purchase date, two days before");
  assert.equal(yearFixed("2025-06-01", "2025-12-18", "2026-01-19"), "2025-06-01", "nothing near: left as read");
});

test("a second cardholder's digits do not make it the wrong account when the statement's digits match", () => {
  const card: FileAccount = { id: "c1", number: "22000", name: "Credit card", kind: "card", last4: "4417" };
  const other: FileAccount = { id: "c2", number: "22010", name: "Another card", kind: "card", last4: "1234" };
  const ctx = { yearStart: "2025-09-01", yearEnd: "2026-08-31", accounts: [card, other], target: card, importedShas: new Set<string>(), importedPeriods: [] };
  const row = { id: "u1", status: "needs_look", period_start: "2025-10-18", period_end: "2025-11-17", found: [{ name: "Card", last4: "4417", kind: "card" as const }, { name: "Card", last4: "9032", kind: "card" as const }] };
  assert.equal(uploadState(row, ctx).status, "needs_look");
});

test("a database error never reaches the screen", () => {
  assert.equal(plainError('new row for relation "cb_bank_statements" violates check constraint "cb_bank_statements_period"'), FAULT);
  assert.equal(plainError("Could not find the function public.cb_save_bank_account(p_balance) in the schema cache"), FAULT);
  assert.equal(plainError("Ask the reviewer to remove the 3.1 sign-off."), "Ask the reviewer to remove the 3.1 sign-off.");
});

test("a card purchase before the period, posted inside it, is not flagged; the statement is ready", () => {
  const a = read("card-2025-09-18.json");
  assert.equal(a.lines[0].date < a.periodStart, true, "bought Sep 16, before the Sep 18 start");
  assert.deepEqual(checkAccount(a).review, []);
  assert.equal(checkAccount(read("card-2025-12-18.json")).ok, true, "Dec 18 to Jan 19, across the new year");
});

test("the posting date only checks the statement period; the year cut-off still uses the purchase date (round 22)", async () => {
  const { yearCut } = await import("../src/lib/closebook/step3.ts");
  // A card statement Aug 18 to Sep 17, 2025, in a file whose year starts Sep 1, 2025.
  const a: StatementAccount = { key: "a1", last4: "4417", name: "Card", kind: "card", periodStart: "2025-08-18", periodEnd: "2025-09-17", opening: 10000, closing: 0, summary: null,
    lines: [
      { id: "l1", date: "2025-08-30", postedDate: "2025-09-02", description: "BOUGHT AUG 30, POSTED SEP 2", amountCents: 5000, dir: "in", balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read" },
      { id: "l2", date: "2025-09-05", postedDate: "2025-09-06", description: "BOUGHT SEP 5", amountCents: 2000, dir: "in", balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read" }] };
  a.closing = 10000 + 5000 + 2000;
  const cut = yearCut(a, "2025-09-01", "2026-08-31");
  assert.deepEqual(cut.inYear.map((l) => l.id), ["l2"], "Aug 30 is last year, by the purchase date, though posted Sep 2");
  assert.equal(cut.atStart, 10000 + 5000, "owing at the start of the year includes the Aug 30 purchase");
  assert.deepEqual(checkAccount(a).review, [], "both lines are inside the statement period");
});
