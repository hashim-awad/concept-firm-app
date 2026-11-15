import { Notice } from "@/components/ui";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import type { SP, View } from "../settings-shell";
import { TaxdomeImport } from "./taxdome-form";
import { saveTaxdomeLink } from "./actions";

// Import TaxDome export (decision 43): TaxDome is the master list of T2 clients. Owners only.
export async function TaxdomeImportView(sp: SP): Promise<View> {
  await requireOwner();
  const supabase = await createClient();
  const [{ count: linked }, { data: last }] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).not("taxdome_account_id", "is", null),
    supabase.from("activity_log").select("occurred_at, details").eq("action", "taxdome_import").order("occurred_at", { ascending: false }).limit(1),
  ]);
  const prev = (last ?? [])[0] as { occurred_at: string; details: { added: number; updated: number } } | undefined;
  return {
    help: <p>TaxDome is the master list of T2 clients. Import brings in the legal name, Business Number, fiscal year-end, tags and the account link for every Company account tagged T2. Import a newer export any time. It updates those fields and never creates duplicates.</p>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <p className="mb-4 text-sm text-ink-2">{linked ?? 0} clients are linked to TaxDome.{prev ? ` Last import ${formatDateTime(prev.occurred_at)}: ${prev.details.added} new, ${prev.details.updated} updated.` : ""}</p>
      <TaxdomeImport />
    </>,
  };
}

// Connections (round 17): the link to a TaxDome account, moved from the import page. Owners only.
export async function ConnectionsView(sp: SP): Promise<View> {
  await requireOwner();
  const { data: url } = await (await createClient()).rpc("taxdome_account_url");
  return {
    help: <><h4>Link to a TaxDome account</h4><p>Open any client account in TaxDome, copy the address from the browser, and replace the account number with {"{id}"}. Studio builds each client&rsquo;s link from it.</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card max-w-3xl">
        <h2 className="mb-3 font-semibold">Link to a TaxDome account</h2>
        <form action={saveTaxdomeLink} className="flex flex-wrap gap-2">
          <input name="url" defaultValue={(url as string | null) ?? ""} placeholder="https://…taxdome.com/…/{id}" className="input min-w-[20rem] flex-1" aria-label="TaxDome account link" />
          <button type="submit" className="btn-secondary">Save link</button>
        </form>
      </section>
    </>,
  };
}
