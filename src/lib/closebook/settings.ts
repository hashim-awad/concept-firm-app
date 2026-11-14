import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CbSettings = { recon_outstanding_max: number; flag_amount: number; flag_percent: number; entry_review_amount: number; capital_invoice_amount: number; note1_policy: string; updated_at: string; t2_rounding: number };
export const NOTE1: Record<string, string> = { amortization_equals_cca: "Amortization equal to capital cost allowance (tax basis)" };

export async function loadCbSettings(supabase: SupabaseClient): Promise<CbSettings | null> {
  const { data } = await supabase.from("cb_settings").select("recon_outstanding_max, flag_amount, flag_percent, entry_review_amount, capital_invoice_amount, note1_policy, updated_at, t2_rounding").maybeSingle();
  if (!data) return null;
  const n = (v: unknown) => Number(v);
  return { ...(data as CbSettings), recon_outstanding_max: n(data.recon_outstanding_max), flag_amount: n(data.flag_amount), flag_percent: n(data.flag_percent),
    entry_review_amount: n(data.entry_review_amount), capital_invoice_amount: n(data.capital_invoice_amount), t2_rounding: n(data.t2_rounding ?? 5) };
}
