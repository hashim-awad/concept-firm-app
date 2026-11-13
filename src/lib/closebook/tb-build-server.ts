// Rebuilds the trial balance of a bank-statement file from its coded lines (src/lib/closebook/tb-build.ts)
// and saves it. Called after every upload, removal, coding, undo and "Ask client".
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTrialBalance, type BuildChart } from "./tb-build";
import type { TaxCode, TaxPart } from "./sales-tax";

export async function rebuildTb(supabase: SupabaseClient, fileId: string): Promise<string | null> {
  const { data: f } = await supabase.from("cb_files").select("id, books, setup, year_end, client:client_id(province)").eq("id", fileId).maybeSingle();
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
    chartMap, codeMap, { registered: setup.gst_registered !== false, quick: setup.quick_method === true },
  );
  const { error } = await supabase.rpc("cb_build_tb", { p_file: fileId,
    p_rows: rows.map((r) => ({ key: r.key, number: r.number, name: r.name, line_no: r.line_no ?? "", amount: r.cents / 100, reviewer: r.reviewer ?? "" })) });
  return error ? `The trial balance could not be rebuilt: ${error.message}` : null;
}
