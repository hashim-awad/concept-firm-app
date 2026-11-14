// Step 5, the entry form's choices (round 2 items 2 and 11): the accounts it offers, the sales tax codes
// for the client's province, the GST/HST answers, the standard entries resolved to this file's accounts,
// and the next entry number. The page and the save action read the same, so the server rebuilds exactly
// what the form showed, from its own tax rates.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AcctOpt, StdOpt, StdSide } from "./entry-form";
import { defaultTaxCode, type TaxCode, type TaxContext, type TaxPart } from "./sales-tax";
import type { CbFileRow } from "./files";

export type EntryFormData = { opts: AcctOpt[]; gifiLines: [string, string, string][]; codes: TaxCode[]; ctx: TaxContext; standard: StdOpt[]; threshold: number; nextNo: string };

export async function loadTaxCodes(supabase: SupabaseClient, province: string, yearEnd: string): Promise<TaxCode[]> {
  const [{ data: codes }, { data: parts }] = await Promise.all([
    supabase.from("cb_sales_tax_codes").select("code, name, provinces").order("sort_order"),
    supabase.from("cb_sales_tax_parts").select("code, name, rate, recoverable, liability, effective_from").lte("effective_from", yearEnd).order("effective_from"),
  ]);
  const latest = new Map<string, TaxPart & { code: string }>();
  for (const p of (parts ?? []) as (TaxPart & { code: string })[]) latest.set(`${p.code}|${p.name}`, { ...p, rate: Number(p.rate) });
  return ((codes ?? []) as { code: string; name: string; provinces: string[] | null }[])
    .filter((c) => !c.provinces || c.provinces.includes(province))
    .map((c) => ({ code: c.code, name: c.name, parts: [...latest.values()].filter((p) => p.code === c.code).map(({ name, rate, recoverable, liability }) => ({ name, rate, recoverable, liability })) }));
}

export async function loadEntryForm(supabase: SupabaseClient, file: CbFileRow, province: string, clientName: string): Promise<EntryFormData> {
  const own = ["client_software", "bookkeeper"].includes(file.books);
  const [{ data: accts }, { data: chart }, { data: master }, { data: std }, { data: thr }, { data: last }, codes] = await Promise.all([
    supabase.from("cb_accounts").select("id, account_key, number, name, line_no, client_new").eq("file_id", file.id).order("number").order("name"),
    supabase.from("cb_chart_accounts").select("number, name, account_type, line_no").order("sort_order"),
    supabase.from("cb_master_lines").select("line_no, name, line_type, mappable, locked").order("sort_order"),
    // Round 9: "Expenses paid personally" has its own lines and its own form; the picker offers the simple ones.
    supabase.from("cb_standard_entries").select("id, name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, tax_mode").eq("style", "simple").order("sort_order"),
    supabase.from("cb_settings").select("entry_review_amount").maybeSingle(),
    supabase.from("cb_entries").select("seq").eq("file_id", file.id).order("seq", { ascending: false }).limit(1).maybeSingle(),
    loadTaxCodes(supabase, province, file.year_end),
  ]);
  type Acc = { id: string; account_key: string; number: string; name: string; line_no: string | null; client_new: boolean };
  type Ch = { number: string; name: string; account_type: string; line_no: string | null };
  type Ml = { line_no: string; name: string; line_type: string; mappable: boolean; locked: boolean };
  const charts = (chart ?? []) as Ch[], lines = (master ?? []) as Ml[], accounts = ((accts ?? []) as Acc[]).filter((a) => (a.line_no || a.account_key === "chart:10900") && !["opening", "uncoded"].includes(a.account_key));
  const typeOfLine = new Map(lines.map((l) => [l.line_no, l.line_type]));
  const chartOf = new Map(charts.map((c) => [c.number, c]));
  const opts: AcctOpt[] = [];
  // The client's own accounts (or this file's), then on bank-statement files the rest of the standard
  // chart, then GIFI lines that have no chart account.
  const clientAccounts = accounts.filter((a) => !a.account_key.startsWith("line:") && !a.account_key.startsWith("gifi:") && (a.number || a.client_new));
  for (const a of own ? clientAccounts : accounts) {
    const ch = a.account_key.startsWith("chart:") ? chartOf.get(a.account_key.slice(6)) : undefined;
    opts.push({ value: a.id, label: `${a.number ? `${a.number} ` : ""}${a.name}${a.client_new ? " (new)" : ""}`, type: ch?.account_type ?? typeOfLine.get(a.line_no ?? "") ?? "", line_no: a.line_no ?? "",
      group: own ? `${clientName}'s accounts` : "This file's accounts" });
  }
  if (!own) {
    const inFile = new Set(accounts.map((a) => a.account_key));
    for (const c of charts) if (!inFile.has(`chart:${c.number}`)) opts.push({ value: `chart:${c.number}`, label: `${c.number} ${c.name}`, type: c.account_type, line_no: c.line_no ?? "", group: "Standard chart" });
    const onChart = new Set(charts.map((c) => c.line_no));
    for (const l of lines) if (l.mappable && !l.locked && !onChart.has(l.line_no) && !inFile.has(`line:${l.line_no}`))
      opts.push({ value: `line:${l.line_no}`, label: `GIFI ${l.line_no.replace(/\.00$/, "")} ${l.name}`, type: l.line_type, line_no: l.line_no, group: "GIFI line with no chart account" });
  }
  // A standard entry's side: on a bank-statement file the chart account; on a client who keeps their own
  // books, their account on the same GIFI line, else nothing chosen and a plain note (item 2).
  const side = (number: string): StdSide => {
    const c = chartOf.get(number)!;
    const g = (c.line_no ?? "").replace(/\.00$/, "");
    if (!own) {
      const a = accounts.find((x) => x.account_key === `chart:${number}`);
      return { value: a?.id ?? `chart:${number}`, chart: number, label: `${number} ${c.name}`, line_no: c.line_no ?? "", missing: "" };
    }
    const a = clientAccounts.find((x) => x.line_no === c.line_no && !x.client_new) ?? clientAccounts.find((x) => x.line_no === c.line_no);
    return { value: a?.id ?? "", chart: number, label: `${number} ${c.name}`, line_no: c.line_no ?? "",
      missing: a ? "" : `${clientName} has no account on GIFI ${g} (${c.name}): choose one of their accounts, or a new account.` };
  };
  // The debit's sales tax, for this client's province (round 3 item 1): never a code set at firm level.
  const taxFor = (mode: string, account: string) => (mode === "taxable" ? defaultTaxCode("GST/HST", province, account) ?? "" : mode === "none" ? "none" : "");
  const standard = ((std ?? []) as { id: string; name: string; kind: string; reason: string; debit_account: string; credit_account: string; memo: string; wp_ref: string; reverse_next_year: boolean; tax_mode: string }[])
    .filter((x) => chartOf.has(x.debit_account) && chartOf.has(x.credit_account))
    .map((x) => ({ id: x.id, name: x.name, kind: x.kind, reason: x.reason, memo: x.memo, wp_ref: x.wp_ref, reverse: x.reverse_next_year, debit: side(x.debit_account), credit: side(x.credit_account),
      tax: taxFor(x.tax_mode, x.debit_account), taxMode: x.tax_mode }));
  const setup = (file.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  const seq = ((last as { seq: number } | null)?.seq ?? 0) + 1;
  return {
    opts, codes, standard, threshold: Number((thr as { entry_review_amount: number } | null)?.entry_review_amount ?? 0),
    gifiLines: lines.filter((l) => l.mappable && !l.locked).map((l) => [l.line_no, l.name, l.line_type]),
    ctx: { registered: setup.gst_registered !== false, quick: setup.quick_method === true },
    nextNo: `${file.year_end.slice(0, 4)}-${String(seq).padStart(3, "0")}`,
  };
}
