import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import type { ClientForm } from "@/lib/clients";
import { ClientEditor } from "../client-editor";

const BLANK: ClientForm = {
  kind: "corporation", legal_name: "", entity_type: "PREC", signing_officer: "", signer_title: "Director", salutation: "", email: "", street_address: "", address_line2: "",
  city: "", postal_code: "", province: "ON", year_end_md: "", basis: "standard", custom_basis_wording: "", third_party_user: "", third_party_basis: "", status: "active", notes: "", name_verified: false,
};

export default async function ClientPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  const access = await requireAccess("clients", "view");
  const { id } = await params;
  const sp = await searchParams;
  const editable = canEdit(access, "clients");
  if (id === "new") {
    if (!editable) notFound();
    return (<><PageHeader eyebrow="Clients" title="Add client" /><ClientEditor id={null} initial={BLANK} verifiedOn="" editable /></>);
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const initial: ClientForm = Object.fromEntries(Object.keys(BLANK).map((k) => [k, c[k] ?? BLANK[k as keyof ClientForm]])) as ClientForm;
  const docs = canView(access, "documents") || canView(access, "vault")
    ? (await supabase.from("documents").select("id, kind, title, status, current_version, updated_at").eq("client_id", id).order("updated_at", { ascending: false })).data ?? []
    : [];
  const engs = canView(access, "documents") ? (await supabase.from("engagements").select("id, title, type, status, el_issued, el_signed").eq("client_id", id).order("fiscal_year_end", { ascending: false })).data ?? [] : [];
  const letterHref = c.kind === "individual" ? `/documents/t1-letter?client=${id}` : `/documents/corporate-letter?client=${id}`;
  return (
    <>
      <PageHeader eyebrow="Clients" title={c.legal_name} description={c.name_verified ? `Legal name checked ${c.name_verified_on ? formatDate(c.name_verified_on) : ""}.` : "Legal name not yet checked. Required for a Final letter."}
        actions={<Link href={letterHref} className="btn">New letter</Link>} />
      <Notice msg={sp.msg === "saved" ? "Client saved." : messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ClientEditor id={id} initial={initial} verifiedOn={c.name_verified_on ? formatDate(c.name_verified_on) : ""} editable={editable} />
        <div className="grid content-start gap-6">
          <section className="card">
            <h2 className="mb-2 font-semibold">Engagements</h2>
            {engs.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="grid gap-2 text-sm">{engs.map((e) => <li key={e.id}><Link href={`/documents/engagements/${e.id}`} className="text-navy-700 underline">{e.title}</Link> <span className="text-muted">· {e.status}</span></li>)}</ul>
            )}
          </section>
          <section className="card">
            <h2 className="mb-2 font-semibold">Documents</h2>
            {docs.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="grid gap-2 text-sm">{docs.map((d) => <li key={d.id}><Link href={`/documents/vault/${d.id}`} className="text-navy-700 underline">{d.title}</Link> <span className="text-muted">· version {d.current_version} · {d.status}</span></li>)}</ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
