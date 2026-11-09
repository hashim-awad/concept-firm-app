"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withMessage } from "@/lib/messages";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { planImport, type Account, type Existing, type Flag, type Planned } from "@/lib/taxdome/accounts";

// The browser reads the TaxDome file and sends only the needed fields (accounts.ts COLUMNS).
// Nothing from the file is stored except what the owner saves.
export type Preview = { ok: true; planned: Planned[]; flags: Flag[]; candidates: { id: string; legal_name: string }[] } | { ok: false; error: string };

async function loadExisting() {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, kind, legal_name, business_number, taxdome_account_id, year_end_md, taxdome_tags");
  return { supabase, existing: (data ?? []) as Existing[] };
}

const clean = (accounts: Account[]): Account[] => accounts.slice(0, 5000).map((a) => ({
  row: Number(a.row) || 0, taxdomeId: String(a.taxdomeId).slice(0, 64), legalName: String(a.legalName).slice(0, 200), type: String(a.type).slice(0, 40),
  tags: (Array.isArray(a.tags) ? a.tags : []).map((t) => String(t).slice(0, 60)).slice(0, 40), bnRaw: String(a.bnRaw).slice(0, 40), bn: /^\d{9}$/.test(a.bn) ? a.bn : "",
  fyeRaw: String(a.fyeRaw).slice(0, 40), fye: /^\d{2}-\d{2}$/.test(a.fye) ? a.fye : "", province: ["ON", "AB", "BC", "OTHER"].includes(a.province) ? a.province : "",
}));

const cleanLinks = (links: Record<string, string>) => Object.fromEntries(Object.entries(links ?? {}).filter(([k, v]) => /^[\w-]{1,64}$/.test(k) && /^[0-9a-f-]{36}$/.test(v)));

export async function previewTaxdome(accounts: Account[], links: Record<string, string> = {}): Promise<Preview> {
  const access = await getAccess();
  if (!access?.is_owner) return { ok: false, error: "Only an owner can import from TaxDome." };
  const { existing } = await loadExisting();
  const { planned, flags, candidates } = planImport(clean(accounts), existing, cleanLinks(links));
  return { ok: true, planned, flags, candidates };
}

// Works the plan out again on the server and applies it all or nothing.
export async function applyTaxdome(accounts: Account[], expected: number, links: Record<string, string> = {}): Promise<{ ok: boolean; message: string }> {
  const access = await getAccess();
  if (!access?.is_owner) return { ok: false, message: "Only an owner can import from TaxDome." };
  const { supabase, existing } = await loadExisting();
  const { planned } = planImport(clean(accounts), existing, cleanLinks(links));
  if (planned.length !== expected) return { ok: false, message: "The client list changed since the preview. Check the file again, then save." };
  const plan = planned.map((p) => ({
    op: p.action, client_id: p.clientId ?? null, taxdome_id: p.account.taxdomeId, legal_name: p.account.legalName,
    bn: p.account.bn, fye: p.account.fye, tags: p.account.tags, province: p.account.province,
  }));
  const { data, error } = await supabase.rpc("apply_taxdome_import", { p_plan: plan });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/taxdome-import"); revalidatePath("/clients"); revalidatePath("/");
  const r = data as { added: number; updated: number };
  return { ok: true, message: `Saved: ${r.added} new client${r.added === 1 ? "" : "s"}, ${r.updated} updated. Each change is in the activity log.` };
}

export async function saveTaxdomeLink(formData: FormData): Promise<void> {
  const page = "/admin/taxdome-import";
  const access = await getAccess();
  if (!access?.is_owner) redirect(withMessage(page, "error", "Only an owner can change the TaxDome link."));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_setting", { p_key: "taxdome_account_url", p_value: String(formData.get("url") ?? "").trim() });
  revalidatePath(page);
  redirect(withMessage(page, error ? "error" : "msg", error ? error.message : "Link saved."));
}
