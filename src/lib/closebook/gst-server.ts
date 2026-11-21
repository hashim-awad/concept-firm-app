import "server-only";
// Step 8, the GST/HST return (round 13): the items behind the return, read from the same inputs as the
// trial balance (coded bank and card lines, and entries with a sales tax code: expenses paid personally
// and the standard entries included), the year's periods, the returns as prepared, and the check
// against GST/HST payable (21500).
import type { SupabaseClient } from "@supabase/supabase-js";
import { gstInputs } from "./tb-build-server";
import { loadFile } from "./server";
import { bankLineItems, buildYearPrefilled, checkAgainstBooks, gstPeriods, itemsFromEntry, quickType, type EntryTaxLine, type Frequency, type GstItem, type GstPayment, type GstReturn, type Line, type QuickRate, type QuickSettings } from "./gst-return";

// The standard chart account the quick method gain is booked to (round 13 fix): 42400, GIFI 8230.
export const QUICK_GAIN = "42400";
// A return as kept when prepared: its lines and its sales before tax (for step 5's revenue check).
export const storedLines = (r: GstReturn) => ({ ...r.lines, sales: r.salesNetCents });

export type StoredReturn = { period_no: number; label: string; period_start: string; period_end: string; due_on: string; instalments: number; lines: Record<Line, number>;
  prepared_by: string | null; prepared_at: string; filed_on: string | null; confirmation: string };
export type GstCheckRow = { owing: number; book: number; diff: number; note: string; noted_by: string | null; accepted_by: string | null; accepted_at: string | null; accepted_why: string; instalment_entries?: string[] };

// Why a file has no return built here (A1, A2).
export function gstReason(file: { file_type: string; books: string; setup?: Record<string, unknown> | null }): string | null {
  const s = (file.setup ?? {}) as Record<string, unknown>;
  if (file.file_type !== "full") return "Monthly clients file their GST/HST return from QuickBooks.";
  if (!["statements", "paper"].includes(file.books)) return "Clients who keep their own books file their GST/HST return from their own software.";
  if (s.gst_registered !== true) return s.gst_registered === false ? "Not registered for GST/HST: no return." : "Answer the GST/HST questions in step 1.";
  if (s.gst_year_same === false) return "The GST/HST year is not the fiscal year. Ask the client to change the reporting period with CRA.";
  if (!s.gst_frequency) return "Answer the GST/HST filing frequency in step 1.";
  return null;
}
export const rtLabel = (rt: unknown) => { const t = String(rt ?? "RT0001").replace(/\s+/g, ""); return /^RT\d{4}$/.test(t) ? `RT ${t.slice(2)}` : "RT 0001"; };

// instalmentsCents: the amounts the preparer typed (when preparing); otherwise as prepared, else pre-filled.
export async function gstFor(supabase: SupabaseClient, fileId: string, instalmentsCents?: Map<number, number>) {
  const f = await loadFile(supabase, fileId);
  if (!f) return null;
  const setup = (f.file.setup ?? {}) as Record<string, unknown>;
  const reason = gstReason({ file_type: f.file.file_type, books: f.file.books, setup });
  if (reason) return { applies: false as const, reason };
  const inp = await gstInputs(supabase, fileId);
  if (!inp) return { applies: false as const, reason: "Clients who keep their own books file their GST/HST return from their own software." };
  const quick = setup.quick_method === true, freq = setup.gst_frequency as Frequency;
  // Round 20: the client's quick method rate (services when step 1 has no answer), from the approved rates.
  const type = quickType(setup.quick_method_type);
  const [{ data: set }, { data: rateRows }, { data: stored }, { data: chk }] = await Promise.all([
    supabase.from("cb_settings").select("gst_due_months_annual, gst_due_months_period, quick_credit_rate, quick_credit_limit").maybeSingle(),
    supabase.from("cb_quick_rates").select("province, services_rate, goods_rate, effective_from").eq("province", inp.province).eq("status", "approved"),
    supabase.from("cb_gst_returns").select("period_no, label, period_start, period_end, due_on, instalments, lines, prepared_by, prepared_at, filed_on, confirmation").eq("file_id", fileId).order("period_no"),
    supabase.from("cb_gst_check").select("owing, book, diff, note, noted_by, accepted_by, accepted_at, accepted_why, instalment_entries").eq("file_id", fileId).maybeSingle(),
  ]);
  const st = (set ?? {}) as { gst_due_months_annual?: number; gst_due_months_period?: number; quick_credit_rate?: number | null; quick_credit_limit?: number | null };
  const periods = gstPeriods(f.file.year_start, f.file.year_end, freq, { annual: st.gst_due_months_annual ?? 3, period: st.gst_due_months_period ?? 1 });
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rates: QuickRate[] = ((rateRows ?? []) as { province: string; services_rate: unknown; goods_rate: unknown; effective_from: string | null }[])
    .map((r) => ({ province: r.province, services: num(r.services_rate), goods: num(r.goods_rate), from: r.effective_from }));
  const q: QuickSettings = { rate: null, type, province: inp.province, rates,
    creditRate: st.quick_credit_rate != null ? Number(st.quick_credit_rate) : null, creditLimitCents: st.quick_credit_limit != null ? Math.round(Number(st.quick_credit_limit) * 100) : null };

  // The items: coded bank and card lines with a sales tax code, split as the trial balance splits them.
  const items: GstItem[] = [], payments: GstPayment[] = [];
  const bankKind = new Map(inp.banks.map((b) => [b.id, b.kind]));
  // Piece GST-SPLIT (Hashim, Nov 20, 2026): split lines count row by row (bankLineItems).
  for (const l of inp.lines) bankLineItems(l, bankKind.get(l.account_id) === "bank", inp.chart, inp.codes, inp.ctx, items, payments);
  // Entries with a sales tax code (expenses paid personally, the standard entries, adjusting entries), as
  // posted. An entry that moves an amount into 21500 without a tax code is an instalment candidate, for
  // the preparer to confirm or leave out (the quick method gain entry is not one).
  const acct = new Map(f.accounts.map((a) => [a.id, a]));
  const confirmed = new Set(((chk as { instalment_entries?: string[] } | null)?.instalment_entries ?? []));
  const candidates: (GstPayment & { confirmed: boolean })[] = [];
  let other21500 = 0;
  for (const e of f.entries) {
    const date = e.entry_date ?? f.file.year_end;
    const label = `${e.kind} ${e.number}${e.note ? `: ${e.note}` : ""}`;
    const lines: EntryTaxLine[] = e.lines.map((x) => {
      const a = acct.get(x.account_id);
      const chartNo = a?.account_key?.startsWith("chart:") ? a.account_key.slice(6) : "";
      const c = inp.chart.get(chartNo);
      return { cents: Math.round(Number(x.amount) * 100), code: x.tax_code ? inp.codes.get(x.tax_code) ?? null : null, codeName: x.tax_code ?? "",
        accountType: c?.account_type ?? "", account: chartNo, accountName: c?.name ?? a?.name ?? "", isTax: !!x.is_tax, on21500: chartNo === "21500" };
    });
    items.push(...itemsFromEntry({ date, ref: e.id, label }, lines.filter((l) => l.account), inp.ctx));
    const gain = lines.some((l) => l.account === QUICK_GAIN);
    const into = lines.filter((l) => l.on21500 && !l.isTax).reduce((n, l) => n + l.cents, 0);
    if (into && !gain) { candidates.push({ date, ref: e.id, label, cents: into, confirmed: confirmed.has(e.id) }); if (!confirmed.has(e.id)) other21500 += into; }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));

  // GST/HST payable (21500): last year's balance owing (step 2) and the balance at year end, owing positive.
  const opening = -inp.postings.filter((p) => p.key === "chart:21500" && p.kind === "opening").reduce((n, p) => n + p.cents, 0);
  const row = f.accounts.find((a) => a.account_key === "chart:21500");
  const entryTotal = f.entries.flatMap((e) => e.lines).filter((x) => x.account_id === row?.id).reduce((n, x) => n + Math.round(Number(x.amount) * 100), 0);
  const book = row ? -(Math.round(Number(row.this_year) * 100) + entryTotal) : 0;

  const prepared = ((stored ?? []) as StoredReturn[]).map((r) => ({ ...r, instalments: Number(r.instalments) }));
  const inYear = [...payments, ...candidates.filter((x) => x.confirmed)].filter((p) => p.date >= f.file.year_start && p.date <= f.file.year_end);
  // Instalments: typed now, else as prepared, else pre-filled (period by period).
  const typed = instalmentsCents ?? (prepared.length ? new Map(prepared.map((r) => [r.period_no, Math.round(r.instalments * 100)])) : undefined);
  const { returns, prefill: pre } = buildYearPrefilled(items, periods, quick, q, inYear, opening, typed);
  const check = checkAgainstBooks(opening, returns, inYear, book);
  const changed = returns.filter((r) => { const s = prepared.find((x) => x.period_no === r.period.n); return s && JSON.stringify(s.lines) !== JSON.stringify(storedLines(r)); }).map((r) => r.period.n);
  return {
    applies: true as const, quick, quickType: type, freq, rt: rtLabel(setup.gst_rt), province: inp.province, periods, returns, prepared, changed, items, payments, prefill: pre,
    check, checkRow: (chk ?? null) as GstCheckRow | null, other21500, candidates, gainAccount: QUICK_GAIN, quickSettings: q,
    fileName: f.client?.legal_name ?? "", yearEnd: f.file.year_end,
  };
}
export type GstData = NonNullable<Awaited<ReturnType<typeof gstFor>>>;
export type GstApplies = Extract<GstData, { applies: true }>;
