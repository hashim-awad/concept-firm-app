import "server-only";
// Step 8, T2 tie-out (round 10, Hashim, Nov 27, 2026): everything the step shows and the export route
// writes, from the final trial balance (after entries) through the step 7 matches.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFile, loadReference } from "./server";
import { businessNumber, gifiCodes, gifiFile } from "./gifi";
import { gifiChecks, gifiFileName, taxWorkpaper, tieOut, type ExportKind, type Treatment, type WpAccount } from "./t2";
import { effectiveLine } from "./matching";
import { todayToronto } from "@/lib/dates";

export type GifiExportRow = { id: string; kind: ExportKind; file_name: string; created_by: string | null; created_at: string; fingerprint: string; totals: Record<string, number> };

export async function gifiFor(supabase: SupabaseClient, fileId: string) {
  const data = await loadFile(supabase, fileId);
  if (!data) return null;
  const ref = await loadReference(supabase);
  const entryTotals = new Map<string, number>();
  for (const e of data.entries) for (const l of e.lines) entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
  const byNo = new Map(ref.lines.map((l) => [l.line_no, l]));
  const result = gifiCodes(data.accounts, entryTotals, byNo);

  // Last year's closing retained earnings (step 2): what was stated there on a bank-statement file, else
  // the last-year column of the trial balance worked through the same GIFI rules. None: the check fails.
  const f = data.file as typeof data.file & { opening_re_stated?: number | null };
  let lastYearRe: number | null = f.opening_re_stated === null || f.opening_re_stated === undefined ? null : Number(f.opening_re_stated);
  if (lastYearRe === null && data.accounts.some((a) => Number(a.last_year) !== 0)) {
    lastYearRe = gifiCodes(data.accounts.map((a) => ({ ...a, this_year: Number(a.last_year), needs_reviewer: false })), new Map(), byNo).totals["3849"];
  }
  const checks = gifiChecks(result, lastYearRe);
  const c = data.client;
  const bn = businessNumber(c?.business_number);
  // Every reason the export is refused, by name: a failed check, or no Business Number.
  const refused = [...checks.filter((x) => !x.ok).map((x) => x.title)];
  if (!data.accounts.length) refused.unshift("Import the trial balance first.");
  if (!bn) refused.push("The client has no Business Number. Add it on the client record (Clients), then export.");

  // The tax workpaper: each account's final balance as GIFI shows it, with its tax code (the account's,
  // else its GIFI line's default).
  const [{ data: codes }, { data: treat }, { data: book }, { data: exps }, { data: tie }] = await Promise.all([
    supabase.from("cb_tax_codes").select("code, name, schedule1_effect"),
    supabase.from("cb_review_treatments").select("line_no, treatment").eq("client_id", data.file.client_id),
    supabase.from("cb_client_tax_settings").select("book_amortization").eq("client_id", data.file.client_id).maybeSingle(),
    supabase.from("cb_gifi_exports").select("id, kind, file_name, created_by, created_at, fingerprint, totals").eq("file_id", fileId).order("created_at", { ascending: false }),
    supabase.from("cb_t2_tieouts").select("net_income, total_assets, cca, income_tax, t2_pdf, accepted, entered_by, entered_at").eq("file_id", fileId).maybeSingle(),
  ]);
  const wpAccounts: WpAccount[] = [];
  let amort = 0, inctax = 0;
  for (const a of data.accounts) {
    const fin = Math.round((Number(a.this_year) + (entryTotals.get(a.id) ?? 0)) * 100) / 100;
    if (!fin || !a.line_no) continue;
    const eff = effectiveLine(a.line_no, fin, byNo);
    const l = eff ? byNo.get(eff) : undefined;
    if (!l) continue;
    const code = a.tax_code ?? l.default_tax_code ?? "FULL";
    // Expenses as debits, revenue as credits: both positive, as GIFI shows them.
    const amount = l.line_type === "Revenue" ? -fin : fin;
    if (code === "AMORT") amort += fin;
    if (code === "INCTAX") inctax += fin;
    wpAccounts.push({ label: `${a.number ? `${a.number} ` : ""}${a.name}`, line_no: l.line_no, gifi: l.gifi_code, lineType: l.line_type, code, amount });
  }
  const workpaper = taxWorkpaper(wpAccounts, new Map(((codes ?? []) as { code: string; name: string; schedule1_effect: string }[]).map((x) => [x.code, { name: x.name, rule: x.schedule1_effect }])),
    new Map(((treat ?? []) as { line_no: string; treatment: Treatment }[]).map((x) => [x.line_no, x.treatment])));
  const totals = { ...result.totals, amort: Math.round(amort * 100) / 100, inctax: Math.round(inctax * 100) / 100 };

  const header = { bn: bn ?? "", legalName: c?.legal_name ?? "", address: c?.street_address ?? "", city: c?.city ?? "", province: c?.province === "OTHER" ? "" : c?.province ?? "",
    postal: c?.postal_code ?? "", yearEnd: data.file.year_end, created: todayToronto() };
  const exports = (exps ?? []) as GifiExportRow[];
  // Stale: the trial balance changed after the final export (the database compares the fingerprints).
  const { data: st } = await supabase.rpc("cb_t2_status", { p_file: fileId });
  const final = exports.find((e) => e.kind === "final") ?? null;
  const stale = !!(st as { stale?: boolean } | null)?.stale;
  type Tie = { net_income: number | null; total_assets: number | null; cca: number | null; income_tax: number | null; t2_pdf: string | null; accepted: Record<string, { diff: number; by: string; at: string; reason: string }>; entered_by: string | null; entered_at: string };
  const t = tie as Tie | null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const bookAmortization = !!(book as { book_amortization?: boolean } | null)?.book_amortization;
  const tieItems = final ? tieOut({ ni: Number(final.totals["9999"] ?? 0), assets: Number(final.totals["2599"] ?? 0), amort: Number(final.totals.amort ?? 0), tax: Number(final.totals.inctax ?? 0) },
    { ni: n(t?.net_income), assets: n(t?.total_assets), cca: n(t?.cca), tax: n(t?.income_tax) }, t?.accepted ?? {}, bookAmortization) : [];
  const names = new Map(ref.lines.map((l) => [l.gifi_code, l.line_no.endsWith(".00") ? l.name : undefined]).filter(([, nm]) => nm) as [string, string][]);
  names.set("3660", "Retained earnings/deficit – Start");
  return {
    ...result, checks, refused, bn, lastYearRe, names, totals, workpaper, exports, final, stale, tie: t, tieItems, bookAmortization,
    reviewLines: [...new Set(wpAccounts.filter((a) => a.code === "REVIEW").map((a) => a.line_no))],
    treatments: new Map(((treat ?? []) as { line_no: string; treatment: Treatment }[]).map((x) => [x.line_no, x.treatment])),
    tjes: data.entries.filter((e) => e.kind === "TJE").length,
    file: () => gifiFile(header, result.codes), fileName: (kind: ExportKind) => gifiFileName(c?.legal_name ?? "Client", data.file.year_end, kind),
  };
}
