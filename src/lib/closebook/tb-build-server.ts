// Rebuilds the trial balance of a bank-statement file from its coded lines (src/lib/closebook/tb-build.ts)
// and saves it. Called after every upload, removal, coding, undo and "Ask client".
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTrialBalance, type BuildChart, type BuildOpening } from "./tb-build";
import type { TaxCode, TaxPart } from "./sales-tax";
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

export async function rebuildTb(supabase: SupabaseClient, fileId: string): Promise<string | null> {
  const { data: f } = await supabase.from("cb_files").select("id, books, setup, year_end, client_id, opening_re_stated, client:client_id(province)").eq("id", fileId).maybeSingle();
  if (!f || !["statements", "paper"].includes(f.books as string)) return null;
  const yearEnd = f.year_end as string;
  const province = ((f.client as unknown as { province: string } | null)?.province ?? "ON");
  const setup = (f.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  const [{ data: banks }, { data: sts }, { data: lines }, { data: chart }, { data: codes }, { data: parts }] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, name, kind, chart_account").eq("file_id", fileId),
    supabase.from("cb_bank_statements").select("account_id, period_start, opening").eq("file_id", fileId).order("period_start"),
    supabase.from("cb_bank_lines").select("account_id, amount, status, chart_account, tax_code").eq("file_id", fileId).limit(50000),
    supabase.from("cb_chart_accounts").select("number, name, account_type, line_no"),
    supabase.from("cb_sales_tax_codes").select("code, name, provinces"),
    supabase.from("cb_sales_tax_parts").select("code, name, rate, recoverable, liability, effective_from").lte("effective_from", yearEnd).order("effective_from"),
  ]);
  // Opening balances by GIFI code (BRIEF.md): last year's Closebook file first, else what was imported or typed.
  const { info, lines: master } = await gifiCodeInfo(supabase);
  let { data: ob } = await supabase.from("cb_opening_balances").select("code, amount").eq("file_id", fileId);
  let reStated = f.opening_re_stated === null || f.opening_re_stated === undefined ? null : Math.round(Number(f.opening_re_stated) * 100);
  if (!ob?.length && await carryFromLastYear(supabase, fileId, f.client_id as string, yearEnd, master)) {
    ob = (await supabase.from("cb_opening_balances").select("code, amount").eq("file_id", fileId)).data;
    const { data: again } = await supabase.from("cb_files").select("opening_re_stated").eq("id", fileId).maybeSingle();
    reStated = again?.opening_re_stated === null || again?.opening_re_stated === undefined ? null : Math.round(Number(again.opening_re_stated) * 100);
  }
  let opening: BuildOpening | null = null;
  if (ob?.length) {
    const { opening: o } = openingFrom((ob as { code: string; amount: number }[]).map((x) => [x.code, Math.round(Number(x.amount) * 100)]), info);
    opening = { lines: o.lines, reClosingCents: o.reClosingCents, reStatedCents: reStated };
  }
  const firstOpening = new Map<string, number>();
  for (const s of (sts ?? []) as { account_id: string; opening: number }[]) if (!firstOpening.has(s.account_id)) firstOpening.set(s.account_id, Math.round(Number(s.opening) * 100));
  const latest = new Map<string, TaxPart & { code: string }>();
  for (const p of (parts ?? []) as (TaxPart & { code: string })[]) latest.set(`${p.code}|${p.name}`, { ...p, rate: Number(p.rate) });
  const codeMap = new Map<string, TaxCode>(((codes ?? []) as { code: string; name: string; provinces: string[] | null }[])
    .filter((c) => !c.provinces || c.provinces.includes(province))
    .map((c) => [c.code, { code: c.code, name: c.name, parts: [...latest.values()].filter((p) => p.code === c.code) }]));
  const chartMap = new Map<string, BuildChart>(((chart ?? []) as (BuildChart & { number: string })[]).map((c) => [c.number, c]));
  const rows = buildTrialBalance(
    ((banks ?? []) as { id: string; name: string; kind: "bank" | "card"; chart_account: string }[]).map((b) => ({ id: b.id, name: b.name, kind: b.kind, chart: b.chart_account, openingCents: firstOpening.get(b.id) ?? 0 })),
    ((lines ?? []) as { account_id: string; amount: number; status: string; chart_account: string | null; tax_code: string | null }[]).map((l) => ({ ...l, cents: Math.round(Number(l.amount) * 100) })),
    chartMap, codeMap, { registered: setup.gst_registered !== false, quick: setup.quick_method === true }, opening,
  );
  const { error } = await supabase.rpc("cb_build_tb", { p_file: fileId,
    p_rows: rows.map((r) => ({ key: r.key, number: r.number, name: r.name, line_no: r.line_no ?? "", amount: r.cents / 100, last: r.lastCents / 100, reviewer: r.reviewer ?? "" })) });
  return error ? `The trial balance could not be rebuilt: ${error.message}` : null;
}
