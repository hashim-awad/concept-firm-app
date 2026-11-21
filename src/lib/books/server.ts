// CB2-1: a client's books, gathered live from its year files every time a Books page opens (nothing stored as a copy).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFile, loadReference, type CbEntry } from "@/lib/closebook/server";
import { loadReportData } from "@/lib/closebook/report-data";
import type { LineInfo, RepAccount } from "@/lib/closebook/reports";
import { buildBooks, identOf, type AcctType, type Books, type YearIn } from "./ledger";

export type BooksClient = { id: string; name: string; province: string; studio_client_id: string | null };
export type ChartAccount = { id: string; ident: string; number: string; name: string; account_type: AcctType; line_no: string | null; tax_code: string | null; active: boolean;
  source: string; merged_into: string | null };
export type BooksFile = { id: string; year_start: string; year_end: string; books: string; phase: string };
export type BooksEntry = CbEntry & { fileId: string; yearEnd: string; yearStart: string; no: string; date: string; locked: boolean };
export type BooksData = {
  client: BooksClient; files: BooksFile[]; books: Books; chart: ChartAccount[]; byIdent: Map<string, ChartAccount>;
  typeOf: (ident: string) => AcctType | undefined; re: string; info: (line_no: string | null) => LineInfo | null;
  entries: BooksEntry[]; lineName: Map<string, string>;
};

const TYPES: AcctType[] = ["Asset", "Liability", "Equity", "Revenue", "Expense"];
// An account's type when it has no GIFI line: the holding accounts are balance sheet accounts; otherwise QBO's number ranges.
export function typeByNumber(number: string, key = ""): AcctType {
  if (key === "opening") return "Equity";
  if (key === "uncoded") return "Asset";
  const d = number.charAt(0);
  return d === "1" ? "Asset" : d === "2" ? "Liability" : d === "3" ? "Equity" : d === "4" ? "Revenue" : d >= "5" && d <= "9" ? "Expense" : "Asset";
}

export async function listClients(supabase: SupabaseClient): Promise<BooksClient[]> {
  const { data } = await supabase.from("cb_clients").select("id, name, province, studio_client_id").order("name");
  return (data ?? []) as BooksClient[];
}

export async function loadChart(supabase: SupabaseClient, clientId: string): Promise<ChartAccount[]> {
  const { data } = await supabase.from("cb_client_accounts").select("id, number, name, account_type, line_no, tax_code, active, source, merged_into").eq("cb_client_id", clientId).limit(5000);
  return ((data ?? []) as Omit<ChartAccount, "ident">[]).map((a) => ({ ...a, ident: identOf(a) }));
}

// The client's books: every year file through today's engine, then one ledger (src/lib/books/ledger.ts).
export async function loadBooks(supabase: SupabaseClient, clientId: string): Promise<BooksData | null> {
  const { data: client } = await supabase.from("cb_clients").select("id, name, province, studio_client_id").eq("id", clientId).maybeSingle();
  if (!client) return null;
  const { data: fileRows } = await supabase.from("cb_files").select("id, year_start, year_end, books, phase").eq("cb_client_id", clientId).order("year_end");
  const files = (fileRows ?? []) as BooksFile[];
  const ref = await loadReference(supabase);
  const lineType = new Map(ref.lines.map((l) => [l.line_no, l.line_type]));
  const lineName = new Map(ref.lines.map((l) => [l.line_no, l.name]));
  const sheetName = new Map(ref.sheets.map((s) => [s.code, s.name]));
  const lineMap = new Map(ref.lines.map((l) => [l.line_no, l]));
  const info = (line_no: string | null): LineInfo | null => {
    const l = line_no ? lineMap.get(line_no) : undefined;
    return l ? { type: l.line_type, sheet: l.lead_sheet, sheetName: l.lead_sheet ? sheetName.get(l.lead_sheet) ?? "" : "" } : null;
  };
  const years: YearIn[] = [];
  const entries: BooksEntry[] = [];
  const syncRows: { number: string; name: string; type: AcctType; line_no: string | null }[] = [];
  for (const f of files) {
    const full = await loadFile(supabase, f.id, { books: true });
    if (!full) continue;
    const rd = await loadReportData(supabase, full.file, full.accounts, full.entries, ref.lines, ref.sheets);
    years.push({ fileId: f.id, yearStart: f.year_start, yearEnd: f.year_end, bankFile: rd.bankFile, accounts: rd.accounts, postings: rd.postings,
      entries: full.entries.map((e) => ({ id: e.id, origin: e.origin ?? null })) });
    const used = new Set(rd.postings.map((p) => p.key));
    for (const a of rd.accounts as RepAccount[]) {
      if (!used.has(a.key) && !a.lastCents) continue;
      const t = (lineType.get(a.line_no ?? "") as AcctType | undefined) ?? typeByNumber(a.number, a.key);
      syncRows.push({ number: a.number, name: a.name, type: TYPES.includes(t) ? t : "Asset", line_no: a.line_no });
    }
    for (const e of full.entries) {
      entries.push({ ...e, fileId: f.id, yearEnd: f.year_end, yearStart: f.year_start, locked: f.phase === "locked",
        no: e.journal_no ?? `${f.year_end.slice(0, 4)}-${String(e.seq).padStart(3, "0")}`, date: e.entry_date ?? f.year_end });
    }
  }
  // The client chart follows the year files: add what is missing, take the latest name of an account never renamed here.
  let chart = await loadChart(supabase, clientId);
  const have = new Map(chart.map((a) => [a.ident, a]));
  const latest = new Map<string, (typeof syncRows)[number]>();
  for (const r of syncRows) latest.set(identOf(r), r);
  const needed = [...latest.values()].filter((r) => {
    const a = have.get(identOf(r));
    return !a ? !chart.some((x) => x.merged_into && x.ident === identOf(r)) : a.source === "books" && (a.name !== r.name || a.account_type !== r.type || (a.line_no ?? null) !== (r.line_no ?? null));
  });
  if (needed.length) {
    await supabase.rpc("cb_books_sync_accounts", { p_client: clientId, p_rows: needed });
    chart = await loadChart(supabase, clientId);
  }
  const live = chart.filter((a) => !a.merged_into);
  const byIdent = new Map(live.map((a) => [a.ident, a]));
  const byId = new Map(chart.map((a) => [a.id, a]));
  // A merged account's postings land on the account it was merged into.
  const mergedTo = new Map<string, string>();
  for (const a of chart) {
    let t = a, n = 0;
    while (t.merged_into && n++ < 10) t = byId.get(t.merged_into) ?? t;
    if (t !== a) mergedTo.set(a.ident, t.ident);
  }
  const typeOf = (ident: string): AcctType | undefined => byIdent.get(ident)?.account_type ?? (ident.startsWith("name:") ? undefined : typeByNumber(ident));
  // Retained earnings: the account on GIFI line 3600 (31000 first).
  const reAcct = live.filter((a) => (a.line_no ?? "").startsWith("3600")).sort((a, b) => Number(b.number === "31000") - Number(a.number === "31000") || a.number.localeCompare(b.number))[0];
  const re = reAcct?.ident ?? "31000";
  const remap = (y: YearIn): YearIn => mergedTo.size ? {
    ...y, accounts: y.accounts.map((a) => { const t = mergedTo.get(identOf(a)); const c = t ? byIdent.get(t) : undefined; return c ? { ...a, number: c.number, name: c.name } : a; }),
  } : y;
  const books = buildBooks(years.map(remap), typeOf, re);
  return { client: client as BooksClient, files, books, chart, byIdent, typeOf, re, info, entries, lineName };
}
