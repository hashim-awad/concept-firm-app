import Link from "next/link";
import { SaveForm, SaveFormButton, SaveFormDiscard } from "@/components/save-state";
import { Notice } from "@/components/ui";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import type { SP, View } from "../settings-shell";
import { saveTaxdomeLink } from "./actions";
import { TypeTagsForm } from "./type-tags-form";

// Import TaxDome export (decision 43): TaxDome is the master list of T2 clients. Owners only.
// Round 18: the import opens as a dialog on Clients (/clients?import=1). This gives the line it shows.
export async function taxdomeImportSummary(): Promise<string> {
  await requireOwner();
  const supabase = await createClient();
  const [{ count: linked }, { data: last }] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).not("taxdome_account_id", "is", null),
    supabase.from("activity_log").select("occurred_at, details").eq("action", "taxdome_import").order("occurred_at", { ascending: false }).limit(1),
  ]);
  const prev = (last ?? [])[0] as { occurred_at: string; details: { added: number; updated: number } } | undefined;
  return `${linked ?? 0} clients are linked to TaxDome.${prev ? ` Last import ${formatDateTime(prev.occurred_at)}: ${prev.details.added} new, ${prev.details.updated} updated.` : ""}`;
}

export const TAXDOME_IMPORT_HELP = "TaxDome is the master list of T2 clients. Import brings in the legal name, Business Number, fiscal year-end, tags and the account link for every Company account tagged T2. Import a newer export any time. It updates those fields and never creates duplicates.";

type OnOther = { id: string; legal_name: string; taxdome_tags: string[] | null };

// Connections (round 17): the link to a TaxDome account. Round 18: the type each TaxDome tag gives. Owners only.
export async function ConnectionsView(sp: SP): Promise<View> {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: url }, { data: map }, { data: other }] = await Promise.all([
    supabase.rpc("taxdome_account_url"),
    supabase.from("taxdome_type_tags").select("tag, entity_type").order("tag"),
    supabase.from("clients").select("id, legal_name, taxdome_tags").eq("kind", "corporation").eq("entity_type", "Other").not("taxdome_account_id", "is", null).order("legal_name"),
  ]);
  const tags = (map ?? []) as { tag: string; entity_type: string }[];
  const onOther = (other ?? []) as OnOther[];
  return {
    help: <>
      <h4>Link to a TaxDome account</h4><p>Open any client account in TaxDome, copy the address from the browser, and replace the account number with {"{id}"}. Studio builds each client&rsquo;s link from it.</p>
      <h4>Type from TaxDome tags</h4><p>The import gives each company the type its tags map to. A type set by hand on the client is never changed by an import.</p>
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid max-w-3xl gap-5">
        <section className="card">
          <h2 className="mb-3 font-semibold">Link to a TaxDome account</h2>
          <SaveForm action={saveTaxdomeLink} aria-label="TaxDome link" className="flex flex-wrap gap-2">
            <input name="url" defaultValue={(url as string | null) ?? ""} placeholder="https://…taxdome.com/…/{id}" className="input min-w-[20rem] flex-1" aria-label="TaxDome account link" />
            <span className="inline-flex w-fit items-center gap-2"><SaveFormButton className="btn-secondary" /><SaveFormDiscard /></span>
          </SaveForm>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold">Type from TaxDome tags</h2>
          <TypeTagsForm initial={tags} />
          <h3 className="mt-6 mb-2 text-sm font-semibold">Clients still on Other ({onOther.length})</h3>
          {onOther.length === 0 ? <p className="text-sm text-muted">None. Every company linked to TaxDome has a type.</p> : (
            <ul className="grid gap-1.5 text-sm">
              {onOther.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/clients/${c.id}`} className="font-medium text-navy-700 hover:underline">{c.legal_name}</Link>
                  {(c.taxdome_tags ?? []).map((t) => <span key={t} className="rounded bg-sand-100 px-1.5 py-0.5 text-xs text-ink-2">{t}</span>)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>,
  };
}
