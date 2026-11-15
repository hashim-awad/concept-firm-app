// Round 20 (Hashim, Nov 15, 2026): transfers between the file's own bank and card accounts, found in step 4
// as the QuickBooks Online bank feed suggests "Record as transfer". Pure and tested.
//
// - A transfer is a money-out line in one account and a money-in line in another, the same amount to the
//   cent, dated within 5 days of each other, both still to code. Money out: a payment from a bank account
//   or a charge on a card. Money in: a deposit, or a payment on a card (it lowers what is owed). So paying
//   the card from the bank is a transfer.
// - Each line lists every line it could pair with, the closest date first. The first choice of each line
//   is unique across the file (closest pairs are taken first), so one line is never offered as the first
//   choice of two transfers. Nothing is accepted without the preparer.
// - Accepting codes the money-out line to the other account and marks the money-in line matched: it posts
//   nothing (src/lib/closebook/tb-build.ts).

export const TRANSFER_DAYS = 5;

export type TransferAccount = { id: string; name: string; kind: "bank" | "card"; chart_account?: string | null };
export type TransferLine = { id: string; account_id: string; txn_date: string; amount: number; status: string };
// One possible pair, seen from one line: the other line, its account and date, and the direction.
export type TransferCandidate = { otherId: string; otherAccountId: string; otherName: string; otherDate: string; days: number; direction: "to" | "from" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Mar 14" from "2026-03-14".
export const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}`;
const dayNo = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000);
export const toCents = (amount: number) => Math.round(amount * 100);

// Money leaving the account: a payment from a bank account, a charge on a card.
export function isMoneyOut(kind: "bank" | "card", cents: number): boolean {
  return kind === "card" ? cents > 0 : cents < 0;
}

// "Transfer to Savings 7788 on Mar 14" or "Transfer from Chequing 4521 on Mar 13".
export const transferLabel = (c: Pick<TransferCandidate, "direction" | "otherName" | "otherDate">) => `Transfer ${c.direction} ${c.otherName} on ${shortDate(c.otherDate)}`;
// The money-in line once matched: "Matched to transfer from Chequing 4521 on Mar 13".
export const matchedLabel = (fromName: string, fromDate: string) => `Matched to transfer from ${fromName} on ${shortDate(fromDate)}`;

// Every line still to code that could pair with another, with its candidates closest date first (then the
// earlier date, then the line id, so the order never changes between loads). The first candidate of each
// line is its unique best pair where one exists.
export function findTransfers(lines: TransferLine[], accounts: TransferAccount[], days = TRANSFER_DAYS): Map<string, TransferCandidate[]> {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  type L = TransferLine & { cents: number; day: number; out: boolean; kind: "bank" | "card" };
  const open: L[] = [];
  for (const l of lines) {
    const a = acc.get(l.account_id);
    const cents = toCents(l.amount);
    if (!a || l.status !== "new" || cents === 0) continue;
    open.push({ ...l, cents, day: dayNo(l.txn_date), out: isMoneyOut(a.kind, cents), kind: a.kind });
  }
  // Pairs by amount: money out and money in, in different accounts, within the window.
  const byAmount = new Map<number, L[]>();
  for (const l of open) {
    const k = Math.abs(l.cents);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k)!.push(l);
  }
  type Pair = { out: L; inn: L; days: number };
  const pairs: Pair[] = [];
  for (const group of byAmount.values()) {
    for (const o of group) if (o.out) for (const i of group) {
      if (i.out || i.account_id === o.account_id) continue;
      const d = Math.abs(o.day - i.day);
      if (d <= days) pairs.push({ out: o, inn: i, days: d });
    }
  }
  const cand = (self: L, other: L, d: number): TransferCandidate => ({
    otherId: other.id, otherAccountId: other.account_id, otherName: acc.get(other.account_id)!.name, otherDate: other.txn_date, days: d, direction: self.out ? "to" : "from",
  });
  const order = (a: TransferCandidate, b: TransferCandidate) => a.days - b.days || a.otherDate.localeCompare(b.otherDate) || a.otherId.localeCompare(b.otherId);
  const out = new Map<string, TransferCandidate[]>();
  for (const p of pairs) {
    if (!out.has(p.out.id)) out.set(p.out.id, []);
    if (!out.has(p.inn.id)) out.set(p.inn.id, []);
    out.get(p.out.id)!.push(cand(p.out, p.inn, p.days));
    out.get(p.inn.id)!.push(cand(p.inn, p.out, p.days));
  }
  for (const list of out.values()) list.sort(order);
  // One line in one transfer: the closest pairs are taken first across the file; each line's taken pair
  // moves to the front of its list. A line left with no free pair keeps its closest one first.
  const taken = new Set<string>();
  const sorted = [...pairs].sort((a, b) => a.days - b.days || a.out.txn_date.localeCompare(b.out.txn_date) || a.inn.txn_date.localeCompare(b.inn.txn_date)
    || a.out.id.localeCompare(b.out.id) || a.inn.id.localeCompare(b.inn.id));
  for (const p of sorted) {
    if (taken.has(p.out.id) || taken.has(p.inn.id)) continue;
    taken.add(p.out.id); taken.add(p.inn.id);
    for (const [self, other] of [[p.out, p.inn], [p.inn, p.out]] as const) {
      const list = out.get(self.id)!;
      const at = list.findIndex((c) => c.otherId === other.id);
      if (at > 0) list.unshift(...list.splice(at, 1));
    }
  }
  return out;
}

// A line coded straight to another of the file's bank or card accounts, outside a transfer, counts the
// money twice once the other account's own line is coded too: it should be matched instead.
export function looksLikeTransfer(chartAccount: string | null | undefined, ownAccountId: string, accounts: TransferAccount[]): boolean {
  if (!chartAccount) return false;
  return accounts.some((a) => a.id !== ownAccountId && a.chart_account === chartAccount);
}

export const TRANSFER_WARNING = "This looks like a transfer. Match it with the other account's line so it is not counted twice.";
