// Round 31, step 4 (Hashim, Nov 17, 2026): QuickBooks Online's Bank transactions page. Pairs, rules, what a Pending
// line shows, the black bar and the cards. Dummy figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRules, barText, cardBalances, findPairs, inFilter, matchesSearch, pairDays, postItem, rowView, testRule, type BankRule, type FeedAccount, type FeedLine } from "../src/lib/closebook/bank-feed.ts";
import { buildTrialBalance, type BuildChart } from "../src/lib/closebook/tb-build.ts";
import type { TaxCode } from "../src/lib/closebook/sales-tax.ts";

const CHQ: FeedAccount = { id: "chq", number: "10000", name: "Chequing", label: "10000 Chequing · Dummy ••• 1357", kind: "bank", chart: "10000", type: "Bank", openingCents: 500000 };
const CARD: FeedAccount = { id: "card", number: "22000", name: "Credit card", label: "22000 Credit card", kind: "card", chart: "22000", type: "Credit card", openingCents: 125000 };
const LOC: FeedAccount = { id: "loc", number: "22100", name: "Line of credit", label: "22100 Line of credit", kind: "card", chart: "22100", type: "Loan", openingCents: 400000 };
const ACCS = [CHQ, CARD, LOC];
let n = 0;
const line = (o: Partial<FeedLine> & Pick<FeedLine, "account_id" | "txn_date" | "cents">): FeedLine => ({
  id: o.id ?? `l${++n}`, acct_date: o.txn_date, posted_date: null, printed_date: null, description: "DUMMY", status: "new", source: "", chart_account: null, tax_code: null,
  transfer_account: null, is_split: false, rule_id: null, reviewer_reason: "", memo: "", asked_at: null, client_question: "", client_answer: "", excluded_reason: "", excluded_note: "",
  excluded_by: null, excluded_at: null, coded_by: null, files: 0, transfer: null, ...o,
});

test("a loan payment from chequing and the line of credit payment the same day: one pair, both sides", () => {
  const a = line({ id: "a", account_id: "chq", txn_date: "2025-09-02", cents: -80000, description: "LOAN PAYMENT" });
  const b = line({ id: "b", account_id: "loc", txn_date: "2025-09-02", cents: -80000, description: "PAYMENT" });
  const p = findPairs([a, b], ACCS);
  assert.equal(p.get("a")?.kind, "pair");
  assert.equal(p.get("b")?.kind, "pair");
  assert.equal((p.get("a") as { other: { id: string } }).other.id, "b");
});

test("a card payment counts the card line's posting date too: chequing Dec 19, card dated Dec 20 posted Dec 22", () => {
  const a = line({ id: "a", account_id: "chq", txn_date: "2025-12-19", cents: -50000, description: "MC PAYMENT" });
  const b = line({ id: "b", account_id: "card", txn_date: "2025-12-20", posted_date: "2025-12-22", cents: -50000, description: "PAYMENT - THANK YOU" });
  assert.equal(pairDays(a, b), 1);
  assert.equal(findPairs([a, b], ACCS).get("b")?.kind, "pair");
});

test("no pair beyond 7 days, in the same direction, or in the same account", () => {
  const a = line({ account_id: "chq", txn_date: "2025-09-01", cents: -10000 });
  assert.equal(findPairs([a, line({ account_id: "loc", txn_date: "2025-09-09", cents: -10000 })], ACCS).size, 0);
  assert.equal(findPairs([a, line({ account_id: "loc", txn_date: "2025-09-02", cents: 10000 })], ACCS).size, 0);
  assert.equal(findPairs([a, line({ account_id: "chq", txn_date: "2025-09-02", cents: 10000 })], ACCS).size, 0);
});

test("two candidates: PAIR · 2 options on chequing, nearest date first; picking Mar 2 makes it a normal pair", () => {
  const a = line({ id: "a", account_id: "chq", txn_date: "2026-03-03", cents: -100000 });
  const b = line({ id: "b", account_id: "loc", txn_date: "2026-03-05", cents: -100000 });
  const c = line({ id: "c", account_id: "loc", txn_date: "2026-03-02", cents: -100000 });
  const p = findPairs([a, b, c], ACCS);
  const s = p.get("a");
  assert.equal(s?.kind, "options");
  assert.deepEqual(s?.kind === "options" ? s.options.map((o) => o.id) : [], ["c", "b"]);
  const chosen = findPairs([a, b, c], ACCS, [{ a: "a", b: "c", kind: "chosen" }]);
  assert.equal(chosen.get("a")?.kind, "pair");
  assert.equal(chosen.get("c")?.kind, "pair");
  assert.equal(chosen.has("b"), false, "the other line is a normal line again");
});

test("two candidates, whatever the order: the other lines never settle it by themselves", () => {
  const c = line({ id: "c", account_id: "loc", txn_date: "2026-03-02", cents: -100000 });
  const a = line({ id: "a", account_id: "chq", txn_date: "2026-03-03", cents: -100000 });
  const b = line({ id: "b", account_id: "loc", txn_date: "2026-03-05", cents: -100000 });
  const p = findPairs([c, a, b], ACCS);
  assert.deepEqual([p.get("a")?.kind, p.get("b")?.kind, p.get("c")?.kind], ["options", "options", "options"]);
});

test("Unpair: never suggested again", () => {
  const a = line({ id: "a", account_id: "chq", txn_date: "2025-09-02", cents: -80000 });
  const b = line({ id: "b", account_id: "loc", txn_date: "2025-09-02", cents: -80000 });
  assert.equal(findPairs([a, b], ACCS, [{ a: "a", b: "b", kind: "rejected" }]).size, 0);
});

test("one side posted first: the later line shows Already posted from chequing", () => {
  const a = line({ id: "a", account_id: "chq", txn_date: "2025-10-06", cents: -25000, status: "done", chart_account: "22000", transfer_account: "card" });
  const b = line({ id: "b", account_id: "card", txn_date: "2025-10-08", cents: -25000 });
  const p = findPairs([a, b], ACCS);
  assert.equal(p.get("b")?.kind, "already");
  const v = rowView(b, p, new Map(), new Map(), new Map(), ACCS, () => null);
  assert.deepEqual(postItem(b, v), { id: "b", kind: "already", other: "a" });
});

const fee: BankRule = { id: "r1", priority: 1, name: "Monthly fee", direction: "out", accounts: [], match_all: true, conditions: [{ field: "description", op: "contains", value: "Monthly fee" }],
  txn_type: "expense", chart_account: "63000", bank_number: null, tax_code: "EXEMPT", memo: "", auto_post: false, active: true };

test("rules: Pending lines only, first by priority, never a paired line, direction and account respected", () => {
  const ls = [
    line({ id: "f1", account_id: "chq", txn_date: "2025-09-30", cents: -600, description: "MONTHLY FEE" }),
    line({ id: "f2", account_id: "chq", txn_date: "2025-10-31", cents: -600, description: "Monthly fee", status: "done", chart_account: "63000", tax_code: "EXEMPT" }),
    line({ id: "f3", account_id: "chq", txn_date: "2025-11-30", cents: 600, description: "MONTHLY FEE REVERSAL" }),
    line({ id: "f4", account_id: "chq", txn_date: "2025-12-31", cents: -600, description: "MONTHLY FEE", chart_account: "60000", source: "manual" }),
  ];
  const later: BankRule = { ...fee, id: "r2", priority: 2, chart_account: "69000" };
  const m = applyRules(ls, [later, fee], ACCS, new Map());
  assert.deepEqual([...m.keys()], ["f1"]);
  assert.equal(m.get("f1")?.id, "r1");
  assert.equal(testRule(fee, ls, ACCS, new Map()), 1);
  assert.equal(applyRules(ls, [{ ...fee, accounts: ["22000"] }], ACCS, new Map()).size, 0);
  const paired = new Map([["f1", { kind: "pair" as const, other: { id: "x", account_id: "loc", date: "", description: "", cents: 0, days: 0 } }]]);
  assert.equal(applyRules(ls, [fee], ACCS, paired).size, 0);
});

test("rules: amount conditions, Any of, Doesn't contain, and a vendor rule copied in", () => {
  const l = line({ account_id: "chq", txn_date: "2025-09-30", cents: -2500, description: "ACTIVITY FEE 0042" });
  const r = (c: BankRule["conditions"], all = true): BankRule => ({ ...fee, match_all: all, conditions: c, direction: "any" });
  assert.equal(applyRules([l], [r([{ field: "amount", op: "eq", value: "25.00" }])], ACCS, new Map()).size, 1);
  assert.equal(applyRules([l], [r([{ field: "amount", op: "gt", value: "25" }])], ACCS, new Map()).size, 0);
  assert.equal(applyRules([l], [r([{ field: "description", op: "is", value: "x" }, { field: "amount", op: "lt", value: "30" }], false)], ACCS, new Map()).size, 1);
  assert.equal(applyRules([l], [r([{ field: "description", op: "not_contains", value: "activity" }])], ACCS, new Map()).size, 0);
  const v = line({ account_id: "card", txn_date: "2025-09-12", cents: 5899, description: "SAMPLE PRINT SHOP #123 GUELPH ON" });
  assert.equal(applyRules([v], [r([{ field: "description", op: "contains", value: "SAMPLE PRINT SHOP GUELPH ON" }])], ACCS, new Map()).size, 1);
});

test("what a Pending line shows: a rule fills account and tax (ready); past coding shows its count; a pair is a transfer", () => {
  const l = line({ id: "f1", account_id: "chq", txn_date: "2025-09-30", cents: -600, description: "MONTHLY FEE" });
  const rules = applyRules([l], [fee], ACCS, new Map());
  const v = rowView(l, new Map(), rules, new Map(), new Map(), ACCS, () => "EXEMPT");
  assert.deepEqual([v.account, v.tax, v.badge, v.ready], ["63000", "EXEMPT", "rule", true]);
  assert.deepEqual(postItem(l, v), { id: "f1", kind: "code", account: "63000", tax: "EXEMPT", source: "rule", rule_id: "r1" });
  const auto = rowView(l, new Map(), applyRules([l], [{ ...fee, auto_post: true }], ACCS, new Map()), new Map(), new Map(), ACCS, () => null);
  assert.equal(auto.source, "auto");
  const h = rowView(line({ account_id: "card", txn_date: "2025-09-03", cents: 1500, description: "COFFEE DUMMY 22" }), new Map(), new Map(),
    new Map([["COFFEE DUMMY", { coding: { account: "60200", tax: "MEALS_HST_50" }, count: 11 }]]), new Map(), ACCS, () => null);
  assert.deepEqual([h.badge, h.historyCount, h.ready], ["history", 11, true]);
  const blank = rowView(line({ account_id: "chq", txn_date: "2025-09-03", cents: -1500, chart_account: "63000" }), new Map(), new Map(), new Map(), new Map(), ACCS, () => null);
  assert.equal(blank.ready, false, "no sales tax yet: Post stays grey");
});

test("a client rule always wins over a firm rule (Settings) when both fit one line", () => {
  const l = line({ id: "x", account_id: "card", txn_date: "2025-09-12", cents: 4520, description: "SAMPLE PRINT SHOP #12 GUELPH ON" });
  const client: BankRule = { ...fee, id: "c1", name: "Print shop", direction: "out", conditions: [{ field: "description", op: "contains", value: "SAMPLE PRINT SHOP" }], chart_account: "60000", tax_code: "HST_ON" };
  const firm = new Map([["SAMPLE PRINT SHOP GUELPH ON", { account: "69000", tax: "HST_ON" }]]);
  const v = rowView(l, new Map(), applyRules([l], [client], ACCS, new Map()), new Map(), firm, ACCS, () => null);
  assert.deepEqual([v.account, v.badge, v.ruleId], ["60000", "rule", "c1"]);
  const firmOnly = rowView(l, new Map(), new Map(), new Map(), firm, ACCS, () => null);
  assert.deepEqual([firmOnly.account, firmOnly.badge], ["69000", "firm"], "the firm rule fills it only when no client rule fits");
});

test("filter and search: money in and out, Ready to post, and an amount typed as 6.00", () => {
  const out = line({ account_id: "chq", txn_date: "2025-09-30", cents: -600, description: "Monthly fee" });
  assert.equal(inFilter("out", out, null, "bank"), true);
  assert.equal(inFilter("in", out, null, "bank"), false);
  assert.equal(matchesSearch(out, "6.00"), true);
  assert.equal(matchesSearch(out, "6"), true);
  assert.equal(matchesSearch(out, "60.00"), false);
  assert.equal(matchesSearch(out, "FEE"), true);
});

test("the black bar's words", () => {
  assert.equal(barText(Array.from({ length: 24 }, (_, i) => ({ cents: i < 12 ? -600 : -2500, out: true }))), "24 money out transactions −372.00");
  assert.equal(barText([{ cents: 10000, out: false }, { cents: 20000, out: false }]), "2 money in transactions 300.00");
  assert.equal(barText([{ cents: -42113, out: true }, { cents: 30000, out: false }]), "2 transactions · Spent 421.13 · Received 300.00");
});

test("cards: Bank is the statements' closing; Posted moves with posted lines and transfers from the other side", () => {
  const ls = [
    line({ account_id: "chq", txn_date: "2025-09-30", cents: -600, status: "done", chart_account: "63000", tax_code: "EXEMPT" }),
    line({ account_id: "chq", txn_date: "2025-09-30", cents: -2500 }),
    line({ id: "o", account_id: "chq", txn_date: "2025-09-02", cents: -80000, status: "done", source: "transfer", chart_account: "22100", transfer: { other: "i", role: "posts" } }),
    line({ id: "i", account_id: "loc", txn_date: "2025-09-02", cents: -80000, status: "matched", source: "transfer", transfer: { other: "o", role: "matched" } }),
    line({ account_id: "chq", txn_date: "2025-10-06", cents: -25000, status: "done", chart_account: "22000", transfer_account: "card" }),
  ];
  assert.deepEqual(cardBalances(CHQ, ls, ACCS), { bank: 500000 - 600 - 2500 - 80000 - 25000, posted: 500000 - 600 - 80000 - 25000, pending: 1 });
  assert.deepEqual(cardBalances(LOC, ls, ACCS), { bank: 400000 - 80000, posted: 400000 - 80000, pending: 0 });
  assert.deepEqual(cardBalances(CARD, ls, ACCS), { bank: 125000, posted: 125000 - 25000, pending: 0 });
});

// The trial balance: a split posts each row; a transfer posted before the other side came in posts one entry.
const chart = new Map<string, BuildChart>([
  ["10000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }], ["22000", { name: "Credit card", account_type: "Liability", line_no: "2707.00" }],
  ["63000", { name: "Bank charges", account_type: "Expense", line_no: "8715.00" }], ["60000", { name: "Advertising", account_type: "Expense", line_no: "8520.00" }],
  ["60200", { name: "Meals", account_type: "Expense", line_no: "8523.00" }], ["21500", { name: "GST/HST payable", account_type: "Liability", line_no: "2680.00" }],
]);
const codes = new Map<string, TaxCode>([["HST_ON", { code: "HST_ON", name: "HST ON", parts: [{ name: "HST", rate: 0.13, recoverable: true, liability: "gst_hst" }] }],
  ["EXEMPT", { code: "EXEMPT", name: "Exempt", parts: [] }]]);
const banks = [{ id: "chq", name: "Chequing", kind: "bank" as const, chart: "10000", openingCents: 0 }, { id: "card", name: "Credit card", kind: "card" as const, chart: "22000", openingCents: 0 }];
const tb = (lines: Parameters<typeof buildTrialBalance>[1]) => new Map(buildTrialBalance(banks, lines, chart, codes, { registered: true, quick: false }).map((r) => [r.number, r.cents]));

test("a split 113.00 line posts 60.00 and 53.00, each with its own sales tax", () => {
  const t = tb([{ account_id: "chq", cents: -11300, status: "done", chart_account: null, tax_code: null, splits: [{ chart_account: "60000", tax_code: "HST_ON", cents: 6000 }, { chart_account: "63000", tax_code: "EXEMPT", cents: 5300 }] }]);
  assert.equal(t.get("10000"), -11300);
  assert.equal(t.get("60000"), 5310);   // 60.00 / 1.13
  assert.equal(t.get("21500"), 690);
  assert.equal(t.get("63000"), 5300);
});

test("a Pending line with an account posts nothing; posted, one-sided transfer posts once", () => {
  assert.equal(tb([{ account_id: "chq", cents: -600, status: "new", chart_account: "63000", tax_code: "EXEMPT" }]).get("10000"), 0);
  const t = tb([{ account_id: "chq", cents: -25000, status: "done", chart_account: "22000", tax_code: null, transfer_to: "card" }]);
  assert.deepEqual([t.get("10000"), t.get("22000")], [-25000, 25000]);
});
