import { optForChart } from "./entry-form";
import "server-only";
// Piece 4b (Hashim, Nov 18, 2026, version 2): what the Expenses paid personally schedule reads. The province's ITC factor
// (Closebook rules › CRA rates), the client's GST/HST answers (step 1), the client record's Signing officer and business
// number (the GST/HST record), the schedule already saved with the entry, the expense accounts the entry form offers with
// each one's sales tax treatment, and the accounts the entry posts to (21500, 23000). No last-year hints.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbFileRow } from "./files";
import type { CbAccount } from "./server";
import type { AcctOpt } from "./entry-form";
import { defaultTaxCode } from "./sales-tax";
import { ITC_ACCOUNT, SHAREHOLDER_ACCOUNT, readExpInputs, type ExpAcct, type ExpCtx, type ExpInputs } from "./expenses-schedule";

export type ExpStored = { id: string; entry_id: string; itc_claim: boolean; inputs: ExpInputs; snapshot: ExpSnapshot | null };
// What the schedule was calculated with, kept with it (the PDF prints from it).
export type ExpSnapshot = Omit<ExpCtx, "bnMissing">;
export type ExpData = { ctx: ExpCtx; stored: ExpStored | null; canItc: boolean; acct: Record<string, string>; options: AcctOpt[] };

const TAX: Record<string, ExpAcct["tax"]> = { "GST/HST": "taxable", None: "none", Exempt: "none", Check: "check" };

export async function loadExpensesSchedule(supabase: SupabaseClient, file: CbFileRow, province: string, accounts: CbAccount[], entryId: string | null, canItc: boolean,
  opts: AcctOpt[]): Promise<ExpData> {
  const [{ data: factor }, { data: schedules }, { data: chart }, { data: master }, { data: client }] = await Promise.all([
    supabase.from("cb_cra_itc_factors").select("numerator, denominator").eq("province", province).maybeSingle(),
    supabase.from("cb_schedules").select("id, entry_id, itc_claim, inputs, snapshot").eq("file_id", file.id).eq("kind", "expenses"),
    supabase.from("cb_chart_accounts").select("number, line_no, tax_default").order("sort_order"),
    supabase.from("cb_master_lines").select("line_no, default_tax_code"),
    supabase.from("clients").select("business_number, signing_officer, signer_title").eq("id", file.client_id).maybeSingle(),
  ]);
  const setup = (file.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  const registered = setup.gst_registered !== false;
  const regular = registered && setup.quick_method !== true;
  const cl = (client ?? {}) as { signing_officer?: string; signer_title?: string; business_number?: string };
  const payee = (cl.signing_officer ?? "").trim() ? { id: "signing-officer", name: [cl.signing_officer!.trim(), (cl.signer_title ?? "").trim()].filter(Boolean).join(", ") } : null;
  const bnMissing = registered && !(cl.business_number ?? "");
  const stored = entryId ? (((schedules ?? []) as ExpStored[]).find((s) => s.entry_id === entryId) ?? null) : null;

  // Expense accounts only (no bank, no shareholder accounts: those are not expenses). The sales tax treatment is the
  // standard chart account's; a client's own account takes the standard account on its GIFI line.
  const charts = (chart ?? []) as { number: string; line_no: string | null; tax_default: string }[];
  const mealsLine = new Set(((master ?? []) as { line_no: string; default_tax_code: string | null }[]).filter((m) => m.default_tax_code === "M50").map((m) => m.line_no));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const options = opts.filter((o) => o.type === "Expense");
  const accts: Record<string, ExpAcct> = {};
  for (const o of options) {
    const key = o.value.startsWith("chart:") ? o.value : byId.get(o.value)?.account_key ?? "";
    const c = key.startsWith("chart:") ? charts.find((x) => x.number === key.slice(6)) : charts.find((x) => x.line_no === o.line_no);
    accts[o.value] = { label: o.label, tax: c ? TAX[c.tax_default] ?? "check" : "check", meals: mealsLine.has(o.line_no) };
  }
  // The entry form's account for 21500 and 23000 (a client's own books: their account on the same GIFI line).
  const own = !["statements", "paper"].includes(file.books);   // piece R2 (D12a): every trial balance file
  const byKey = new Map(accounts.map((a) => [a.account_key, a]));
  const acct: Record<string, string> = {};
  for (const n of [ITC_ACCOUNT, SHAREHOLDER_ACCOUNT]) {
    acct[n] = !own ? byKey.get(`chart:${n}`)?.id ?? `chart:${n}` : optForChart(opts, n)   /* piece R2 (D12b): by master account, never the first on the line */;
  }
  // A standard account picked before it was on the file ("chart:65000") is on the file once the entry is saved: the
  // reopened schedule shows it as the file's account.
  const alias = new Map(options.filter((o) => !o.value.startsWith("chart:")).map((o) => [byId.get(o.value)?.account_key ?? "", o.value]).filter(([k]) => k.startsWith("chart:")) as [string, string][]);
  const asOption = (v: string | null) => (v && !accts[v] ? alias.get(v) ?? v : v);
  const f = factor as { numerator: number; denominator: number } | null;
  if (stored) { const inp = readExpInputs(stored.inputs); stored.inputs = { ...inp, lines: inp.lines.map((l) => ({ ...l, acct: asOption(l.acct) })) }; }
  return {
    ctx: {
      province, regular, factor: f ? { numerator: f.numerator, denominator: f.denominator } : null,
      taxCode: regular ? defaultTaxCode("GST/HST", province, "") : null, mealsCode: regular ? defaultTaxCode("GST/HST", province, "60200") : null,
      accts, payee, bnMissing,
    },
    stored, canItc, acct, options,
  };
}
