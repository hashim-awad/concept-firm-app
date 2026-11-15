import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass, type as typeScale } from "@/components/ds/primitives";
import { cameFrom, engagementStatus } from "@/lib/engagements";
import { markInTaxDome, saveT2Settings } from "../actions";
import { Notice, formatDateTime } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate, todayToronto } from "@/lib/dates";
import type { ClientForm } from "@/lib/clients";
import { ClientEditor } from "../client-editor";
import { lastYearEnd, t2BalanceDue, t2FilingDeadline } from "@/lib/deadlines";
import { PageTabs } from "@/components/page-tabs";
import { staffNames } from "@/lib/closebook/server";
import { loadClientFiles, type ClientFile } from "./closebook";
import { StatementsEditor } from "./statements-editor";
import { NewMenu } from "./new-menu";
import { STATUS_WORD, basisWords, clientChanges, statementUsers, userLabel } from "./words";

const BLANK: ClientForm = {
  kind: "corporation", legal_name: "", entity_type: "PREC", signing_officer: "", signer_title: "Director", salutation: "", email: "", street_address: "", address_line2: "",
  city: "", postal_code: "", province: "ON", year_end_md: "", basis: "standard", custom_basis_wording: "", third_party_user: "", third_party_basis: "", status: "active", notes: "", name_verified: false,
};

const LINK = "font-medium text-navy-700 hover:underline";
const CHIP = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
const yearOf = (d: string | null | undefined) => (d ? d.slice(0, 4) : "");

// A read view row: a term and its value. A blank value shows "Not set".
function Item({ term, children }: { term: string; children: React.ReactNode }) {
  const blank = children === null || children === undefined || children === "" || children === false;
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-ink-3">{term}</dt>
      <dd className="text-sm text-ink">{blank ? <span className="text-ink-3">Not set</span> : children}</dd>
    </div>
  );
}

function CardHead({ title, editHref }: { title: string; editHref?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="font-semibold">{title}</h2>
      {editHref && <Link href={editHref} className={buttonClass("secondary", "sm")}>Edit</Link>}
    </div>
  );
}

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
  // Round 18: the old tab keys open their new tabs.
  if (sp.tab === "proposals") redirect(`/clients/${id}?tab=quotes`);
  if (sp.tab === "year-ends") redirect(`/clients/${id}?tab=closebook`);
  const supabase = await createClient();
  const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const initial: ClientForm = Object.fromEntries(Object.keys(BLANK).map((k) => [k, c[k] ?? BLANK[k as keyof ClientForm]])) as ClientForm;
  const corp = c.kind === "corporation";
  const seeDocs = canView(access, "documents"), seeVault = seeDocs || canView(access, "vault"), pricing = canView(access, "pricing");
  const seeCb = corp && canView(access, "closebook"), editCb = corp && canEdit(access, "closebook");
  const editDocs = canEdit(access, "documents");

  // Round 18: the client page is the hub (TaxDome's account page): everything about this client, in tabs.
  const TABS = [
    { key: "overview", label: "Overview", show: true },
    { key: "engagements", label: "Engagements and letters", show: seeDocs },
    { key: "quotes", label: "Quotes", show: seeDocs && pricing },
    { key: "closebook", label: "Closebook files", show: seeCb },
    { key: "documents", label: "Documents", show: seeVault },
    { key: "activity", label: "Activity", show: access.is_owner },
  ].filter((t) => t.show);
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : "overview";
  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: `/clients/${id}${t.key === "overview" ? "" : `?tab=${t.key}`}` }));

  // A failed read shows its error instead of an empty list (step 5 test, Nov 13, 2026).
  const loadErrors: string[] = [];
  const keep = <T,>(what: string) => (r: { data: T[] | null; error: { message: string } | null }) => { if (r.error) loadErrors.push(`${what} could not be read: ${r.error.message}`); return r.data ?? []; };
  const needFiles = seeCb && (tab === "closebook" || tab === "documents");
  const [{ data: linkRows, error: linkError }, engs, docs, props, names] = await Promise.all([
    supabase.from("client_links").select("relationship, client_id, linked_id, a:clients!client_links_client_id_fkey(id, legal_name, kind), b:clients!client_links_linked_id_fkey(id, legal_name, kind)").or(`client_id.eq.${id},linked_id.eq.${id}`),
    seeDocs ? supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, el_signed, came_from, el_version").or(`client_id.eq.${id},client2_id.eq.${id}`).order("fiscal_year_end", { ascending: false, nullsFirst: false }).then(keep("Engagements")) : Promise.resolve([]),
    seeVault ? supabase.from("documents").select("id, kind, title, status, current_version, updated_at").eq("client_id", id).order("updated_at", { ascending: false }).then(keep("Documents")) : Promise.resolve([]),
    seeDocs && pricing ? supabase.from("quotes").select("id, kind, title, company_name, status, sent_at, valid_until, lead_id").eq("client_id", id).neq("status", "draft").order("sent_at", { ascending: false, nullsFirst: false }).then(keep("Quotes")) : Promise.resolve([]),
    staffNames(supabase),
  ]);
  if (linkError) loadErrors.push(`Linked clients could not be read: ${linkError.message}`);
  let files: ClientFile[] = [];
  if (needFiles) {
    const r = await loadClientFiles(supabase, id, names);
    files = r.files;
    if (r.error) loadErrors.push(r.error);
  }
  type L = { relationship: string; client_id: string; a: { id: string; legal_name: string; kind: string } | null; b: { id: string; legal_name: string; kind: string } | null };
  const links = ((linkRows ?? []) as unknown as L[]).map((l) => ({ rel: l.relationship, other: l.client_id === id ? l.b : l.a })).filter((l) => l.other);
  const tdUrl = c.taxdome_account_id ? ((await supabase.rpc("taxdome_account_url")).data as string | null) || "" : "";
  const tdLink = tdUrl && c.taxdome_account_id ? tdUrl.replace("{id}", encodeURIComponent(c.taxdome_account_id)) : "";
  const lastYe = /^\d{2}-\d{2}$/.test(c.year_end_md ?? "") ? lastYearEnd(c.year_end_md, todayToronto()) : "";
  const letterHref = c.kind === "individual" ? `/engagement-letters/new?type=t1&client=${id}` : `/engagement-letters/new?type=corporate&client=${id}`;
  const KIND: Record<string, string> = { corporate_letter: "Corporate letter", t1_letter: "T1 letter", proposal: "Proposal" };
  const empty = (t: string) => <p className="p-5 text-sm text-muted">{t}</p>;
  const heading = (t: string) => <h2 className="px-5 pt-4 pb-2 font-semibold">{t}</h2>;

  let content: React.ReactNode;
  if (tab === "engagements") {
    const letters = docs.filter((d) => d.kind === "corporate_letter" || d.kind === "t1_letter");
    content = (
      <div className="grid gap-6">
        <section className="card overflow-x-auto p-0">{heading("Engagements")}{engs.length === 0 ? empty("No engagements yet.") : (
          <table className="table"><thead><tr><th>Engagement</th><th>Service</th><th>Year-end</th><th>Came from</th><th>Letter signed</th><th>Status</th></tr></thead>
            <tbody>{engs.map((e) => (
              <tr key={e.id}><td><Link href={`/documents/engagements/${e.id}`} className={LINK}>{e.title}</Link></td><td>{e.type}</td>
                <td>{formatDate(e.fiscal_year_end)}</td><td>{cameFrom(e)}</td><td>{formatDate(e.el_signed)}</td><td><span className={`rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${engagementStatus(e.status).cls}`}>{engagementStatus(e.status).label}</span></td></tr>
            ))}</tbody></table>)}</section>
        <section className="card overflow-x-auto p-0">{heading("Engagement letters")}{letters.length === 0 ? empty("No engagement letters yet.") : (
          <table className="table"><thead><tr><th>Letter</th><th>Type</th><th>Version</th><th>Status</th><th>Last change</th></tr></thead>
            <tbody>{letters.map((d) => <tr key={d.id}><td><Link href={`/documents/vault/${d.id}`} className={LINK}>{d.title}</Link></td><td>{KIND[d.kind]}</td><td>{d.current_version}</td><td className="capitalize">{d.status}</td><td>{formatDate(d.updated_at)}</td></tr>)}</tbody></table>)}</section>
      </div>
    );
  } else if (tab === "quotes") {
    content = <section className="card overflow-x-auto p-0">{props.length === 0 ? empty("No quotes sent to this client.") : (
      <table className="table"><thead><tr><th>Type</th><th>Sent</th><th>Status</th></tr></thead>
        <tbody>{(props as { id: string; kind: string; status: string; sent_at: string | null; lead_id: string | null }[]).map((p) => (
          <tr key={p.id}><td><Link href={p.kind === "letter" ? `/engagement-letters/${p.id}` : p.kind === "proposal" ? `/quotes/${p.id}` : p.lead_id ? `/leads/${p.lead_id}/quote` : "/quotes"} className={LINK}>{({ t1: "Personal tax quote", corporate: "Company year-end quote", proposal: "Monthly proposal", letter: "New letter" } as Record<string, string>)[p.kind] ?? p.kind}</Link></td>
            <td>{formatDate(p.sent_at)}</td><td className="capitalize">{p.status === "sent" || p.status === "viewed" ? "Waiting for signature" : p.status}</td></tr>))}</tbody></table>)}</section>;
  } else if (tab === "closebook") {
    content = (
      <div className="grid gap-3">
        {editCb && <div><Link href={`/closebook/new?client=${id}`} className={buttonClass("primary")}>New Closebook file</Link></div>}
        <section className="card overflow-x-auto p-0">{files.length === 0 ? empty("No Closebook files for this client yet.") : (
          <table className="table"><thead><tr><th>Year-end</th><th>Step</th><th>Preparer</th><th>Reviewer</th><th>Status</th></tr></thead>
            <tbody>{files.map((f) => (
              <tr key={f.id}><td className="whitespace-nowrap"><Link href={`/closebook/${f.id}`} className={LINK}>{formatDate(f.yearEnd)}</Link></td>
                <td>{f.step}</td><td>{f.preparer}</td><td>{f.reviewer}</td>
                <td className="whitespace-nowrap">{f.locked ? `Locked ${formatDate(f.lockedAt)}`.trim() : f.deliveredAt ? `Delivered ${formatDate(f.deliveredAt)}` : f.malSignedAt ? `MAL signed ${formatDate(f.malSignedAt)}` : "In progress"}</td></tr>
            ))}</tbody></table>)}</section>
      </div>
    );
  } else if (tab === "documents") {
    // Everything Studio made for the client: the vault, then each Closebook file's package once the MAL
    // is signed or the file is delivered or locked.
    const FROM: Record<string, string> = { corporate_letter: "Engagements", t1_letter: "Engagements", proposal: "Quotes" };
    type Row = { key: string; title: string; href: string; from: string; date: string | null; status: string };
    const rows: Row[] = docs.map((d) => ({ key: d.id, title: d.title, href: `/documents/vault/${d.id}`, from: FROM[d.kind] ?? "Documents", date: d.updated_at, status: d.status }));
    for (const f of files) {
      if (!f.malSignedAt && !f.deliveredAt && !f.locked) continue;
      const from = `Closebook ${yearOf(f.yearEnd)}`;
      const status = f.locked ? "Locked" : f.deliveredAt ? "Delivered" : "Final";
      const date = f.deliveredAt ?? f.malSignedAt ?? f.lockedAt;
      const pkg = (doc: string) => `/closebook/${f.id}/package?doc=${doc}`;
      rows.push({ key: `${f.id}-fs`, title: "Financial statements", href: pkg("fs"), from, date, status });
      if (f.malSignedAt) rows.push({ key: `${f.id}-signed`, title: "Management acknowledgement letter signed", href: pkg("signed"), from, date: f.malSignedAt, status: "Signed" });
      rows.push({ key: `${f.id}-letter`, title: "Minute book letter", href: pkg("letter"), from, date, status });
      if (f.ownBooks) rows.push({ key: `${f.id}-entries`, title: "Client entry list", href: `/closebook/${f.id}/client-entries`, from, date, status });
    }
    rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    content = <section className="card overflow-x-auto p-0">{rows.length === 0 ? empty("No documents for this client yet.") : (
      <table className="table"><thead><tr><th>Document</th><th>From</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>{rows.map((d) => <tr key={d.key}><td>{d.href.startsWith("/closebook/")
          ? <a href={d.href} target="_blank" rel="noreferrer" className={LINK}>{d.title}</a>
          : <Link href={d.href} className={LINK}>{d.title}</Link>}</td><td>{d.from}</td><td className="whitespace-nowrap">{formatDate(d.date)}</td><td className="capitalize">{d.status}</td></tr>)}</tbody></table>)}</section>;
  } else if (tab === "activity") {
    // Owners only (the activity log is owner-only in the database too).
    const ids = [id, ...engs.map((e) => e.id), ...docs.map((d) => d.id), ...props.map((p) => p.id)];
    const { data: log } = await supabase.from("activity_log").select("id, occurred_at, actor_id, action, entity_type, details").in("entity_id", ids).order("occurred_at", { ascending: false }).limit(200);
    const WHAT: Record<string, string> = { clients: "Client record", engagements: "Engagement", documents: "Document", document_versions: "Document version", proposals: "Proposal" };
    const what = (e: { action: string; entity_type: string; details: unknown }): React.ReactNode => {
      if (e.entity_type === "clients" && e.action === "statements_confirmed") {
        const year = (e.details as { year?: number } | null)?.year;
        return year ? `Basis and users confirmed in the ${year} Closebook file` : "Basis and users confirmed in a Closebook file";
      }
      if (e.entity_type === "clients" && e.action === "update") {
        const lines = clientChanges(e.details);
        if (lines.length) return <ul className="grid gap-0.5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>;
      }
      return `${WHAT[e.entity_type] ?? e.entity_type} · ${e.action}`;
    };
    content = <section className="card overflow-x-auto p-0">{(log ?? []).length === 0 ? empty("No activity recorded for this client.") : (
      <table className="table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>{(log ?? []).map((e) => <tr key={e.id}><td className="whitespace-nowrap align-top text-muted">{formatDateTime(e.occurred_at)}</td><td className="align-top">{e.actor_id ? names.get(e.actor_id) ?? "Unknown" : "System"}</td><td>{what(e)}</td></tr>)}</tbody></table>)}</section>;
  } else {
    content = await overview();
  }

  // Overview: a read view (QuickBooks' customer page) with Edit on each card; ?edit= opens that card's form.
  async function overview(): Promise<React.ReactNode> {
    const back = `/clients/${id}`;
    const editing = editable ? (sp.edit === "details" ? "details" : sp.edit === "statements" && corp ? "statements" : "") : "";
    const users = statementUsers(c.statement_users);

    let details: React.ReactNode;
    if (editing === "details") {
      details = <ClientEditor key={c.status} id={id} initial={initial} verifiedOn={c.name_verified_on ? formatDate(c.name_verified_on) : ""} editable={editable} taxdomeManaged={!!c.taxdome_account_id} cancelHref={back} />;
    } else {
      const place = [c.city, [c.province === "OTHER" ? "" : c.province, c.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const address = [c.street_address, c.address_line2, place].filter(Boolean);
      details = (
        <section className="card">
          <CardHead title="Client details" editHref={editable ? `${back}?edit=details` : undefined} />
          <dl className="divide-y divide-sand-100">
            <Item term="Legal name">
              <span className="mr-2">{c.legal_name}</span>
              {c.name_verified
                ? <span className={`${CHIP} bg-success-soft text-success`}>Checked{c.name_verified_on ? ` ${formatDate(c.name_verified_on)}` : ""}</span>
                : <span className="text-xs text-warning">Not checked</span>}
            </Item>
            <Item term="Client type">{corp ? "Corporation" : "Individual"}</Item>
            {corp && <Item term="Entity type">{c.entity_type}</Item>}
            {corp && <Item term="Year end">{c.year_end_md}</Item>}
            <Item term={corp ? "Signing officer" : "Signs as"}>{[c.signing_officer, c.signer_title].filter(Boolean).join(", ")}</Item>
            <Item term="Salutation">{c.salutation}</Item>
            <Item term="Email">{c.email}</Item>
            <Item term="Address">{address.length ? address.map((l: string, i: number) => <span key={i} className="block">{l}</span>) : ""}</Item>
            <Item term="Status">{STATUS_WORD[c.status] ?? c.status}</Item>
            <Item term="Notes">{c.notes ? <span className="whitespace-pre-wrap">{c.notes}</span> : ""}</Item>
          </dl>
        </section>
      );
    }

    let statements: React.ReactNode = null;
    if (corp && editing === "statements") {
      statements = <StatementsEditor id={id} basis={c.basis} customWording={c.custom_basis_wording ?? ""} cancelHref={back}
        users={users.map((u) => ({ kind: u.kind === "lender" ? "lender" : "other", name: u.name, basis_needed: u.basis_needed ?? "" }))} />;
    } else if (corp) {
      // Last confirmed: the latest "statements_confirmed" in the activity log (owners), or the latest
      // acceptance record that kept a confirmation (Closebook viewers).
      type Confirmed = { year: string; by: string; at: string };
      const found: Confirmed[] = [];
      const [logR, accR, conflictR] = await Promise.all([
        access.is_owner ? supabase.from("activity_log").select("occurred_at, actor_id, details").eq("entity_type", "clients").eq("entity_id", id).eq("action", "statements_confirmed").order("occurred_at", { ascending: false }).limit(1) : null,
        canView(access, "closebook") ? supabase.from("cb_files").select("year_end, acc:cb_acceptance(confirmed)").eq("client_id", id) : null,
        access.is_owner ? supabase.from("client_user_conflicts").select("file_users, file:file_id(year_end)").eq("client_id", id).maybeSingle() : null,
      ]);
      for (const r of (logR?.data ?? []) as { occurred_at: string; actor_id: string | null; details: { year?: number } | null }[])
        found.push({ year: String(r.details?.year ?? ""), by: r.actor_id ?? "", at: r.occurred_at });
      for (const f of (accR?.data ?? []) as unknown as { year_end: string; acc: { confirmed: { by?: string; at?: string } | null } | { confirmed: { by?: string; at?: string } | null }[] | null }[]) {
        const acc = Array.isArray(f.acc) ? f.acc[0] : f.acc;
        if (acc?.confirmed?.at) found.push({ year: yearOf(f.year_end), by: acc.confirmed.by ?? "", at: acc.confirmed.at });
      }
      const last = found.sort((a, b) => b.at.localeCompare(a.at))[0];
      const readable = access.is_owner || canView(access, "closebook");
      const conflict = conflictR?.data as { file_users: unknown; file: { year_end: string } | { year_end: string }[] | null } | null | undefined;
      const conflictFile = conflict ? (Array.isArray(conflict.file) ? conflict.file[0] : conflict.file) : null;
      statements = (
        <section className="card">
          <CardHead title="Financial statements" editHref={editable ? `${back}?edit=statements` : undefined} />
          {conflict && (
            <p role="alert" className="mb-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              Users differ between this client and its {conflictFile ? `${yearOf(conflictFile.year_end)} ` : ""}Closebook file: {statementUsers(conflict.file_users).map(userLabel).join(", ") || "none"}. Edit the users here to decide.
            </p>
          )}
          <dl className="divide-y divide-sand-100">
            <Item term="Basis of accounting"><span className="whitespace-pre-wrap">{basisWords(c.basis, c.custom_basis_wording ?? "")}</span></Item>
            <Item term="Users of the statements">
              <ul className="grid gap-1">
                <li>Management</li>
                {users.map((u, i) => <li key={i}>{userLabel(u)}{u.basis_needed ? <span className="block text-xs text-ink-3">Basis needed: {u.basis_needed}</span> : null}</li>)}
              </ul>
            </Item>
            <Item term="Last confirmed">
              {last ? `In the ${last.year} Closebook file, by ${names.get(last.by) ?? "Unknown"}, ${formatDate(last.at)}`
                : readable ? "Not confirmed in a Closebook file yet" : <span className="text-ink-3">Shown to people with Closebook access</span>}
            </Item>
          </dl>
        </section>
      );
    }

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-6">{details}{statements}</div>
        <div className="grid content-start gap-6">
          {corp && (
            <section className="card">
              <h2 className="mb-2 font-semibold">TaxDome and T2 deadlines</h2>
              {c.taxdome_account_id ? (
                <ul className="mb-3 grid gap-1 text-sm">
                  <li>Business Number: {c.business_number || <span className="text-warning">none in TaxDome</span>}</li>
                  <li>Year-end: {c.year_end_md || <span className="text-warning">none in TaxDome</span>}</li>
                  <li>TaxDome tags: {(c.taxdome_tags ?? []).join(", ")}</li>
                  {tdLink && <li><a href={tdLink} target="_blank" rel="noreferrer" className="text-navy-700 underline">Open in TaxDome</a></li>}
                  <li className="text-xs text-muted">From TaxDome, last imported {c.taxdome_synced_at ? formatDate(c.taxdome_synced_at) : ""}.</li>
                </ul>
              ) : <p className="mb-3 text-sm text-muted">Not linked to TaxDome. Linked clients come from the TaxDome import.</p>}
              {lastYe && <p className="mb-3 text-sm">Year ending {formatDate(lastYe)}: balance due {formatDate(t2BalanceDue(lastYe, c.t2_balance_due_months === 3 ? 3 : 2))}, T2 due {formatDate(t2FilingDeadline(lastYe))}.</p>}
              <form action={saveT2Settings} className="grid gap-2 text-sm">
                <input type="hidden" name="id" value={id} />
                <fieldset disabled={!editable} className="grid gap-2">
                  <label className="flex items-center gap-2">Balance due
                    <select name="months" defaultValue={String(c.t2_balance_due_months)} className="input w-auto text-sm">
                      <option value="2">2 months after year-end</option><option value="3">3 months after year-end</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="exclude" defaultChecked={c.t2_exclude_deadlines} className="h-4 w-4 accent-navy-700" />Exclude from deadlines (inactive corporation)</label>
                  {editable && <button type="submit" className="btn-secondary w-fit">Save</button>}
                </fieldset>
              </form>
            </section>
          )}
          <section className="card">
            <h2 className="mb-2 font-semibold">Linked clients</h2>
            {links.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="grid gap-2 text-sm">{links.map((l, i) => <li key={i}><Link href={`/clients/${l.other!.id}`} className="text-navy-700 underline">{l.other!.legal_name}</Link> <span className="text-muted">· {l.rel}</span></li>)}</ul>
            )}
          </section>
        </div>
      </div>
    );
  }

  const newItems = [
    ...(editDocs ? [{ label: "New letter", href: letterHref }] : []),
    ...(editDocs && pricing ? [{ label: "New proposal", href: `/quotes/proposal?client=${id}` }] : []),
    ...(editCb ? [{ label: "New Closebook file", href: `/closebook/new?client=${id}` }] : []),
  ];
  const MSG: Record<string, string> = { saved: "Client saved.", statements: "Financial statements saved." };
  const msg = typeof sp.msg === "string" && MSG[sp.msg] ? MSG[sp.msg] : messageFrom(sp.msg);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-sand-200 pb-5">
        <div className="min-w-0">
          <p className={`${typeScale.caption} mb-1.5 text-ink-3`}>Client</p>
          <h1 className={typeScale.h1}>{c.legal_name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`${CHIP} ${c.status === "active" ? "bg-success-soft text-success" : c.status === "waiting_taxdome" ? "bg-warning-soft text-warning" : "bg-sand-100 text-ink-2"}`}>{STATUS_WORD[c.status] ?? c.status}</span>
            <span className={`${CHIP} bg-navy-50 text-navy-700`}>{corp ? `Corporation · ${c.entity_type}` : "Individual"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {tdLink && <a href={tdLink} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>Open in TaxDome</a>}
          <NewMenu items={newItems} />
        </div>
      </header>
      <Notice msg={msg} error={loadErrors.length ? loadErrors.join(" ") : messageFrom(sp.error)} />
      {c.status === "waiting_taxdome" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <p><b>Waiting for TaxDome.</b> Added when they signed in Studio. {corp ? "The next TaxDome import matches it (Business Number, then legal name) and makes it Active." : "The TaxDome import reads companies only: once the person's TaxDome account exists, mark it matched."}</p>
          {access.is_owner && <form action={markInTaxDome}><input type="hidden" name="id" value={id} /><button type="submit" className="btn-secondary h-8 px-3 text-sm">Mark as matched in TaxDome</button></form>}
        </div>
      )}
      <PageTabs label="Client" current={tab} tabs={tabs} />
      {content}
    </>
  );
}
