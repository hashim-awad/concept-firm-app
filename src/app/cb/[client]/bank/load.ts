// CB2-1 PR B part g: what the Bank transactions page reads. One card per bank or card account; the chosen account's lines
// across every year in Closebook, each with its state (For review, Categorized, Excluded), its suggestion and its Match options.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { historyOf, suggest, type BooksRule, type Suggestion } from "@/lib/books/bank";
import { acctLabel, balancesOn, getBankAccounts, getBooks, todayIso, type BankCard } from "../../data";
import type { BooksData } from "@/lib/books/server";

export type MatchOpt = { kind: "entry" | "pair"; id: string; date: string; label: string };
export type BLine = {
  id: string; fileId: string; locked: boolean; date: string; description: string; cents: number;
  state: "review" | "categorized" | "excluded";
  account: string | null; tax: string | null; memo: string; source: string;
  split: { account: string; tax: string; cents: number; memo: string }[] | null;
  transfer: string | null;                 // the other bank or card account (its label), once a transfer
  entry: { id: string; label: string } | null;
  excluded: { reason: string; note: string } | null;
  suggestion: Suggestion | null;
  matches: MatchOpt[];
};
export type BankCardView = BankCard & { balance: number; review: number };
export type Opt = { value: string; label: string };
export type BankPage = { cards: BankCardView[]; card: BankCardView | null; lines: BLine[]; accounts: Opt[]; taxes: Opt[]; defaultTax: Record<string, string>;
  banks: Opt[]; rules: BooksRule[] };

type Row = { id: string; file_id: string; account_id: string; txn_date: string; description: string; amount: number; status: string; source: string; chart_account: string | null;
  tax_code: string | null; transfer_account: string | null; is_split: boolean; memo: string; matched_entry: string | null; excluded_reason: string; excluded_note: string; rule_id: string | null };
const pending = (r: Pick<Row, "status" | "chart_account" | "is_split" | "transfer_account">) =>
  r.status === "new" || r.status === "ask_client" || (r.status === "reviewer" && !r.chart_account && !r.is_split && !r.transfer_account);
const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const fmt = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const COLS = "id, file_id, account_id, txn_date, description, amount, status, source, chart_account, tax_code, transfer_account, is_split, memo, matched_entry, excluded_reason, excluded_note, rule_id";

// The account picker (the client's active accounts the posting engine knows, by number; never a bank account itself), each
// account's default tax code, the province's tax codes and the client's bank and card accounts.
export async function loadPickers(b: BooksData, cards: BankCard[]): Promise<{ accounts: Opt[]; taxes: Opt[]; defaultTax: Record<string, string>; banks: Opt[] }> {
  const supabase = await createClient();
  const [{ data: chartRows }, { data: codes }] = await Promise.all([
    supabase.from("cb_chart_accounts").select("number, tax_default"),
    supabase.from("cb_sales_tax_codes").select("code, name, provinces").order("sort_order"),
  ]);
  const firm = new Map(((chartRows ?? []) as { number: string; tax_default: string | null }[]).map((r) => [r.number, r.tax_default]));
  const bankIdents = new Set(cards.map((c) => c.ident));
  const accounts = b.chart.filter((a) => a.active && !a.merged_into && a.number && firm.has(a.number) && !bankIdents.has(a.number))
    .map((a) => ({ value: a.number, label: acctLabel(a) })).sort((x, y) => x.value.localeCompare(y.value, "en", { numeric: true }));
  const defaultTax: Record<string, string> = {};
  for (const a of b.chart) if (a.number && firm.has(a.number)) { const t = a.tax_code ?? firm.get(a.number); if (t) defaultTax[a.number] = t; }
  const province = b.client.province;
  const taxes = ((codes ?? []) as { code: string; name: string; provinces: string[] | null }[]).filter((c) => !c.provinces || c.provinces.includes(province)).map((c) => ({ value: c.code, label: c.name }));
  const banks = cards.map((c) => ({ value: c.ident, label: acctLabel({ number: c.ident, name: c.name }) }));
  return { accounts, taxes, defaultTax, banks };
}

export async function loadBankPage(clientId: string, ident: string | null): Promise<BankPage | null> {
  const b = await getBooks(clientId);
  if (!b) return null;
  const supabase = await createClient();
  const cardsIn = await getBankAccounts(clientId);
  const allIds = cardsIn.flatMap((c) => c.ids);
  const bal = balancesOn(b, todayIso());
  const [{ data: states }, { accounts, taxes, defaultTax, banks }, { data: ruleRows }] = await Promise.all([
    allIds.length ? supabase.from("cb_bank_lines").select("account_id, status, chart_account, is_split, transfer_account").in("account_id", allIds).limit(100000) : Promise.resolve({ data: [] }),
    loadPickers(b, cardsIn),
    supabase.from("cb_books_rules").select("id, name, priority, direction, accounts, match_all, conditions, chart_account, splits, tax_code, memo, auto_confirm, active").eq("cb_client_id", clientId).order("priority"),
  ]);
  const reviewBy = new Map<string, number>();
  for (const s of (states ?? []) as Pick<Row, "account_id" | "status" | "chart_account" | "is_split" | "transfer_account">[]) if (pending(s)) reviewBy.set(s.account_id, (reviewBy.get(s.account_id) ?? 0) + 1);
  const cards: BankCardView[] = cardsIn.map((c) => ({ ...c, balance: (c.kind === "card" ? -1 : 1) * (bal.get(c.ident) ?? 0), review: c.ids.reduce((n, id) => n + (reviewBy.get(id) ?? 0), 0) }));
  const card = cards.find((c) => c.ident === ident) ?? cards[0] ?? null;

  const rules = ((ruleRows ?? []) as BooksRule[]).map((r) => ({ ...r, accounts: r.accounts ?? [], conditions: r.conditions ?? [] }));
  if (!card) return { cards, card: null, lines: [], accounts, taxes, defaultTax, banks, rules };

  const fileIds = b.files.map((f) => f.id);
  const [{ data: rows }, { data: coded }, { data: accts }] = await Promise.all([
    supabase.from("cb_bank_lines").select(COLS).in("account_id", card.ids).order("txn_date", { ascending: false }).order("row_no").limit(50000),
    // History suggestions: the client's lines confirmed with an account, the latest first.
    supabase.from("cb_bank_lines").select("description, chart_account, tax_code").in("file_id", fileIds).in("status", ["done", "reviewer"]).not("chart_account", "is", null)
      .order("coded_at", { ascending: false }).limit(5000),
    supabase.from("cb_bank_accounts").select("id, number, chart_account, kind").in("file_id", fileIds),
  ]);
  const lines0 = (rows ?? []) as Row[];
  const ids = lines0.map((l) => l.id);
  const acctIdent = new Map(((accts ?? []) as { id: string; number: string | null; chart_account: string }[]).map((a) => [a.id, a.number || a.chart_account]));
  const kindOf = new Map(((accts ?? []) as { id: string; kind: "bank" | "card" }[]).map((a) => [a.id, a.kind]));
  const [{ data: splits }, { data: transfers }, { data: others }] = await Promise.all([
    ids.length ? supabase.from("cb_line_splits").select("line_id, chart_account, tax_code, amount, memo").in("line_id", ids).order("row_no") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("cb_bank_transfers").select("out_line, in_line").or(`out_line.in.(${ids.join(",")}),in_line.in.(${ids.join(",")})`) : Promise.resolve({ data: [] }),
    // Transfer candidates: For review lines in the client's other accounts.
    supabase.from("cb_bank_lines").select(COLS).in("account_id", cards.filter((c) => c.ident !== card.ident).flatMap((c) => c.ids)).in("status", ["new", "ask_client"]).limit(50000),
  ]);
  const splitBy = new Map<string, BLine["split"]>();
  for (const s of (splits ?? []) as { line_id: string; chart_account: string; tax_code: string; amount: number; memo: string }[])
    splitBy.set(s.line_id, [...(splitBy.get(s.line_id) ?? []), { account: s.chart_account, tax: s.tax_code, cents: Math.round(s.amount * 100), memo: s.memo }]);
  const pairOf = new Map<string, string>();
  for (const t of (transfers ?? []) as { out_line: string; in_line: string }[]) { pairOf.set(t.out_line, t.in_line); pairOf.set(t.in_line, t.out_line); }
  const otherLines = (others ?? []) as Row[];
  const pairLines = new Map<string, Row>();
  if (pairOf.size) {
    const { data: p } = await supabase.from("cb_bank_lines").select(COLS).in("id", [...pairOf.values()]);
    for (const r of (p ?? []) as Row[]) pairLines.set(r.id, r);
  }
  const lockedFile = new Set(b.files.filter((f) => f.phase === "locked").map((f) => f.id));
  const history = historyOf(((coded ?? []) as { description: string; chart_account: string | null; tax_code: string | null }[]).map((r) => ({ description: r.description, account: r.chart_account, tax: r.tax_code })));
  const labelOfIdent = (i: string | undefined) => (i ? acctLabel({ number: i, name: b.byIdent.get(i)?.name ?? cards.find((c) => c.ident === i)?.name ?? "" }) : "");
  const usedEntries = new Set(lines0.map((l) => l.matched_entry).filter(Boolean));
  const entryNo = new Map(b.entries.map((e) => [e.id, e.no]));
  // Journal entries that post this amount to this account (money in is a debit on a bank account; a charge a credit on a card).
  const entryPostings = b.books.postings.filter((p) => p.kind === "entry" && p.ident === card.ident);

  const lines: BLine[] = lines0.map((r) => {
    const cents = Math.round(r.amount * 100);
    const state: BLine["state"] = r.status === "excluded" ? "excluded" : pending(r) ? "review" : "categorized";
    const other = pairOf.get(r.id);
    const transfer = r.transfer_account ? labelOfIdent(acctIdent.get(r.transfer_account)) : other ? labelOfIdent(acctIdent.get(pairLines.get(other)?.account_id ?? "")) : null;
    let matches: MatchOpt[] = [];
    if (state === "review") {
      const want = card.kind === "card" ? -cents : cents;
      matches = [
        ...entryPostings.filter((p) => p.cents === want && !usedEntries.has(p.ref) && Math.abs(day(p.date) - day(r.txn_date)) <= 60)
          .map((p) => ({ kind: "entry" as const, id: p.ref, date: p.date, label: `${fmt(p.date)} · Journal entry ${entryNo.get(p.ref) ?? ""}` })),
        ...otherLines.filter((o) => o.file_id === r.file_id && Math.abs(o.amount) === Math.abs(r.amount) && Math.abs(day(o.txn_date) - day(r.txn_date)) <= 7
            && ((kindOf.get(o.account_id) === "card") ? o.amount > 0 : o.amount < 0) !== (card.kind === "card" ? r.amount > 0 : r.amount < 0))
          .map((o) => ({ kind: "pair" as const, id: o.id, date: o.txn_date, label: `${fmt(o.txn_date)} · ${labelOfIdent(acctIdent.get(o.account_id))} · ${o.description}` })),
      ].filter((m, i, a) => a.findIndex((x) => x.kind === m.kind && x.id === m.id) === i);
    }
    return {
      id: r.id, fileId: r.file_id, locked: lockedFile.has(r.file_id), date: r.txn_date, description: r.description, cents, state,
      account: r.chart_account, tax: r.tax_code, memo: r.memo ?? "", source: r.source,
      split: r.is_split ? splitBy.get(r.id) ?? [] : null, transfer: transfer || null,
      entry: r.matched_entry ? { id: r.matched_entry, label: `Journal entry ${entryNo.get(r.matched_entry) ?? ""}`.trim() } : null,
      excluded: r.status === "excluded" ? { reason: r.excluded_reason, note: r.excluded_note } : null,
      suggestion: state === "review" ? suggest({ id: r.id, description: r.description, cents }, card.ident, card.kind, rules, history) : null,
      matches,
    };
  });
  return { cards, card, lines, accounts, taxes, defaultTax, banks, rules };
}
