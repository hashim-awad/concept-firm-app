import { PageHeader, Notice } from "@/components/ui";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { TaxdomeImport } from "./taxdome-form";
import { saveTaxdomeLink } from "./actions";

// Import from TaxDome (decision 43): TaxDome is the master list of T2 clients.
export default async function TaxdomeImportPage({ searchParams }: PageProps<"/admin/taxdome-import">) {
  await requireOwner();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: url }, { count: linked }, { data: last }] = await Promise.all([
    supabase.rpc("taxdome_account_url"),
    supabase.from("clients").select("id", { count: "exact", head: true }).not("taxdome_account_id", "is", null),
    supabase.from("activity_log").select("occurred_at, details").eq("action", "taxdome_import").order("occurred_at", { ascending: false }).limit(1),
  ]);
  const prev = (last ?? [])[0] as { occurred_at: string; details: { added: number; updated: number } } | undefined;
  return (
    <>
      <PageHeader title="Import from TaxDome" description="TaxDome is the master list of T2 clients. Import brings in the legal name, Business Number, fiscal year-end, tags and the account link for every Company account tagged T2. Import a newer export any time; it updates those fields and never creates duplicates." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <p className="mb-4 text-sm text-ink-2">{linked ?? 0} clients are linked to TaxDome.{prev ? ` Last import ${formatDateTime(prev.occurred_at)}: ${prev.details.added} new, ${prev.details.updated} updated.` : ""}</p>
      <TaxdomeImport />
      <section className="card mt-6 max-w-3xl">
        <h2 className="mb-1 font-semibold">Link to a TaxDome account</h2>
        <p className="mb-3 text-sm text-muted">Open any client account in TaxDome, copy the address from the browser, and replace the account number with {"{id}"}. Studio builds each client&rsquo;s link from it.</p>
        <form action={saveTaxdomeLink} className="flex flex-wrap gap-2">
          <input name="url" defaultValue={(url as string | null) ?? ""} placeholder="https://…taxdome.com/…/{id}" className="input min-w-[20rem] flex-1" aria-label="TaxDome account link" />
          <button type="submit" className="btn-secondary">Save link</button>
        </form>
      </section>
    </>
  );
}
