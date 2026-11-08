import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { markProposal } from "./history-actions";

const TABS = [["engagements", "Engagements"], ["proposals", "Proposals"], ["vault", "Document vault"]] as const;
const KIND: Record<string, string> = { corporate_letter: "Corporate letter", t1_letter: "T1 letter", proposal: "Proposal" };

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const access = await requireAccess();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "engagements";
  const editable = canEdit(access, "documents");
  const supabase = await createClient();
  const seeDocs = canView(access, "documents");

  let body: React.ReactNode = <p className="p-5 text-sm text-muted">You do not have access to this list.</p>;
  if (tab === "engagements" && seeDocs) {
    const { data } = await supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_issued, el_signed, el_version").order("updated_at", { ascending: false }).limit(300);
    body = (data ?? []).length === 0 ? <p className="p-5 text-sm text-muted">No engagements yet.</p> : (
      <table className="table">
        <thead><tr><th>Engagement</th><th>Type</th><th>Year end</th><th>EL issued</th><th>EL signed</th><th>Status</th><th></th></tr></thead>
        <tbody>{(data ?? []).map((e) => (
          <tr key={e.id}>
            <td className="font-medium">{e.title}<span className="block text-xs text-muted">{e.el_version}</span></td><td>{e.type}</td><td>{formatDate(e.fiscal_year_end)}</td>
            <td>{formatDate(e.el_issued)}</td><td>{formatDate(e.el_signed)}</td><td>{e.status}</td>
            <td className="text-right text-sm"><Link href={`/documents/engagements/${e.id}`} className="text-navy-700 underline">{editable ? "Update" : "View"}</Link></td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (tab === "proposals" && seeDocs) {
    const { data } = await supabase.from("proposals").select("id, title, date_sent, valid_until, status, chosen_option, options_data").order("date_sent", { ascending: false }).limit(300);
    body = (data ?? []).length === 0 ? <p className="p-5 text-sm text-muted">No proposals recorded yet.</p> : (
      <table className="table">
        <thead><tr><th>Proposal</th><th>Sent</th><th>Valid until</th><th>Status</th><th>Option</th><th></th></tr></thead>
        <tbody>{(data ?? []).map((r) => {
          const opts = ((r.options_data as { o?: { n: string }[] } | null)?.o ?? []);
          return (
            <tr key={r.id}>
              <td className="font-medium">{r.title}</td><td>{formatDate(r.date_sent)}</td><td>{formatDate(r.valid_until)}</td><td>{r.status}</td><td>{r.chosen_option}</td>
              <td className="text-right text-sm">
                {editable && r.status === "Sent" && opts.length > 0 && (
                  <form action={markProposal} className="flex justify-end gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <select name="result" aria-label="Mark result" className="input h-8 w-auto text-sm" defaultValue="">
                      <option value="" disabled>Mark result</option>
                      {opts.map((o, i) => <option key={i} value={`acc:${i}`}>Accepted: {o.n}</option>)}
                      <option value="decl">Declined</option><option value="exp">Expired</option>
                    </select>
                    <button className="btn h-8 px-3 text-sm" type="submit">Save</button>
                  </form>
                )}
                {editable && r.status === "Accepted" && <Link href={`/documents/corporate-letter?proposal=${r.id}`} className="text-navy-700 underline">Create Corporate Letter</Link>}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    );
  }
  if (tab === "vault" && (seeDocs || canView(access, "vault"))) {
    const { data } = await supabase.from("documents").select("id, kind, title, status, current_version, updated_at").order("updated_at", { ascending: false }).limit(300);
    body = (data ?? []).length === 0 ? <p className="p-5 text-sm text-muted">Nothing in the vault yet. Every letter and proposal you download is filed here.</p> : (
      <table className="table">
        <thead><tr><th>Document</th><th>Type</th><th>Versions</th><th>Status</th><th>Last change</th></tr></thead>
        <tbody>{(data ?? []).map((d) => (
          <tr key={d.id}>
            <td><Link href={`/documents/vault/${d.id}`} className="font-medium text-navy-700 hover:underline">{d.title}</Link></td>
            <td>{KIND[d.kind]}</td><td>{d.current_version}</td><td className="capitalize">{d.status}</td><td>{formatDate(d.updated_at)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }

  return (
    <>
      <PageHeader title="Documents" description="Engagements, proposals and every PDF made in the app. Versions are permanent: a change makes a new version."
        actions={editable ? <>
          <Link href="/documents/corporate-letter" className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />Corporate letter</Link>
          <Link href="/documents/t1-letter" className={buttonClass("secondary")}>T1 letter</Link>
          <Link href="/documents/proposal" className={buttonClass("secondary")}>Proposal</Link>
        </> : undefined} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <nav className="mb-4 flex gap-1 border-b border-sand-200" aria-label="Document lists">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/documents?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-lime-500 text-navy-800" : "border-transparent text-ink-2 hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>
      <section className="card overflow-x-auto p-0">{body}</section>
    </>
  );
}
