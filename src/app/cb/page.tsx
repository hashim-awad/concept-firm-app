import Link from "next/link";
import { canEdit, requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/books/server";
import { CbLogo } from "./logo";
import { AddClient } from "./add-client";

// CB2-1 Part 1.4: Closebook's client list (per firm). Concept's clients come from Studio (one per client with a year
// file); a firm without Studio adds a client by hand.
export default async function CbHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const access = await requireAccess("closebook", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  const all = await listClients(supabase);
  const q = (sp.q ?? "").trim().toLowerCase();
  const clients = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
  const linked = new Set(all.map((c) => c.studio_client_id).filter(Boolean));
  const { data: studio } = canEdit(access, "closebook") ? await supabase.from("clients").select("id, legal_name").order("legal_name").limit(2000) : { data: [] };
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center gap-3 bg-navy-800 px-4 text-white"><CbLogo tone="white" height={26} /><span className="flex-1" />
        <Link href="/" className="rounded-md px-2 py-1.5 text-[13px] font-semibold hover:bg-white/10">Back to Studio</Link></header>
      <main className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-[22px] font-bold">Clients</h1><span className="flex-1" />
          {canEdit(access, "closebook") && <AddClient studio={((studio ?? []) as { id: string; legal_name: string }[]).filter((c) => !linked.has(c.id)).map((c) => ({ value: c.id, label: c.legal_name }))} />}</div>
        <form method="get"><input name="q" defaultValue={sp.q ?? ""} placeholder="Find a client" aria-label="Find a client" className="input w-full max-w-sm" data-client-find /></form>
        <ul className="card divide-y divide-sand-200 p-0" data-client-list>
          {clients.map((c) => <li key={c.id}><Link href={`/cb/${c.id}/overview`} className="flex items-center gap-2 px-4 py-3 hover:bg-sand-50">
            <span className="text-[14px] font-semibold text-navy-700">{c.name}</span><span className="text-[12px] text-ink-3">{c.province}</span></Link></li>)}
          {!clients.length && <li className="px-4 py-3 text-[13px] text-ink-3">No client matches.</li>}
        </ul>
      </main>
    </div>
  );
}
