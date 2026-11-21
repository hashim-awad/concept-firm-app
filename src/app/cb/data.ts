// CB2-1: what the Books pages share, read once per request.
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, type BooksData } from "@/lib/books/server";
import { fiscalStart, rangeInput, type RangeInput } from "@/lib/books/ledger";

export const getBooks = cache(async (clientId: string): Promise<BooksData | null> => loadBooks(await createClient(), clientId));

export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The client's current fiscal year (QBO's default report range): the year holding today; after the last year in
// Closebook, the last year; before the first, the first.
export function currentYear(b: BooksData): { from: string; to: string; asOf: string } {
  const today = todayIso();
  const ys = b.books.years;
  if (!ys.length) return { from: today.slice(0, 4) + "-01-01", to: today, asOf: today };
  const hold = ys.find((y) => y.yearStart <= today && today <= y.yearEnd);
  if (hold) return { from: hold.yearStart, to: hold.yearEnd, asOf: today };
  const last = ys[ys.length - 1], first = ys[0];
  const y = today > last.yearEnd ? last : first;
  return { from: y.yearStart, to: y.yearEnd, asOf: y.yearEnd };
}

// A report's date range from the address (from/to), else the current fiscal year.
export function rangeOf(b: BooksData, sp: { from?: string; to?: string }): { from: string; to: string } {
  const cur = currentYear(b);
  const from = isDate(sp.from) ? sp.from : cur.from;
  const to = isDate(sp.to) ? sp.to : cur.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function chartMap(b: BooksData) {
  return new Map([...b.byIdent].map(([k, a]) => [k, { number: a.number, name: a.name, line_no: a.line_no }]));
}
export function inputFor(b: BooksData, from: string, to: string): RangeInput {
  return rangeInput(b.books, from, to, b.typeOf, b.re, chartMap(b));
}
// The balance sheet is "as of" a date: retained earnings to the start of that fiscal year, then net income.
export function balanceSheetInput(b: BooksData, asOf: string): RangeInput {
  return inputFor(b, fiscalStart(b.books, asOf), asOf);
}
// Each account's balance on a date (debits positive), income closed at each year end.
export function balancesOn(b: BooksData, date: string): Map<string, number> {
  const out = new Map<string, number>();
  const r = balanceSheetInput(b, date);
  for (const p of r.postings) out.set(p.key, (out.get(p.key) ?? 0) + p.cents);
  return out;
}

export type BankCard = { ident: string; name: string; kind: "bank" | "card"; ids: string[] };
// The client's bank and card accounts, across its years, by account number (the latest year's name).
export const getBankAccounts = cache(async (clientId: string): Promise<BankCard[]> => {
  const b = await getBooks(clientId);
  if (!b || !b.files.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("cb_bank_accounts").select("id, file_id, name, kind, number, chart_account").in("file_id", b.files.map((f) => f.id));
  const order = new Map(b.files.map((f, i) => [f.id, i]));
  const by = new Map<string, BankCard & { at: number }>();
  for (const r of ((data ?? []) as { id: string; file_id: string; name: string; kind: "bank" | "card"; number: string | null; chart_account: string }[])
    .sort((x, y) => (order.get(x.file_id) ?? 0) - (order.get(y.file_id) ?? 0))) {
    const ident = r.number || r.chart_account;
    const cur = by.get(ident);
    by.set(ident, { ident, name: b.byIdent.get(ident)?.name ?? r.name, kind: r.kind, ids: [...(cur?.ids ?? []), r.id], at: order.get(r.file_id) ?? 0 });
  }
  return [...by.values()].map((x) => ({ ident: x.ident, name: x.name, kind: x.kind, ids: x.ids })).sort((x, y) => x.ident.localeCompare(y.ident, "en", { numeric: true }));
});

export const acctLabel = (a: { number: string; name: string }) => `${a.number ? `${a.number} ` : ""}${a.name}`;
