import "server-only";
// Piece 4 (Hashim, Nov 18, 2026, version 2): what the Home office schedule reads. The province's ITC factor (Closebook
// rules › CRA rates), the client's GST/HST answers (step 1), the people linked to the client as shareholders and its
// business number (the GST/HST record), the schedule already saved with the entry, and last year's inputs for the
// grey hints. The standard accounts the entry posts to, as the entry form offers them on this file.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbFileRow } from "./files";
import type { CbAccount } from "./server";
import { defaultTaxCode } from "./sales-tax";
import { HOME_EXPENSE, ITC_ACCOUNT, SHAREHOLDER_ACCOUNT, readHomeInputs, upgradeHomeInputs, type HomeCtx, type HomeInputs } from "./home-office";

export type HomeStored = { id: string; entry_id: string; itc_claim: boolean; inputs: HomeInputs; snapshot: HomeSnapshot | null };
// What the schedule was calculated with, kept with it (the PDF prints from it).
export type HomeSnapshot = { province: string; regular: boolean; factor: HomeCtx["factor"]; taxCode: string | null; payee: { id: string; name: string } | null };
export type HomeData = {
  ctx: HomeCtx; stored: HomeStored | null; hints: HomeInputs | null; canItc: boolean;
  acct: Record<string, string>; names: Record<string, string>;
};

export async function loadHome(supabase: SupabaseClient, file: CbFileRow, province: string, accounts: CbAccount[], entryId: string | null, canItc: boolean,
  opts: { value: string; line_no: string }[]): Promise<HomeData> {
  const [{ data: factor }, { data: schedules }, { data: chart }, { data: prev }, { data: client }] = await Promise.all([
    supabase.from("cb_cra_itc_factors").select("numerator, denominator").eq("province", province).maybeSingle(),
    supabase.from("cb_schedules").select("id, entry_id, itc_claim, inputs, snapshot").eq("file_id", file.id).eq("kind", "home_office").order("created_at").order("id"),
    supabase.from("cb_chart_accounts").select("number, name, line_no"),
    supabase.from("cb_files").select("id").eq("client_id", file.client_id).lt("year_end", file.year_end).order("year_end", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("clients").select("business_number, signing_officer, signer_title").eq("id", file.client_id).maybeSingle(),
  ]);
  const setup = (file.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  const registered = setup.gst_registered !== false;
  const regular = registered && setup.quick_method !== true;
  // Piece 4: Paid to is the Signing officer with their Signer title, from the client record.
  const cl = (client ?? {}) as { signing_officer?: string; signer_title?: string };
  const payee = (cl.signing_officer ?? "").trim() ? { id: "signing-officer", name: [cl.signing_officer!.trim(), (cl.signer_title ?? "").trim()].filter(Boolean).join(", ") } : null;
  const bnMissing = registered && !((client as { business_number?: string } | null)?.business_number ?? "");
  const list = ((schedules ?? []) as HomeStored[]).map((s) => ({ ...s, inputs: readHomeInputs(s.inputs) }));
  const stored = entryId ? list.find((s) => s.entry_id === entryId) ?? null : null;

  // The entry form's account for each standard account the schedule posts to (a client's own books: their account on the line).
  const chartRows = (chart ?? []) as { number: string; name: string; line_no: string | null }[];
  const own = ["client_software", "bookkeeper"].includes(file.books);
  const byKey = new Map(accounts.map((a) => [a.account_key, a]));
  const acct: Record<string, string> = {}, names: Record<string, string> = {};
  for (const n of [HOME_EXPENSE, ITC_ACCOUNT, SHAREHOLDER_ACCOUNT]) {
    const c = chartRows.find((x) => x.number === n);
    names[n] = c?.name ?? n;
    acct[n] = !own ? byKey.get(`chart:${n}`)?.id ?? `chart:${n}` : opts.find((o) => o.line_no === c?.line_no)?.value ?? "";
  }

  // Last year's inputs: the same position (first with first).
  let hints: HomeInputs | null = null;
  if (prev) {
    const { data: last } = await supabase.from("cb_schedules").select("inputs").eq("file_id", (prev as { id: string }).id).eq("kind", "home_office").order("created_at").order("id");
    const row = ((last ?? []) as { inputs: unknown }[])[stored ? list.indexOf(stored) : list.length];
    if (row) hints = readHomeInputs(row.inputs);
  }
  const f = factor as { numerator: number; denominator: number } | null;
  const ctx: HomeCtx = { province, regular, factor: f ? { numerator: f.numerator, denominator: f.denominator } : null, taxCode: regular ? defaultTaxCode("GST/HST", province, HOME_EXPENSE) : null, payee, bnMissing };
  // Piece 4c: a schedule saved with the piece 4 rows shows in the new rows (read only; nothing is written back).
  return {
    ctx, stored: stored ? { ...stored, inputs: upgradeHomeInputs(stored.inputs, ctx) } : null, hints: hints ? upgradeHomeInputs(hints, ctx) : null, canItc, acct, names,
  };
}
