import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Item } from "./cleanup";

// The price book as the clean-up sees it: every item with its line and current price.
export async function loadItems(supabase: SupabaseClient): Promise<{ items: Item[]; lineKeys: string[] }> {
  const [{ data: items }, { data: lines }, { data: prices }] = await Promise.all([
    supabase.from("catalogue_items").select("id, code, name, unit_label, per_spouse, price_type, income_account, replaces_qbo, replaces_taxdome, internal_note, service_line_id"),
    supabase.from("service_lines").select("id, key"),
    supabase.from("current_item_prices").select("item_id, amount_cents"),
  ]);
  const lineKey = new Map((lines ?? []).map((l) => [l.id, l.key as string]));
  const price = new Map((prices ?? []).map((p) => [p.item_id, p.amount_cents as number]));
  return {
    lineKeys: (lines ?? []).map((l) => l.key as string),
    items: (items ?? []).map((i) => ({ ...i, line: lineKey.get(i.service_line_id) ?? "", price_cents: price.get(i.id) ?? null })) as Item[],
  };
}
