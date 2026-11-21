// CB2-1 Part 4.1: every Books report gives the same figures as today's reports, for every year file of a client: the
// trial balance by account (Final), the balance sheet and the profit and loss. Today's figures come from the same engine
// read the old way (src/lib/closebook/report-data.ts, per file); Books reads the client's continuous ledger.
//   node --import ./scripts/answer-keys/register.mjs scripts/books/parity.ts        every local client (dummy data)
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFile, loadReference } from "../../src/lib/closebook/server.ts";
import { loadReportData } from "../../src/lib/closebook/report-data.ts";
import { statements, trialBalance } from "../../src/lib/closebook/reports.ts";
import { loadBooks } from "../../src/lib/books/server.ts";
import { identOf, rangeInput } from "../../src/lib/books/ledger.ts";
import { isShareholderLine, overviewFigures } from "../../src/lib/books/overview.ts";

const money = (c: number) => (c / 100).toFixed(2);

export async function checkBooks(sb: SupabaseClient, cbClientId: string): Promise<{ years: number; fails: string[] }> {
  const b = await loadBooks(sb, cbClientId);
  if (!b) return { years: 0, fails: ["the client did not load"] };
  const ref = await loadReference(sb);
  const chart = new Map([...b.byIdent].map(([k, a]) => [k, { number: a.number, name: a.name, line_no: a.line_no }]));
  const fails: string[] = [];
  for (const f of b.files) {
    const full = await loadFile(sb, f.id);
    if (!full) { fails.push(`${f.year_end}: did not load`); continue; }
    const rd = await loadReportData(sb, full.file, full.accounts, full.entries, ref.lines, ref.sheets);
    // Today: the trial balance by account, by the account's identity in the books.
    const todayTb = trialBalance(rd.accounts, rd.postings);
    const today = new Map<string, number>();
    const dir = new Map(rd.accounts.map((a) => [a.key, a]));
    for (const t of todayTb) { const a = dir.get(t.key); const k = a ? identOf(a) : t.key; if (t.key !== "ni-last") today.set(k, (today.get(k) ?? 0) + t.final); }
    const input = rangeInput(b.books, f.year_start, f.year_end, b.typeOf, b.re, chart);
    const booksTb = trialBalance(input.accounts, input.postings);
    const books = new Map<string, number>();
    for (const t of booksTb) if (t.key !== "ni-last") books.set(t.key, (books.get(t.key) ?? 0) + t.final);
    for (const k of new Set([...today.keys(), ...books.keys()])) {
      const x = today.get(k) ?? 0, y = books.get(k) ?? 0;
      if (x !== y) fails.push(`${f.year_end} trial balance ${k}: today ${money(x)}, Books ${money(y)}`);
    }
    const s1 = statements(todayTb, rd.info), s2 = statements(booksTb, b.info);
    const pairs: [string, number, number][] = [
      ["total assets", s1.bs.assets.now, s2.bs.assets.now], ["total liabilities", s1.bs.liabilities.now, s2.bs.liabilities.now],
      ["total equity", s1.bs.equity.now, s2.bs.equity.now], ["total liabilities and equity", s1.bs.totalLE.now, s2.bs.totalLE.now],
      ["total revenue", s1.pl.revenue.now, s2.pl.revenue.now], ["total expenses", s1.pl.expenses.now, s2.pl.expenses.now], ["net income", s1.pl.net.now, s2.pl.net.now],
    ];
    for (const [what, x, y] of pairs) if (x !== y) fails.push(`${f.year_end} ${what}: today ${money(x)}, Books ${money(y)}`);
    // PR C item 5: the Overview's cash and shareholder figures equal the balance sheet's.
    const lineOf = new Map(input.accounts.map((a) => [a.key, a.line_no]));
    const ov = overviewFigures(books, (k) => lineOf.get(k));
    const bsCash = s2.bs.assets.groups.filter((g) => g.name === "Cash and bank").reduce((n, g) => n + g.now, 0);
    const accts = (sec: typeof s2.bs.assets) => sec.groups.flatMap((g) => g.accounts).filter((a) => isShareholderLine(a.line_no)).reduce((n, a) => n + a.now, 0);
    const bsSh = accts(s2.bs.liabilities) - accts(s2.bs.assets);
    if (ov.cash !== bsCash) fails.push(`${f.year_end} Overview cash ${money(ov.cash)}, balance sheet cash and bank ${money(bsCash)}`);
    if (ov.shareholder !== bsSh) fails.push(`${f.year_end} Overview due to (from) shareholder ${money(ov.shareholder)}, balance sheet ${money(bsSh)}`);
  }
  return { years: b.files.length, fails };
}

// Part 4.3: the first year's opening balances are one ordinary journal entry, worked out from the stored figures. Until the
// switch-over they are view-only in Books (Hashim, Nov 21, 2026): Books refuses to save one.
export async function saveOpeningAsEntry(sb: SupabaseClient, cbClientId: string): Promise<{ fails: string[]; note: string }> {
  const b = await loadBooks(sb, cbClientId);
  if (!b) return { fails: ["the client did not load"], note: "" };
  const gen = b.books.generated.find((g) => g.origin === "opening_balances");
  if (!gen) return { fails: [], note: "no opening balances to show" };
  const lines = gen.lines.map((l) => ({ account: b.byIdent.get(l.ident)?.id, amount: l.cents / 100, memo: "" }));
  if (lines.some((l) => !l.account)) return { fails: [`opening balances: an account is not in the client chart (${gen.lines.filter((l) => !b.byIdent.has(l.ident)).map((l) => l.ident).join(", ")})`], note: "" };
  const { error } = await sb.rpc("cb_books_save_entry", { p_client: cbClientId, p_entry: null, p_date: gen.date, p_journal_no: "", p_reclass: false,
    p_memo: gen.memo, p_lines: lines, p_attachments: [], p_origin: "opening_balances" });
  const refused = error?.message === "Change this entry in the old Closebook until the switch-over.";
  return { fails: refused ? [] : [`the opening balances entry was not refused in Books: ${error?.message ?? "it saved"}`],
    note: `opening balances: one journal entry (${gen.lines.length} lines, ${gen.date}), view-only until the switch-over` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { signIn } = await import("../answer-keys/compute.ts");
  const sb = await signIn();
  const { data } = await sb.from("cb_clients").select("id, name").order("name");
  let bad = 0, years = 0;
  for (const c of (data ?? []) as { id: string; name: string }[]) {
    const r = await checkBooks(sb, c.id);
    years += r.years;
    if (r.fails.length) { bad++; console.log(`${c.id}: ${r.fails.length} difference${r.fails.length === 1 ? "" : "s"}`); for (const l of r.fails.slice(0, 8)) console.log(`  ${l}`); }
  }
  console.log(`${(data ?? []).length} clients, ${years} years: ${bad ? `${bad} with differences` : "every report equals today's"}`);
  process.exit(bad ? 1 : 0);
}
