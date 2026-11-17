// Round 31, step 4 (Hashim, Nov 17, 2026): Code transactions as QuickBooks Online's "Bank transactions" page
// (Pending, Posted, Excluded). The rules behind the page, pure and tested (tests/bank-feed.test.ts):
// - pairs: a transfer between two of the client's bank, card or loan accounts (QuickBooks Online's PAIR);
// - bank rules (QuickBooks Online bank rules): conditions, priority, one rule per line;
// - what each Pending line shows (account, sales tax, badge) and whether it is ready to post;
// - the filter, the black bar's words and the cards' "Posted" balance.
import { vendorKey, type History } from "./vendor.ts";

export const PAIR_DAYS = 7;

export type FeedAccount = { id: string; number: string; name: string; label: string; kind: "bank" | "card"; chart: string; type: "Bank" | "Credit card" | "Loan";
  openingCents: number };
export type FeedLine = {
  id: string; account_id: string; txn_date: string; acct_date: string; posted_date: string | null; printed_date: string | null;
  description: string; cents: number; status: string; source: string;
  chart_account: string | null; tax_code: string | null; transfer_account: string | null; is_split: boolean; rule_id: string | null;
  reviewer_reason: string; memo: string; asked_at: string | null; client_question: string; client_answer: string;
  excluded_reason: string; excluded_note: string; excluded_by: string | null; excluded_at: string | null; coded_by: string | null;
  files: number;
  transfer: { other: string; role: "posts" | "matched" } | null;   // the line's transfer, once posted
  q_status?: string; q_sent_on?: string | null;                     // round 32: '' | not_sent | waiting | answered
};

// Money out: a payment from a bank account, a charge on a card or a loan.
export const isOut = (kind: "bank" | "card", cents: number) => (kind === "card" ? cents > 0 : cents < 0);
// Pending: still to post (an uploaded duplicate sent to the reviewer before it had an account is Pending too).
export const isPending = (l: Pick<FeedLine, "status" | "chart_account" | "is_split" | "transfer_account">) =>
  l.status === "new" || l.status === "ask_client" || (l.status === "reviewer" && !l.chart_account && !l.is_split && !l.transfer_account);
export const isExcluded = (l: Pick<FeedLine, "status">) => l.status === "excluded";
export const isPosted = (l: Pick<FeedLine, "status" | "chart_account" | "is_split" | "transfer_account">) => !isPending(l) && !isExcluded(l);

const day = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
// Either of a line's dates counts (the bank date, a card's posting date, a loan's printed date).
const datesOf = (l: Pick<FeedLine, "txn_date" | "posted_date" | "printed_date">) => [l.txn_date, l.posted_date, l.printed_date].filter((d): d is string => !!d).map(day);
export function pairDays(a: Pick<FeedLine, "txn_date" | "posted_date" | "printed_date">, b: Pick<FeedLine, "txn_date" | "posted_date" | "printed_date">): number {
  let best = Infinity;
  for (const x of datesOf(a)) for (const y of datesOf(b)) best = Math.min(best, Math.abs(x - y));
  return best;
}

export type PairOption = { id: string; account_id: string; date: string; description: string; cents: number; days: number };
export type PairState =
  | { kind: "pair"; other: PairOption }                  // one candidate each way, or the one picked: "PAIR · 22100 Line of credit"
  | { kind: "options"; options: PairOption[] }           // several: "PAIR · 2 options", nearest date first, none chosen
  | { kind: "already"; other: PairOption };              // the other side was posted first: "PAIR · Already posted from 10000 Chequing"
export type PairChoice = { a: string; b: string; kind: "chosen" | "rejected" };
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// QuickBooks Online's PAIR: a Pending line in one of the client's accounts and a Pending line in another, the same
// amount to the cent, opposite directions, no more than 7 days apart (either date of a card or loan line counts).
// A pair picked among several holds; an unpaired pair is never suggested again. A Pending line with no Pending match
// whose other side was already posted to its account shows "Already posted".
export function findPairs(lines: FeedLine[], accounts: FeedAccount[], choices: PairChoice[] = []): Map<string, PairState> {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const rejected = new Set(choices.filter((c) => c.kind === "rejected").map((c) => key(c.a, c.b)));
  const opt = (self: FeedLine, o: FeedLine): PairOption => ({ id: o.id, account_id: o.account_id, date: o.txn_date, description: o.description, cents: o.cents, days: pairDays(self, o) });
  const outOf = (l: FeedLine) => isOut(acc.get(l.account_id)?.kind ?? "bank", l.cents);
  const fits = (a: FeedLine, b: FeedLine) => a.account_id !== b.account_id && a.cents !== 0 && Math.abs(a.cents) === Math.abs(b.cents) && outOf(a) !== outOf(b)
    && pairDays(a, b) <= PAIR_DAYS && !rejected.has(key(a.id, b.id));
  const pending = lines.filter((l) => isPending(l) && acc.has(l.account_id) && l.cents !== 0);
  const byAmount = new Map<number, FeedLine[]>();
  for (const l of pending) byAmount.set(Math.abs(l.cents), [...(byAmount.get(Math.abs(l.cents)) ?? []), l]);
  const cands = new Map<string, FeedLine[]>();
  for (const group of byAmount.values()) for (const l of group) {
    const c = group.filter((o) => o !== l && fits(l, o));
    if (c.length) cands.set(l.id, c);
  }
  const out = new Map<string, PairState>();
  const paired = new Set<string>();   // lines in a pair (a line with options stays free for the others)
  const byId = new Map(lines.map((l) => [l.id, l]));
  // The pairs a person picked first.
  for (const c of choices) if (c.kind === "chosen") {
    const a = byId.get(c.a), b = byId.get(c.b);
    if (!a || !b || !isPending(a) || !isPending(b) || !fits(a, b) || paired.has(a.id) || paired.has(b.id)) continue;
    out.set(a.id, { kind: "pair", other: opt(a, b) }); out.set(b.id, { kind: "pair", other: opt(b, a) }); paired.add(a.id); paired.add(b.id);
  }
  const free = (l: FeedLine) => (cands.get(l.id) ?? []).filter((o) => !paired.has(o.id));
  for (const l of pending) {
    if (paired.has(l.id)) continue;
    const c = free(l);
    if (!c.length) continue;
    if (c.length === 1 && free(c[0]).length === 1) {
      out.set(l.id, { kind: "pair", other: opt(l, c[0]) }); out.set(c[0].id, { kind: "pair", other: opt(c[0], l) }); paired.add(l.id); paired.add(c[0].id);
      continue;
    }
    out.set(l.id, { kind: "options", options: c.map((o) => opt(l, o)).sort((x, y) => x.days - y.days || x.date.localeCompare(y.date) || x.id.localeCompare(y.id)) });
  }
  // Already posted from the other side: a posted transfer to this line's account, not matched to a line yet.
  const matched = new Set(lines.filter((l) => l.transfer).map((l) => l.id));
  const posted = lines.filter((l) => isPosted(l) && !!l.transfer_account && !matched.has(l.id));
  for (const l of pending) {
    if (out.has(l.id)) continue;
    const c = posted.filter((o) => o.transfer_account === l.account_id && fits(l, o)).sort((x, y) => pairDays(l, x) - pairDays(l, y) || x.id.localeCompare(y.id));
    if (c.length) out.set(l.id, { kind: "already", other: opt(l, c[0]) });
  }
  return out;
}

// ---------- Bank rules (QuickBooks Online)
export type RuleCondition = { field: "description" | "amount"; op: "contains" | "not_contains" | "is" | "eq" | "gt" | "lt"; value: string };
export type BankRule = {
  id: string; priority: number; name: string; direction: "out" | "in" | "any"; accounts: string[]; match_all: boolean; conditions: RuleCondition[];
  txn_type: string; chart_account: string | null; bank_number: string | null; tax_code: string | null; memo: string; auto_post: boolean; active: boolean;
};

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
// "Contains" reads the description as printed, and also without the numbers and card masks (a vendor rule copied in
// holds the vendor's name as round 2 kept it: "SAMPLE PRINT SHOP GUELPH ON").
function contains(description: string, value: string): boolean {
  const v = norm(value);
  if (!v) return false;
  return norm(description).includes(v) || (vendorKey(description).includes(vendorKey(value)) && vendorKey(value).length > 0);
}
export function conditionHolds(c: RuleCondition, l: Pick<FeedLine, "description" | "cents">): boolean {
  if (c.field === "description") {
    if (c.op === "contains") return contains(l.description, c.value);
    if (c.op === "not_contains") return !contains(l.description, c.value);
    return norm(l.description) === norm(c.value);
  }
  const want = Math.round(Number(c.value) * 100), have = Math.abs(l.cents);
  if (!Number.isFinite(want)) return false;
  return c.op === "eq" ? have === Math.abs(want) : c.op === "gt" ? have > Math.abs(want) : have < Math.abs(want);
}
export function ruleMatches(r: BankRule, l: Pick<FeedLine, "description" | "cents" | "account_id">, a: Pick<FeedAccount, "number" | "kind">): boolean {
  if (!r.active || !r.conditions.length) return false;
  const out = isOut(a.kind, l.cents);
  if (r.direction === "out" && !out) return false;
  if (r.direction === "in" && out) return false;
  if (r.accounts.length && !r.accounts.includes(a.number)) return false;
  return r.match_all ? r.conditions.every((c) => conditionHolds(c, l)) : r.conditions.some((c) => conditionHolds(c, l));
}

// A Pending line nobody has filled (no account, transfer or split chosen by a person) and not in a pair: the first
// active rule by priority. A rule never changes a posted line, never touches a paired line and never excludes.
export const isUnfilled = (l: FeedLine) => !l.chart_account && !l.transfer_account && !l.is_split && (l.source === "" || l.source === "rule");
export function applyRules(lines: FeedLine[], rules: BankRule[], accounts: FeedAccount[], pairs: Map<string, PairState>): Map<string, BankRule> {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const ordered = [...rules].filter((r) => r.active).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const out = new Map<string, BankRule>();
  for (const l of lines) {
    const a = acc.get(l.account_id);
    if (!a || !isPending(l) || !isUnfilled(l) || pairs.has(l.id)) continue;
    const r = ordered.find((x) => ruleMatches(x, l, a));
    if (r) out.set(l.id, r);
  }
  return out;
}
// "Test rule": how many Pending lines the rule would fill.
export function testRule(r: BankRule, lines: FeedLine[], accounts: FeedAccount[], pairs: Map<string, PairState>): number {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  return lines.filter((l) => { const a = acc.get(l.account_id); return !!a && isPending(l) && isUnfilled(l) && !pairs.has(l.id) && ruleMatches({ ...r, active: true }, l, a); }).length;
}

// ---------- What a Pending line shows
export type Badge = "rule" | "pair" | "options" | "already" | "history" | "firm" | null;
export type RowView = {
  account: string | null; tax: string | null; transfer: string | null; split: boolean; badge: Badge; ruleId: string | null; historyCount: number;
  pair: PairState | null; ready: boolean; source: "manual" | "rule" | "auto" | "history" | "firm";
};
export function rowView(l: FeedLine, pairs: Map<string, PairState>, rules: Map<string, BankRule>, history: History, firm: Map<string, { account: string; tax: string | null }>,
  accounts: FeedAccount[], taxFor: (account: string) => string | null): RowView {
  const p = pairs.get(l.id) ?? null;
  const none: RowView = { account: null, tax: null, transfer: null, split: false, badge: null, ruleId: null, historyCount: 0, pair: null, ready: false, source: "manual" };
  if (l.is_split) return { ...none, split: true, ready: true };
  if (l.transfer_account) return { ...none, transfer: l.transfer_account, ready: true };
  if (p) {
    if (p.kind === "options") return { ...none, badge: "options", pair: p };
    const other = accounts.find((a) => a.id === p.other.account_id)?.id ?? null;
    return { ...none, transfer: other, badge: p.kind === "pair" ? "pair" : "already", pair: p, ready: true };
  }
  if (l.chart_account) return { ...none, account: l.chart_account, tax: l.tax_code, ready: !!l.tax_code };
  const r = rules.get(l.id);
  if (r) {
    if (r.bank_number) {
      const t = accounts.find((a) => a.number === r.bank_number && a.id !== l.account_id);
      if (t) return { ...none, transfer: t.id, badge: "rule", ruleId: r.id, ready: true, source: r.auto_post ? "auto" : "rule" };
    } else if (r.chart_account) {
      const tax = r.tax_code ?? taxFor(r.chart_account);
      return { ...none, account: r.chart_account, tax, badge: "rule", ruleId: r.id, ready: !!tax, source: r.auto_post ? "auto" : "rule" };
    }
  }
  const h = history.get(vendorKey(l.description));
  if (h) {
    const tax = h.coding.tax ?? taxFor(h.coding.account);
    return { ...none, account: h.coding.account, tax, badge: "history", historyCount: h.count, ready: !!tax, source: "history" };
  }
  const f = firm.get(vendorKey(l.description));
  if (f) {
    const tax = f.tax ?? taxFor(f.account);
    return { ...none, account: f.account, tax, badge: "firm", ready: !!tax, source: "firm" };
  }
  return none;
}

// What "Post" sends for one line, from what it shows (null: not ready).
export type PostItem = { id: string; kind: "code" | "split" | "transfer" | "pair" | "already"; account?: string; tax?: string; transfer_account?: string; other?: string;
  source?: string; rule_id?: string | null };
export function postItem(l: FeedLine, v: RowView): PostItem | null {
  if (!v.ready) return null;
  if (v.split) return { id: l.id, kind: "split" };
  if (v.pair?.kind === "pair") return { id: l.id, kind: "pair", other: v.pair.other.id };
  if (v.pair?.kind === "already") return { id: l.id, kind: "already", other: v.pair.other.id };
  if (v.transfer) return { id: l.id, kind: "transfer", transfer_account: v.transfer, source: v.source, rule_id: v.ruleId };
  if (v.account && v.tax) return { id: l.id, kind: "code", account: v.account, tax: v.tax, source: v.source, rule_id: v.ruleId };
  return null;
}

// ---------- The filter ("All transactions ▾")
export const FILTERS = [
  ["all", "All transactions"], ["in", "Money in"], ["out", "Money out"], ["ready", "Ready to post"], ["transfers", "Transfers"], ["rules", "Rules"],
  ["none", "No account"], ["q_not_sent", "Asked, not sent"], ["q_waiting", "Waiting for client"], ["q_answered", "Client answered"], ["reviewer", "For the reviewer"],
] as const;
export type FilterKey = (typeof FILTERS)[number][0];
export function inFilter(f: FilterKey, l: FeedLine, v: RowView | null, kind: "bank" | "card"): boolean {
  const out = isOut(kind, l.cents);
  switch (f) {
    case "all": return true;
    case "in": return !out;
    case "out": return out;
    case "ready": return !!v?.ready;
    case "transfers": return !!v && (!!v.pair || !!v.transfer) || !!l.transfer || !!l.transfer_account;
    case "rules": return v?.badge === "rule" || l.source === "rule" || l.source === "auto";
    case "none": return !!v && !v.account && !v.transfer && !v.split && !v.pair;
    case "q_not_sent": return l.q_status === "not_sent";
    case "q_waiting": return l.q_status === "waiting";
    case "q_answered": return l.q_status === "answered";
    case "reviewer": return !!l.reviewer_reason;
  }
}
// The search box: the description, and the amount ("6.00" finds the 6.00 lines; "6" too).
export function matchesSearch(l: Pick<FeedLine, "description" | "cents" | "memo">, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const amt = (Math.abs(l.cents) / 100).toFixed(2);
  const num = t.replace(/[$,\s]/g, "");
  if (/^-?\d+(\.\d{1,2})?$/.test(num) && amt === Math.abs(Number(num)).toFixed(2)) return true;
  return l.description.toLowerCase().includes(t) || l.memo.toLowerCase().includes(t);
}

// ---------- The black bar ("3 money out transactions −421.13")
const fmt = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function barText(ticked: { cents: number; out: boolean }[]): string {
  const outs = ticked.filter((t) => t.out), ins = ticked.filter((t) => !t.out);
  const spent = outs.reduce((n, t) => n + Math.abs(t.cents), 0), got = ins.reduce((n, t) => n + Math.abs(t.cents), 0);
  const n = ticked.length, s = (k: number) => (k === 1 ? "" : "s");
  if (!ins.length) return `${n} money out transaction${s(n)} −${fmt(spent)}`;
  if (!outs.length) return `${n} money in transaction${s(n)} ${fmt(got)}`;
  return `${n} transactions · Spent ${fmt(spent)} · Received ${fmt(got)}`;
}

// ---------- The cards: "Bank" (3.3's closing: every line on the statements) and "Posted" (the trial balance:
// the opening in 3.1 plus the posted lines, including transfers posted from the other side).
export function cardBalances(a: FeedAccount, lines: FeedLine[], accounts: FeedAccount[]): { bank: number; posted: number; pending: number } {
  const acc = new Map(accounts.map((x) => [x.id, x]));
  let bank = a.openingCents, posted = a.openingCents, pending = 0;
  for (const l of lines) {
    if (l.account_id === a.id) {
      if (!(l.status === "matched" && l.source === "outstanding")) bank += l.cents;
      if (isPending(l)) pending++;
      // A line posts once posted; a matched line moves this account through its other side's entry.
      else if (isPosted(l) && !(l.status === "matched" && l.source === "outstanding")) posted += l.cents;
    } else if (isPosted(l) && l.status !== "matched") {
      // A transfer posted from another account into this one (a pair's money-out line, or posted before this side came in)
      // moves this account only when this account has no matched line for it.
      const to = l.transfer_account ?? (l.transfer?.role === "posts" ? lines.find((x) => x.id === l.transfer!.other)?.account_id : undefined);
      if (to !== a.id) continue;
      if (l.transfer?.role === "posts") continue;   // its matched line in this account already counted above
      const src = acc.get(l.account_id);
      if (!src) continue;
      const debit = src.kind === "bank" ? l.cents : -l.cents;           // the source account's side
      posted += a.kind === "bank" ? -debit : debit;                     // the other side, in this account's terms
    }
  }
  return { bank, posted, pending };
}

// The picker's type for a chart account: Cost of sales for the 5xxxx expenses (GIFI 8300 to 8519).
export function chartTypeLabel(c: { number: string; account_type: string }): string {
  return c.account_type === "Expense" && c.number.startsWith("5") ? "Cost of sales" : c.account_type;
}
export function bankTypeLabel(accountType: string | null, kind: "bank" | "card"): FeedAccount["type"] {
  if (kind === "bank") return "Bank";
  return accountType === "card" ? "Credit card" : "Loan";
}
// "Transfer" or "Credit card payment" (QuickBooks Online's transaction type on a pair).
export function pairType(a: FeedAccount | undefined, b: FeedAccount | undefined): string {
  return a?.type === "Credit card" || b?.type === "Credit card" ? "Credit card payment" : "Transfer";
}
