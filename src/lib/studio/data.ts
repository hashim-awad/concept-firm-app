// Loads what the Studio screens and the PDF builder need from the app's database:
// price book rows (floors and packages), T1 catalogue prices, client records, signer names.
// Every read goes through the signed-in person's own session, so row level security applies.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canView, type Access } from "@/lib/access";
import { todayToronto } from "@/lib/dates";
import { toStudioClient, toStudioFloor, type ClientRecord, type OfferRecord } from "./screen";
import type { StudioClientRow } from "./controllers";
import type { Wording } from "./wording";

// The current approved wording; the approval date is shown in each letter's footer.
function toWording(d: unknown): Wording | null {
  const w = d as { id?: string; label?: string; approved_at?: string; texts?: Record<string, string> } | null;
  if (!w?.id || !w.label) return null;
  const date = w.approved_at ? new Date(w.approved_at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) : "";
  return { id: w.id, label: w.label, date, texts: w.texts ?? {} };
}

export const CLIENT_COLUMNS =
  "id, kind, legal_name, entity_type, signing_officer, signer_title, salutation, street_address, address_line2, city, postal_code, province, year_end_md, basis, custom_basis_wording, third_party_user, third_party_basis, name_verified";

export type Signer = { name: string; title: string };
export type StudioData = {
  floors: Record<string, unknown>[];
  floorsOk: boolean;
  cat: Record<string, unknown>[];
  clients: StudioClientRow[];
  signers: { letter: Signer; proposal: Signer };
  signatureUploaded: boolean;
  wording: Wording | null;
};

export async function loadStudioData(supabase: SupabaseClient, access: Access): Promise<StudioData> {
  const floorsOk = canView(access, "price_book");
  const today = todayToronto();
  const [offers, items, prices, clients, signers, wording] = await Promise.all([
    floorsOk ? supabase.from("offers").select("*").eq("is_active", true).order("sort_order") : Promise.resolve({ data: [] }),
    supabase.from("catalogue_items").select("id, code, name, unit_label").eq("is_active", true),
    supabase.from("item_prices").select("item_id, amount_cents, effective_from").lte("effective_from", today).order("effective_from"),
    canView(access, "clients") ? supabase.from("clients").select(CLIENT_COLUMNS).eq("status", "active").order("legal_name") : Promise.resolve({ data: [] }),
    supabase.rpc("signer_settings"),
    supabase.rpc("current_wording"),
  ]);
  const price = new Map<string, number>();
  for (const p of (prices.data ?? []) as { item_id: string; amount_cents: number }[]) price.set(p.item_id, p.amount_cents / 100);
  const cat = ((items.data ?? []) as { id: string; code: string; name: string; unit_label: string }[]).map((i) => ({
    Code: i.code, Service: i.name, Unit: i.unit_label, Price: price.has(i.id) ? price.get(i.id) : "",
  }));
  const s = (signers.data ?? {}) as Record<string, { name?: string; title?: string; uploaded?: boolean }>;
  const signer = (k: string, fallback: string): Signer => ({ name: s[k]?.name || fallback, title: s[k]?.title || "Director" });
  return {
    floors: ((offers.data ?? []) as OfferRecord[]).map(toStudioFloor),
    floorsOk,
    cat,
    clients: ((clients.data ?? []) as ClientRecord[]).map(toStudioClient),
    signers: { letter: signer("signer_engagement_letter", "Hashim Abouelfetouh, CPA"), proposal: signer("signer_proposal", "Hashim Awad") },
    signatureUploaded: !!s.signature_image?.uploaded,
    wording: toWording(wording.data),
  };
}

export const SIGNATURE_PATH = "signature/signature.png";

// The signature image as a data URL. Readable by owners only (storage policy).
export async function loadSignature(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.storage.from("brand-private").download(SIGNATURE_PATH);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return "data:image/png;base64," + buf.toString("base64");
}
