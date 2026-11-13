// Step 3, coding: everything the coding screen needs for one file (Hashim, Nov 13, 2026).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxCode, TaxPart } from "./sales-tax";
import { suggest, vendorKey, type Coding } from "./vendor";

export type ChartAccount = { number: string; name: string; account_type: string; tax_default: string; note: string };
export type CodeLine = {
  id: string; account_id: string; txn_date: string; description: string; amount: number; status: "new" | "done" | "ask_client" | "reviewer";
  chart_account: string | null; tax_code: string | null; reviewer_reason: string; source: string;
  suggestion: { account: string; tax: string | null; source: "rule" | "last_year" } | null; key: string;
};
export type CodingData = {
  chart: ChartAccount[]; codes: TaxCode[]; lines: CodeLine[]; province: string;
  setup: { gst_registered?: boolean; gst_frequency?: string; quick_method?: boolean; [k: string]: unknown };
  ruleKeys: string[]; error: string | null;
};

export async function loadCoding(supabase: SupabaseClient, fileId: string, clientId: string, yearEnd: string, province: string, setup: CodingData["setup"]): Promise<CodingData> {
  const [{ data: chart, error: e1 }, { data: codes }, { data: parts }, { data: rules }, { data: lines, error: e2 }, { data: older }] = await Promise.all([
    supabase.from("cb_chart_accounts").select("number, name, account_type, tax_default, note").order("sort_order"),
    supabase.from("cb_sales_tax_codes").select("code, name, provinces").order("sort_order"),
    supabase.from("cb_sales_tax_parts").select("code, name, rate, recoverable, liability, effective_from").lte("effective_from", yearEnd).order("effective_from"),
    supabase.from("cb_vendor_rules").select("vendor_key, chart_account, tax_code").eq("client_id", clientId),
    supabase.from("cb_bank_lines").select("id, account_id, txn_date, description, amount, status, chart_account, tax_code, reviewer_reason, source").eq("file_id", fileId).order("txn_date").order("row_no").limit(20000),
    // The client's earlier files: how each vendor was coded before.
    supabase.from("cb_bank_lines").select("description, chart_account, tax_code, coded_at, file:file_id!inner(client_id, year_end)").eq("status", "done").eq("file.client_id", clientId).lt("file.year_end", yearEnd).limit(20000),
  ]);
  // The latest rate for each part as at the year-end (a rate change is a new row with its start date).
  const latest = new Map<string, TaxPart & { code: string }>();
  for (const p of (parts ?? []) as (TaxPart & { code: string; effective_from: string })[]) latest.set(`${p.code}|${p.name}`, { ...p, rate: Number(p.rate) });
  const taxCodes: TaxCode[] = ((codes ?? []) as { code: string; name: string; provinces: string[] | null }[])
    .filter((c) => !c.provinces || c.provinces.includes(province))
    .map((c) => ({ code: c.code, name: c.name, parts: [...latest.values()].filter((p) => p.code === c.code).map(({ name, rate, recoverable, liability }) => ({ name, rate, recoverable, liability })) }));
  const ruleMap = new Map<string, Coding>(((rules ?? []) as { vendor_key: string; chart_account: string; tax_code: string | null }[]).map((r) => [r.vendor_key, { account: r.chart_account, tax: r.tax_code }]));
  const history = new Map<string, Coding>();
  for (const o of (older ?? []) as unknown as { description: string; chart_account: string; tax_code: string | null }[]) history.set(vendorKey(o.description), { account: o.chart_account, tax: o.tax_code });
  const out = ((lines ?? []) as Omit<CodeLine, "suggestion" | "key">[]).map((l) => ({
    ...l, amount: Number(l.amount), key: vendorKey(l.description),
    suggestion: l.status === "new" ? suggest(l.description, ruleMap, history) : null,
  }));
  const err = e1 ?? e2;
  return { chart: (chart ?? []) as ChartAccount[], codes: taxCodes, lines: out, province, setup, ruleKeys: [...ruleMap.keys()], error: err ? `Coding could not be read: ${err.message}` : null };
}
