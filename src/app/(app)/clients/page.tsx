import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { PageTabs } from "@/components/page-tabs";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buttonClass, type as typeScale } from "@/components/ds/primitives";
import { InfoTip } from "@/components/ds/info-tip";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { TAXDOME_IMPORT_HELP, taxdomeImportSummary } from "../admin/taxdome-import/view";
import { ClientSearch } from "./client-search";
import { RowMenu, type MenuItem } from "./row-menu";
import { ImportDialog } from "./import-dialog";

type Row = { id: string; kind: string; legal_name: string; entity_type: string; province: string; year_end_md: string; name_verified: boolean; status: string; taxdome_account_id: string | null };
type Conflict = { client_id: string; client: { legal_name: string } | null };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const access = await requireAccess("clients", "view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  // Front office batch, section 8 (mockup 4-Clients): Active, Waiting for TaxDome (added by a signing,
  // until the TaxDome import matches it), All. Inactive records show under All.
  const show = sp.show === "waiting" ? "waiting" : sp.show === "all" ? "all" : sp.show === "inactive" ? "inactive" : "active";
  const type = sp.type === "corporation" || sp.type === "individual" ? sp.type : "all";
  const importOpen = access.is_owner && sp.import === "1";
  const supabase = await createClient();
  let query = supabase.from("clients").select("id, kind, legal_name, entity_type, province, year_end_md, name_verified, status, taxdome_account_id").order("legal_name").limit(2000);
  if (q) query = query.ilike("legal_name", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  const [{ data: everyone }, { data: conflictRows }, summary] = await Promise.all([
    query,
    // Round 18: clients whose users of the statements differ from their latest Closebook file (owners decide).
    access.is_owner ? supabase.from("client_user_conflicts").select("client_id, client:clients(legal_name)") : Promise.resolve({ data: [] }),
    importOpen ? taxdomeImportSummary() : Promise.resolve(""),
  ]);
  const tally = { active: 0, waiting: 0 };
  for (const c of (everyone ?? []) as Row[]) { if (c.status === "active") tally.active++; if (c.status === "waiting_taxdome") tally.waiting++; }
  const data = ((everyone ?? []) as Row[]).filter((c) => show === "all" || c.status === ({ active: "active", waiting: "waiting_taxdome", inactive: "inactive" } as Record<string, string>)[show]);
  // Counts for the type filter follow the search and Active/Inactive choice.
  const all = (data ?? []) as Row[];
  const count = { all: all.length, corporation: all.filter((c) => c.kind === "corporation").length, individual: all.filter((c) => c.kind === "individual").length };
  const rows = type === "all" ? all : all.filter((c) => c.kind === type);
  const conflicts = ((conflictRows ?? []) as unknown as Conflict[]).filter((c) => c.client).sort((a, b) => a.client!.legal_name.localeCompare(b.client!.legal_name));
  const tdUrl = rows.some((c) => c.taxdome_account_id) ? ((await supabase.rpc("taxdome_account_url")).data as string | null) || "" : "";

  // The address keeps the search and filters, so the dialog and the search box come back to the same list.
  const params: Record<string, string> = {};
  if (show !== "active") params.show = show;
  if (type !== "all") params.type = type;
  const href = (extra: Record<string, string> = {}) => { const s = new URLSearchParams({ ...params, ...(q ? { q } : {}), ...extra }).toString(); return s ? `/clients?${s}` : "/clients"; };
  const canPropose = canEdit(access, "documents") && canView(access, "pricing");
  const canFile = canEdit(access, "closebook");
  const menu = (c: Row): MenuItem[] => [
    { label: "New letter", href: c.kind === "individual" ? `/engagement-letters/new?type=t1&client=${c.id}` : `/engagement-letters/new?type=corporate&client=${c.id}` },
    ...(canPropose ? [{ label: "New monthly quote", href: `/quotes/proposal?client=${c.id}` }] : []),
    ...(canFile && c.kind === "corporation" ? [{ label: "New Closebook file", href: `/closebook/new?client=${c.id}` }] : []),
    ...(tdUrl && c.taxdome_account_id ? [{ label: "Open in TaxDome", href: tdUrl.replace("{id}", encodeURIComponent(c.taxdome_account_id)), external: true }] : []),
    { label: "Edit client", href: `/clients/${c.id}?edit=details` },
  ];
  const unchecked = rows.some((c) => !c.name_verified);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-sand-200 pb-5">
        <h1 className={`${typeScale.h1} flex items-center`}>Clients<InfoTip label="About clients">Client records used by letters and quotes. A Final letter needs the legal name checked against the registry (or ID for individuals).</InfoTip></h1>
        <div className="flex flex-wrap items-center gap-2">
          {access.is_owner && <Link href="/admin/connections" className="mr-1 text-sm text-navy-700 hover:underline">TaxDome tags → types</Link>}
          {access.is_owner && <Link href={href({ import: "1" })} scroll={false} className={buttonClass("secondary")}><Upload className="h-4 w-4" aria-hidden />Import from TaxDome</Link>}
          {canEdit(access, "clients") && <Link href="/clients/new" className={buttonClass("primary")}><Plus className="h-4 w-4" aria-hidden />Add client</Link>}
        </div>
      </header>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {conflicts.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-[#5C3D00]">
          <p>{conflicts.length} client{conflicts.length === 1 ? "" : "s"}: users of the statements differ from their latest Closebook file. Open each to decide.</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{conflicts.map((c) => <Link key={c.client_id} href={`/clients/${c.client_id}`} className="font-medium underline">{c.client!.legal_name}</Link>)}</p>
        </div>
      )}
      <PageTabs label="Status" current={show === "inactive" ? "all" : show} tabs={[
        { key: "active", href: `/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`, label: `Active (${tally.active})` },
        { key: "waiting", href: `/clients?show=waiting${q ? `&q=${encodeURIComponent(q)}` : ""}`, label: `Waiting for TaxDome (${tally.waiting})` },
        { key: "all", href: `/clients?show=all${q ? `&q=${encodeURIComponent(q)}` : ""}`, label: "All" },
      ]} />
      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="show" value={show} />
        <ClientSearch q={q} params={params} />
        <div>
          <label htmlFor="type" className="label">Type</label>
          <AutoSubmitSelect id="type" name="type" defaultValue={type} className="input">
            <option value="all">All clients ({count.all})</option>
            <option value="corporation">Companies ({count.corporation})</option>
            <option value="individual">Individuals ({count.individual})</option>
          </AutoSubmitSelect>
        </div>
      </form>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">No clients found.</p> : (
          <table className="table">
            <thead><tr><th>Legal name</th><th>Type</th><th>Province</th><th>Year-end</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clients/${c.id}`} className="font-medium text-navy-700 hover:underline">{c.legal_name}</Link>
                    {!c.name_verified && <span title="Legal name not checked yet" aria-label="Legal name not checked yet" className="ml-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-warning-soft align-middle text-[11px] font-bold text-warning">!</span>}
                  </td>
                  <td>{c.kind === "individual" ? "Individual" : c.entity_type}</td>
                  <td>{c.province === "OTHER" ? "Other" : c.province}</td>
                  <td>{c.year_end_md}</td>
                  <td>{c.status === "waiting_taxdome" ? <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning whitespace-nowrap">Waiting for TaxDome</span>
                    : c.status === "active" ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Active</span>
                    : <span className="rounded bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-3">Inactive</span>}</td>
                  <td className="w-10 text-right"><RowMenu name={c.legal_name} items={menu(c)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {unchecked && <p className="mt-2 text-xs text-ink-3"><span className="mr-1 inline-grid h-4 w-4 place-items-center rounded-full bg-warning-soft align-middle text-[11px] font-bold text-warning" aria-hidden>!</span>The legal name is not checked yet. A Final letter needs it checked against the registry (or ID for individuals).</p>}
      {importOpen && <ImportDialog summary={summary} help={TAXDOME_IMPORT_HELP} closeHref={href()} />}
    </>
  );
}
