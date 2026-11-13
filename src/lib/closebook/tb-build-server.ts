// Rebuilds the trial balance of a bank-statement file from its coded lines (src/lib/closebook/tb-build.ts)
// and saves it. Called after every upload, removal, coding, undo and "Ask client". The reports read the
// same inputs live (livePostings), so they never depend on a stored copy.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLedger, type BuildBank, type BuildChart, type BuildLine, type BuildOpening } from "./tb-build";
import type { TaxCode, TaxContext, TaxPart } from "./sales-tax";
import { openingFrom, type CodeInfo } from "./opening";
import { gifiCodes } from "./gifi";
import { loadFile } from "./server";
import type { Line } from "./matching";

// The master line each GIFI code lands on: its ".00" line, else its first usable line; 3660 (retained
// earnings at the start) lands on 3600.00.
export async function gifiCodeInfo(supabase: SupabaseClient): Promise<{ info: Map<string, CodeInfo>; lines: Line[] }> {
  const { data } = await supabase.from("cb_master_lines").select("line_no, name, gifi_code, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, section, locked").order("sort_order");
  const lines = (data ?? []) as Line[];
  const info = new Map<string, CodeInfo>();
  for (const l of lines) {
    if (!l.mappable || l.locked) continue;
    const cur = info.get(l.gifi_code);
    if (!cur || l.line_no === `${l.gifi_code}.00`) info.set(l.gifi_code, { line_no: l.line_no, name: l.name, type: l.line_type });
  }
  const re = info.get("3600");
  if (re) info.set("3660", { ...re, name: "Retained earnings, start of year" });
  return { info, lines };
}

// Route 1: last year's Closebook file, carried over when this file has no opening balances yet.
async function carryFromLastYear(supabase: SupabaseClient, fileId: string, clientId: string, yearEnd: string, lines: Line[]): Promise<boolean> {
  const { data: prior } = await supabase.from("cb_files").select("id").eq("client_id", clientId).lt("year_end", yearEnd).order("year_end", { ascending: false }).limit(1).maybeSingle();
  if (!prior) return false;
  const p = await loadFile(supabase, prior.id as string);
  if (!p || !p.accounts.length) return false;
  const ent = new Map<string, number>();
  for (const e of p.entries) for (const l of e.lines) ent.set(l.account_id, (ent.get(l.account_id) ?? 0) + l.amount);
  const r = gifiCodes(p.accounts, ent, new Map(lines.map((l) => [l.line_no, l])));
  if (!r.codes.length) return false;
  const { error } = await supabase.rpc("cb_set_opening", { p_file: fileId, p_source: "closebook", p_codes: r.codes.map(([code, amount]) => ({ code, amount })), p_re_stated: r.totals["3849"] });
  return !error;
}

type FileRow = { id: string; books: string; setup: unknown; year_start: string; year_end: string; client_id: string; opening_re_stated: unknown; opening_ni_typed: unknown; client: unknown };
type Inputs = { banks: BuildBank[]; lines: BuildLine[]; chart: Map<string, BuildChart>; codes: Map<string, TaxCode>; ctx: TaxContext; opening: BuildOpening | null; yearStart: string; fileNumbers: Map<string, string> };
const cents = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100));

async function loadFileRow(supabase: SupabaseClient, fileId: string): Promise<FileRow | null> {
  const { data } = await supabase.from("cb_files").select("id, books, setup, year_start, year_end, client_id, opening_re_stated, opening_ni_typed, client:client_id(province)").eq("id", fileId).maybeSingle();
  return data as FileRow | null;
}

// Everything the build needs, read from the bank lines, statements, chart, tax codes and opening balances.
async function loadInputs(supabase: SupabaseClient, f: FileRow, carry: boolean): Promise<Inputs> {
  const fileId = f.id, yearEnd = f.year_end;
  const province = ((f.client as { province: string } | null)?.province ?? "ON");
  const setup = (f.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  const [{ data: banks }, { data: sts }, { data: lines }, { data: chart }, { data: codes }, { data: parts }] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, name, kind, chart_account, number").eq("file_id", fileId),
    supabase.from("cb_bank_statements").select("account_id, period_start, opening").eq("file_id", fileId).order("period_start"),
    supabase.from("cb_bank_lines").select("id, account_id, txn_date, description, amount, status, chart_account, tax_code").eq("file_id", fileId).order("txn_date").limit(50000),
    supabase.from("cb_chart_accounts").select("number, name, account_type, line_no").order("sort_order"),
    supabase.from("cb_sales_tax_codes").select("code, name, provinces"),
    supabase.from("cb_sales_tax_parts").select("code, name, rate, recoverable, liability, effective_from").lte("effective_from", yearEnd).order("effective_from"),
  ]);
  // Opening balances by GIFI code (BRIEF.md): last year's Closebook file first, else what was typed.
  const { info, lines: master } = await gifiCodeInfo(supabase);
  let { data: ob } = await supabase.from("cb_opening_balances").select("code, amount, chart_account, bank_account").eq("file_id", fileId);
  let reStated = cents(f.opening_re_stated);
  if (carry && !ob?.length && await carryFromLastYear(supabase, fileId, f.client_id, yearEnd, master)) {
    ob = (await supabase.from("cb_opening_balances").select("code, amount, chart_account, bank_account").eq("file_id", fileId)).data;
    const { data: again } = await supabase.from("cb_files").select("opening_re_stated").eq("id", fileId).maybeSingle();
    reStated = cents(again?.opening_re_stated);
  }
  let opening: BuildOpening | null = null;
  if (ob?.length) {
    const { opening: o } = openingFrom((ob as { code: string; amount: number }[]).map((x) => [x.code, Math.round(Number(x.amount) * 100)]), info, cents(f.opening_ni_typed));
    const chosen = new Map(((ob ?? []) as { code: string; chart_account: string | null; bank_account: string | null }[]).map((x) => [x.code, x]));
    opening = { lines: o.lines.map((l) => ({ ...l, account: chosen.get(l.code)?.chart_account ?? null, bank: chosen.get(l.code)?.bank_account ?? null })), reClosingCents: o.reClosingCents, reStatedCents: reStated };
  }
  // File accounts already numbered for GIFI lines with no standard chart account keep their numbers.
  const { data: own } = await supabase.from("cb_accounts").select("account_key, number").eq("file_id", fileId).like("account_key", "gifi:%");
  const fileNumbers = new Map<string, string>(((own ?? []) as { account_key: string; number: string }[]).filter((a) => /^\d{5}$/.test(a.number)).map((a) => [a.account_key.slice(5), a.number]));
  const firstOpening = new Map<string, number>();
  for (const s of (sts ?? []) as { account_id: string; opening: number }[]) if (!firstOpening.has(s.account_id)) firstOpening.set(s.account_id, Math.round(Number(s.opening) * 100));
  const latest = new Map<string, TaxPart & { code: string }>();
  for (const p of (parts ?? []) as (TaxPart & { code: string })[]) latest.set(`${p.code}|${p.name}`, { ...p, rate: Number(p.rate) });
  const codeMap = new Map<string, TaxCode>(((codes ?? []) as { code: string; name: string; provinces: string[] | null }[])
    .filter((c) => !c.provinces || c.provinces.includes(province))
    .map((c) => [c.code, { code: c.code, name: c.name, parts: [...latest.values()].filter((p) => p.code === c.code) }]));
  return {
    banks: ((banks ?? []) as { id: string; name: string; kind: "bank" | "card"; chart_account: string; number: string }[]).map((b) => ({ id: b.id, name: b.name, kind: b.kind, chart: b.chart_account, number: b.number, openingCents: firstOpening.get(b.id) ?? 0 })),
    lines: ((lines ?? []) as { id: string; account_id: string; txn_date: string; description: string; amount: number; status: string; chart_account: string | null; tax_code: string | null }[])
      .map((l) => ({ ...l, date: l.txn_date, cents: Math.round(Number(l.amount) * 100) })),
    chart: new Map<string, BuildChart>(((chart ?? []) as (BuildChart & { number: string })[]).map((c) => [c.number, c])),
    codes: codeMap, ctx: { registered: setup.gst_registered !== false, quick: setup.quick_method === true }, opening, yearStart: f.year_start, fileNumbers,
  };
}

const build = (i: Inputs) => buildLedger(i.banks, i.lines, i.chart, i.codes, i.ctx, i.opening, i.yearStart, i.fileNumbers);

export async function rebuildTb(supabase: SupabaseClient, fileId: string): Promise<string | null> {
  const f = await loadFileRow(supabase, fileId);
  if (!f || !["statements", "paper"].includes(f.books)) return null;
  const { rows } = build(await loadInputs(supabase, f, true));
  const { error } = await supabase.rpc("cb_build_tb", { p_file: fileId,
    p_rows: rows.map((r) => ({ key: r.key, number: r.number, name: r.name, line_no: r.line_no ?? "", amount: r.cents / 100, last: r.lastCents / 100, reviewer: r.reviewer ?? "" })) });
  return error ? `The trial balance could not be rebuilt: ${error.message}` : null;
}

// The postings of a bank-statement file, built live (no carry-over, no write).
export async function livePostings(supabase: SupabaseClient, fileId: string) {
  const f = await loadFileRow(supabase, fileId);
  if (!f || !["statements", "paper"].includes(f.books)) return null;
  return build(await loadInputs(supabase, f, false));
}
