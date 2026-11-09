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
import { PageTabs } from "@/components/page-tabs";
import { formatDateTime } from "@/components/ui";

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
  const seeDocs = canView(access, "documents"), seeVault = seeDocs || canView(access, "vault"), pricing = canView(access, "pricing");

  // The client page is the hub: everything about this client, in tabs.
  const TABS = [
    { key: "overview", label: "Overview", show: true },
    { key: "engagements", label: "Engagements", show: seeDocs },
    { key: "proposals", label: "Proposals and letters", show: seeDocs },
    { key: "year-ends", label: "Year-Ends", show: c.kind === "corporation" },
    { key: "documents", label: "Documents", show: seeVault },
    { key: "activity", label: "Activity", show: access.is_owner },
  ].filter((t) => t.show);
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : "overview";
  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: `/clients/${id}${t.key === "overview" ? "" : `?tab=${t.key}`}` }));

  const [{ data: linkRows }, engs, docs, props] = await Promise.all([
    supabase.from("client_links").select("relationship, client_id, linked_id, a:clients!client_links_client_id_fkey(id, legal_name, kind), b:clients!client_links_linked_id_fkey(id, legal_name, kind)").or(`client_id.eq.${id},linked_id.eq.${id}`),
    seeDocs ? supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, el_signed").eq("client_id", id).order("fiscal_year_end", { ascending: false, nullsFirst: false }).then((r) => r.data ?? []) : Promise.resolve([]),
    seeVault ? supabase.from("documents").select("id, kind, title, status, current_version, updated_at").eq("client_id", id).order("updated_at", { ascending: false }).then((r) => r.data ?? []) : Promise.resolve([]),
    seeDocs && pricing ? supabase.from("proposals").select("id, title, status, date_sent, valid_until, chosen_option").eq("client_id", id).order("date_sent", { ascending: false, nullsFirst: false }).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  type L = { relationship: string; client_id: string; a: { id: string; legal_name: string; kind: string } | null; b: { id: string; legal_name: string; kind: string } | null };
  const links = ((linkRows ?? []) as unknown as L[]).map((l) => ({ rel: l.relationship, other: l.client_id === id ? l.b : l.a })).filter((l) => l.other);
  const letterHref = c.kind === "individual" ? `/engagement-letters?type=t1&client=${id}` : `/engagement-letters?type=corporate&client=${id}`;
  const KIND: Record<string, string> = { corporate_letter: "Corporate letter", t1_letter: "T1 letter", proposal: "Proposal" };
  const empty = (t: string) => <p className="p-5 text-sm text-muted">{t}</p>;

  let content: React.ReactNode;
  if (tab === "engagements") {
    content = <section className="card overflow-x-auto p-0">{engs.length === 0 ? empty("No engagements yet.") : (
      <table className="table"><thead><tr><th>Engagement</th><th>Service</th><th>Year end</th><th>EL issued</th><th>EL signed</th><th>Status</th></tr></thead>
        <tbody>{engs.map((e) => (
          <tr key={e.id}><td><Link href={`/documents/engagements/${e.id}`} className="font-medium text-navy-700 hover:underline">{e.title}</Link></td><td>{e.type}</td>
            <td>{formatDate(e.fiscal_year_end)}</td><td>{formatDate(e.el_issued)}</td><td>{formatDate(e.el_signed)}</td><td>{e.status}</td></tr>
        ))}</tbody></table>)}</section>;
  } else if (tab === "proposals") {
    const made = docs;
    content = (
      <div className="grid gap-6">
        {pricing && (<section className="card overflow-x-auto p-0"><h2 className="px-5 pt-4 pb-2 font-semibold">Proposals</h2>{props.length === 0 ? empty("No proposals for this client.") : (
          <table className="table"><thead><tr><th>Proposal</th><th>Sent</th><th>Valid until</th><th>Status</th><th>Option</th></tr></thead>
            <tbody>{props.map((p) => <tr key={p.id}><td className="font-medium">{p.title}</td><td>{formatDate(p.date_sent)}</td><td>{formatDate(p.valid_until)}</td><td>{p.status === "Sent" ? "Awaiting signature" : p.status}</td><td>{p.chosen_option}</td></tr>)}</tbody></table>)}</section>)}
        <section className="card overflow-x-auto p-0"><h2 className="px-5 pt-4 pb-2 font-semibold">Letters and proposal PDFs</h2>{made.length === 0 ? empty("None yet.") : (
          <table className="table"><thead><tr><th>Document</th><th>Type</th><th>Version</th><th>Status</th><th>Last change</th></tr></thead>
            <tbody>{made.map((d) => <tr key={d.id}><td><Link href={`/documents/vault/${d.id}`} className="font-medium text-navy-700 hover:underline">{d.title}</Link></td><td>{KIND[d.kind]}</td><td>{d.current_version}</td><td className="capitalize">{d.status}</td><td>{formatDate(d.updated_at)}</td></tr>)}</tbody></table>)}</section>
      </div>
    );
  } else if (tab === "year-ends") {
    content = <section className="card"><p className="text-sm text-muted"><span className="mr-2 rounded border border-sand-300 px-1.5 py-0.5 text-[11px] font-semibold text-ink-3">Soon</span>Year-end engagements (the CaseWare-style workspace) arrive with Phase 3.</p></section>;
  } else if (tab === "documents") {
    content = <section className="card overflow-x-auto p-0">{docs.length === 0 ? empty("Nothing in the vault for this client.") : (
      <table className="table"><thead><tr><th>Document</th><th>Type</th><th>Versions</th><th>Status</th><th>Last change</th></tr></thead>
        <tbody>{docs.map((d) => <tr key={d.id}><td><Link href={`/documents/vault/${d.id}`} className="font-medium text-navy-700 hover:underline">{d.title}</Link></td><td>{KIND[d.kind]}</td><td>{d.current_version}</td><td className="capitalize">{d.status}</td><td>{formatDate(d.updated_at)}</td></tr>)}</tbody></table>)}</section>;
  } else if (tab === "activity") {
    // Owners only (the activity log is owner-only in the database too).
    const ids = [id, ...engs.map((e) => e.id), ...docs.map((d) => d.id), ...props.map((p) => p.id)];
    const [{ data: log }, { data: staff }] = await Promise.all([
      supabase.from("activity_log").select("id, occurred_at, actor_id, action, entity_type").in("entity_id", ids).order("occurred_at", { ascending: false }).limit(200),
      supabase.from("staff").select("id, full_name"),
    ]);
    const who = new Map((staff ?? []).map((x: { id: string; full_name: string }) => [x.id, x.full_name]));
    const WHAT: Record<string, string> = { clients: "Client record", engagements: "Engagement", documents: "Document", document_versions: "Document version", proposals: "Proposal" };
    content = <section className="card overflow-x-auto p-0">{(log ?? []).length === 0 ? empty("No activity recorded for this client.") : (
      <table className="table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>{(log ?? []).map((e) => <tr key={e.id}><td className="whitespace-nowrap text-muted">{formatDateTime(e.occurred_at)}</td><td>{e.actor_id ? who.get(e.actor_id) ?? "Unknown" : "System"}</td><td>{WHAT[e.entity_type] ?? e.entity_type} · {e.action}</td></tr>)}</tbody></table>)}</section>;
  } else {
    content = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ClientEditor id={id} initial={initial} verifiedOn={c.name_verified_on ? formatDate(c.name_verified_on) : ""} editable={editable} />
        <div className="grid content-start gap-6">
          <section className="card">
            <h2 className="mb-2 font-semibold">Linked clients</h2>
            {links.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="grid gap-2 text-sm">{links.map((l, i) => <li key={i}><Link href={`/clients/${l.other!.id}`} className="text-navy-700 underline">{l.other!.legal_name}</Link> <span className="text-muted">· {l.rel}</span></li>)}</ul>
            )}
          </section>
          {seeDocs && (
            <section className="card">
              <h2 className="mb-2 font-semibold">At a glance</h2>
              <ul className="grid gap-1.5 text-sm">
                <li><Link href={`/clients/${id}?tab=engagements`} className="text-navy-700 underline">{engs.length} engagement{engs.length === 1 ? "" : "s"}</Link>{engs[0] ? <span className="text-muted"> · latest {engs[0].status}</span> : null}</li>
                <li><Link href={`/clients/${id}?tab=proposals`} className="text-navy-700 underline">{props.length} proposal{props.length === 1 ? "" : "s"}</Link>{props.some((p) => p.status === "Sent") ? <span className="text-muted"> · awaiting signature</span> : null}</li>
                <li><Link href={`/clients/${id}?tab=documents`} className="text-navy-700 underline">{docs.length} document{docs.length === 1 ? "" : "s"}</Link></li>
              </ul>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader eyebrow={c.kind === "individual" ? "Client · Individual" : "Client · Corporation"} title={c.legal_name} description={c.name_verified ? `Legal name checked ${c.name_verified_on ? formatDate(c.name_verified_on) : ""}.` : "Legal name not yet checked. Required for a Final letter."}
        actions={canEdit(access, "documents") ? <Link href={letterHref} className="btn">New letter</Link> : undefined} />
      <Notice msg={sp.msg === "saved" ? "Client saved." : messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <PageTabs label="Client" current={tab} tabs={tabs} />
      {content}
    </>
  );
}
