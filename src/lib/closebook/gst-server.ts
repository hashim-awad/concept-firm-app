import "server-only";
// Step 8, the GST/HST return (round 13): the items behind the return, read from the same inputs as the
// trial balance (coded bank and card lines, and entries with a sales tax code: expenses paid personally
// and the standard entries included), the year's periods, the returns as prepared, and the check
// against GST/HST payable (21500).
import type { SupabaseClient } from "@supabase/supabase-js";
import { gstInputs } from "./tb-build-server";
import { loadFile } from "./server";
import { entryLineTax, splitLine } from "./sales-tax";
import { buildYearPrefilled, checkAgainstBooks, gstPeriods, type Frequency, type GstItem, type GstPayment, type Line } from "./gst-return";

export type StoredReturn = { period_no: number; label: string; period_start: string; period_end: string; due_on: string; instalments: number; lines: Record<Line, number>;
  prepared_by: string | null; prepared_at: string; filed_on: string | null; confirmation: string };
export type GstCheckRow = { owing: number; book: number; diff: number; note: string; noted_by: string | null; accepted_by: string | null; accepted_at: string | null; accepted_why: string };

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
  const [{ data: set }, { data: rate }, { data: stored }, { data: chk }] = await Promise.all([
    supabase.from("cb_settings").select("gst_due_months_annual, gst_due_months_period, quick_credit_rate, quick_credit_limit, entry_review_amount").maybeSingle(),
    supabase.from("cb_gst_quick_rates").select("rate").eq("province", inp.province).maybeSingle(),
    supabase.from("cb_gst_returns").select("period_no, label, period_start, period_end, due_on, instalments, lines, prepared_by, prepared_at, filed_on, confirmation").eq("file_id", fileId).order("period_no"),
    supabase.from("cb_gst_check").select("owing, book, diff, note, noted_by, accepted_by, accepted_at, accepted_why").eq("file_id", fileId).maybeSingle(),
  ]);
  const st = (set ?? {}) as { gst_due_months_annual?: number; gst_due_months_period?: number; quick_credit_rate?: number | null; quick_credit_limit?: number | null; entry_review_amount?: number };
  const periods = gstPeriods(f.file.year_start, f.file.year_end, freq, { annual: st.gst_due_months_annual ?? 3, period: st.gst_due_months_period ?? 1 });
  const q = { rate: (rate as { rate?: number } | null)?.rate != null ? Number((rate as { rate: number }).rate) : null,
    creditRate: st.quick_credit_rate != null ? Number(st.quick_credit_rate) : null, creditLimitCents: st.quick_credit_limit != null ? Math.round(Number(st.quick_credit_limit) * 100) : null };

  // The items: coded bank and card lines with a sales tax code, split as the trial balance splits them.
  const items: GstItem[] = [], payments: GstPayment[] = [];
  const bankKind = new Map(inp.banks.map((b) => [b.id, b.kind]));
  for (const l of inp.lines) {
    const c = l.status === "done" && l.chart_account ? inp.chart.get(l.chart_account) : undefined;
    if (!c) continue;
    const debit = bankKind.get(l.account_id) === "bank" ? l.cents : -l.cents;
    const ref = { date: l.date ?? "", source: "bank" as const, ref: l.id ?? "", label: l.description ?? "", account: l.chart_account!, accountName: c.name };
    if (l.chart_account === "21500") { payments.push({ date: ref.date, ref: ref.ref, label: ref.label, cents: -debit }); continue; }
    const code = l.tax_code ? inp.codes.get(l.tax_code) ?? null : null;
    if (!l.tax_code) continue;
    if (c.account_type === "Revenue") { const s = splitLine(debit, code, "sale", inp.ctx); items.push({ ...ref, code: l.tax_code, sale: true, netCents: s.netCents, taxCents: s.gstCollectedCents }); }
    else { const s = splitLine(-debit, code, "purchase", inp.ctx, c.account_type === "Asset"); items.push({ ...ref, code: l.tax_code, sale: false, netCents: s.netCents, taxCents: s.itcCents }); }
  }
  // Entries with a sales tax code (expenses paid personally, the standard entries, adjusting entries).
  const acct = new Map(f.accounts.map((a) => [a.id, a]));
  let other21500 = 0;
  for (const e of f.entries) {
    const date = e.entry_date ?? f.file.year_end;
    for (const x of e.lines) {
      const a = acct.get(x.account_id);
      const chartNo = a?.account_key?.startsWith("chart:") ? a.account_key.slice(6) : null;
      const cents = Math.round(Number(x.amount) * 100);
      if (chartNo === "21500" && !x.is_tax) { other21500 += cents; continue; }
      if (!x.tax_code || x.is_tax || !chartNo) continue;
      const c = inp.chart.get(chartNo);
      if (!c) continue;
      const t = entryLineTax(cents, inp.codes.get(x.tax_code) ?? null, c.account_type, inp.ctx);
      const ref = { date, source: "entry" as const, ref: e.id, label: `${e.kind} ${e.number}${x.memo ? `: ${x.memo}` : ""}`, account: chartNo, accountName: c.name, code: x.tax_code };
      if (c.account_type === "Revenue") items.push({ ...ref, sale: true, netCents: -cents, taxCents: -t.gstHst });
      else items.push({ ...ref, sale: false, netCents: cents, taxCents: t.gstHst });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));

  // GST/HST payable (21500): last year's balance owing (step 2) and the balance at year end, owing positive.
  const opening = -inp.postings.filter((p) => p.key === "chart:21500" && p.kind === "opening").reduce((n, p) => n + p.cents, 0);
  const row = f.accounts.find((a) => a.account_key === "chart:21500");
  const entryTotal = f.entries.flatMap((e) => e.lines).filter((x) => x.account_id === row?.id).reduce((n, x) => n + Math.round(Number(x.amount) * 100), 0);
  const book = row ? -(Math.round(Number(row.this_year) * 100) + entryTotal) : 0;

  const prepared = ((stored ?? []) as StoredReturn[]).map((r) => ({ ...r, instalments: Number(r.instalments) }));
  const inYear = payments.filter((p) => p.date >= f.file.year_start && p.date <= f.file.year_end);
  // Instalments: typed now, else as prepared, else pre-filled (period by period).
  const typed = instalmentsCents ?? (prepared.length ? new Map(prepared.map((r) => [r.period_no, Math.round(r.instalments * 100)])) : undefined);
  const { returns, prefill: pre } = buildYearPrefilled(items, periods, quick, q, inYear, opening, typed);
  const check = checkAgainstBooks(opening, returns, inYear, book);
  const changed = returns.filter((r) => { const s = prepared.find((x) => x.period_no === r.period.n); return s && JSON.stringify(s.lines) !== JSON.stringify(r.lines); }).map((r) => r.period.n);
  return {
    applies: true as const, quick, freq, rt: rtLabel(setup.gst_rt), province: inp.province, periods, returns, prepared, changed, items, payments, prefill: pre,
    check, checkRow: (chk ?? null) as GstCheckRow | null, other21500, threshold: Number(st.entry_review_amount ?? 5000), quickSettings: q,
    fileName: f.client?.legal_name ?? "", yearEnd: f.file.year_end,
  };
}
export type GstData = NonNullable<Awaited<ReturnType<typeof gstFor>>>;
export type GstApplies = Extract<GstData, { applies: true }>;
