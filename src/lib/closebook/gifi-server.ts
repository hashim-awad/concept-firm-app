import "server-only";
// The GIFI export for a file, from the final trial balance (after entries), for the page and the download.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFile, loadReference } from "./server";
import { gifiCodes, gifiFile } from "./gifi";
import { todayToronto } from "@/lib/dates";

export async function gifiFor(supabase: SupabaseClient, fileId: string) {
  const data = await loadFile(supabase, fileId);
  if (!data) return null;
  const ref = await loadReference(supabase);
  const entryTotals = new Map<string, number>();
  for (const e of data.entries) for (const l of e.lines) entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
  const byNo = new Map(ref.lines.map((l) => [l.line_no, l]));
  const result = gifiCodes(data.accounts, entryTotals, byNo);
  const c = data.client;
  const problems = [...result.problems];
  if (!data.accounts.length) problems.unshift("Import the trial balance first.");
  if (!/^\d{9}$/.test(c?.business_number ?? "")) problems.push("The client has no Business Number. Add it on the client record (or import it from TaxDome).");
  const names = new Map(ref.lines.map((l) => [l.gifi_code, l.line_no.endsWith(".00") ? l.name : undefined]).filter(([, n]) => n) as [string, string][]);
  names.set("3660", "Retained earnings/deficit – Start");
  const file = gifiFile({ bn: c?.business_number ?? "", legalName: c?.legal_name ?? "", address: c?.street_address ?? "", city: c?.city ?? "", province: c?.province === "OTHER" ? "" : c?.province ?? "",
    postal: c?.postal_code ?? "", yearEnd: data.file.year_end, created: todayToronto() }, result.codes);
  const fileName = `${(c?.legal_name ?? "Client").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_GIFI_${data.file.year_end.replace(/-/g, "")}.gfi`;
  return { ...result, problems, names, file, fileName };
}
