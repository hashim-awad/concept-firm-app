import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// CB2-0 v7 (rule 7): the threshold columns are gone. What is left: the Note 1 wording, the instalment amount in the client
// email (CRA's figure) and the shareholder loan window.
export type CbSettings = { note1_policy: string; updated_at: string; instalment_threshold: number; sh_repay_window_days: number };
export const NOTE1: Record<string, string> = { amortization_equals_cca: "Amortization equal to capital cost allowance (tax basis)" };

export async function loadCbSettings(supabase: SupabaseClient): Promise<CbSettings | null> {
  const { data } = await supabase.from("cb_settings").select("note1_policy, updated_at, instalment_threshold, sh_repay_window_days").maybeSingle();
  if (!data) return null;
  const n = (v: unknown) => Number(v);
  return { ...(data as CbSettings), instalment_threshold: n(data.instalment_threshold ?? 3000), sh_repay_window_days: n(data.sh_repay_window_days ?? 30) };
}
