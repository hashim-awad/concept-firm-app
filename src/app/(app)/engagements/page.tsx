import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { requireAccess, canView, canEdit, letterTypes, type Access } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, buttonClass } from "@/components/ds/primitives";
import { InfoTip } from "@/components/ds/info-tip";
import { Notice } from "@/components/ui";
import { PageTabs } from "@/components/page-tabs";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { cameFrom, engagementStatus } from "@/lib/engagements";
import { NewMenu } from "../clients/[id]/new-menu";
import { LetterTypeSelect } from "./letter-type-select";

type Row = { id: string; title: string; type: string; status: string; fiscal_year_end: string | null; el_signed: string | null; el_version: string; came_from: string;
  client_id: string | null; client2_id: string | null };
type Letter = { id: string; source: "studio" | "outside"; kind: string; letter_type: "corporate" | "t1"; status: string; status_label: string; client: string;
  client_id: string | null; letter: string; came_from: string; sent_at: string | null; signed_at: string | null; valid_until: string | null; lead_id: string | null };
type Sp = Record<string, string | string[] | undefined>;

const WAIT = ["sent", "viewed"];
const STATUS: Record<string, [string, string]> = {
  // UI1 colour rule (Q9): blue in progress, green done, amber needs a follow-up, grey closed.
  // Q9: the same words as Quotes (the tab's filter keeps its name, "Waiting for signature").
  sent: ["Sent", "bg-info-soft text-info"], viewed: ["Viewed", "bg-info-soft text-info"], withdrawn: ["Withdrawn", "bg-sand-100 text-[#3F4246]"],
  signed: ["Signed", "bg-success-soft text-success"], declined: ["Declined", "bg-sand-100 text-[#3F4246]"], expired: ["Expired", "bg-warning-soft text-warning"],
};
const TYPE_LABEL: Record<string, string> = { corporate: "Corporate", t1: "T1" };
const PILL = "rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

// Engagements (front office batch, section 9; round 19): two tabs. Engagements is one per client, year and
// service, created when a quote or letter is signed. Letters (TaxDome: one list for quotes and letters,
// with filters) is every letter, whatever the path, including letters sent or signed outside Studio and
// recorded on an engagement. Each person sees the letter types their role allows.
export default async function EngagementsPage({ searchParams }: PageProps<"/engagements">) {
  const access = await requireAccess();
  const seeEngagements = canView(access, "documents");
  const seeLetters = seeEngagements || canView(access, "leads");
  if (!seeLetters) redirect("/?error=no-permission");
  const sp = await searchParams;
  const tab = !seeEngagements || (sp.tab === "letters" && seeLetters) ? "letters" : "engagements";
  const supabase = await createClient();
  // Letters past their date are marked Expired before anything is counted.
  if (seeLetters) await supabase.rpc("expire_quotes");
  const { data: waitingCount } = seeLetters ? await supabase.rpc("letters_waiting_count") : { data: 0 };
  const waiting = (waitingCount as number | null) ?? 0;

  const types = letterTypes(access);
  const prepare = canEdit(access, "documents") && canView(access, "pricing") && types.length > 0;
  const newLetter = tab === "letters" && prepare ? (types.length === 1
    ? <Link href={`/engagement-letters/new?type=${types[0]}`} className={buttonClass("primary")}><FilePlus2 className="h-4 w-4" aria-hidden />New letter</Link>
    : <NewMenu label="New letter" items={[
        { label: "Corporate letter", href: "/engagement-letters/new?type=corporate" },
        { label: "T1 letter", href: "/engagement-letters/new?type=t1" },
      ]} />) : undefined;

  const tabs = [
    seeEngagements && { key: "engagements", href: "/engagements", label: "Engagements" },
    { key: "letters", href: "/engagements?tab=letters", label: <>Letters{waiting > 0 && <span className="ml-1.5 rounded-full bg-navy-50 px-1.5 py-0.5 text-[11px] font-semibold text-navy-700">{waiting} waiting</span>}</> },
  ].filter(Boolean) as { key: string; href: string; label: React.ReactNode }[];

  return (
    <>
      <PageHeader
        title={<>Engagements<InfoTip label="About Engagements">
          One engagement per client, year and service. Created automatically when a quote or letter is signed. Admins use Update for older engagements, status changes and ending an engagement.
          {" "}Letters lists every letter, whatever the path. &ldquo;Outside Studio&rdquo; means the letter was sent or signed outside Studio and recorded on its engagement. Its dates come from the engagement.
          {" "}&ldquo;New letter&rdquo; is for clients who never go through a quote: renewals, a new service, a changed fee. A Final letter is sent for online signing; Download PDF stays in the Letter Builder.
        </InfoTip></>}
        actions={newLetter} />
      {tabs.length > 1 && <PageTabs label="Engagements" current={tab} tabs={tabs} />}
      {tab === "letters" ? <LettersTab sp={sp} access={access} /> : <EngagementsTab sp={sp} access={access} />}
    </>
  );
}

async function EngagementsTab({ sp, access }: { sp: Sp; access: Access }) {
  const supabase = await createClient();
  // Plain reads, no embedded joins: the names come from a second read, and a failed read shows its error.
  const { data, error } = await supabase.from("engagements").select("id, title, type, status, fiscal_year_end, el_signed, el_version, came_from, client_id, client2_id")
    .order("fiscal_year_end", { ascending: false, nullsFirst: false }).limit(500);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.flatMap((r) => [r.client_id, r.client2_id]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  let nameError: string | null = null;
  if (ids.length) {
    const { data: cs, error: ce } = await supabase.from("clients").select("id, legal_name").in("id", ids);
    for (const c of cs ?? []) names.set(c.id, c.legal_name);
    if (ce) nameError = ce.message;
  }
  const loadError = error ? `Engagements could not be read: ${error.message}` : nameError ? `Client names could not be read: ${nameError}` : null;
  return (
    <>
      <Notice msg={messageFrom(sp.msg)} error={loadError ?? messageFrom(sp.error)} />
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 && !error ? <p className="p-5 text-sm text-muted">No engagements yet. A signed quote or letter creates one.</p> : (
          <table className="table">
            <thead><tr><th>Engagement</th><th>Client</th><th>Service</th><th>Year-end</th><th>Came from</th><th>Letter signed</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((e) => {
              const st = engagementStatus(e.status);
              return (
                <tr key={e.id}>
                  <td className="font-medium">{e.title}</td>
                  <td>{e.client_id ? <Link href={`/clients/${e.client_id}`} className="text-navy-700 hover:underline">{names.get(e.client_id) ?? "Client"}</Link> : ""}
                    {e.client2_id && <> and <Link href={`/clients/${e.client2_id}`} className="text-navy-700 hover:underline">{names.get(e.client2_id) ?? "Client"}</Link></>}</td>
                  <td>{e.type}</td><td className="whitespace-nowrap">{formatDate(e.fiscal_year_end)}</td><td>{cameFrom(e)}</td><td className="whitespace-nowrap">{formatDate(e.el_signed)}</td>
                  <td><span className={`${PILL} ${st.cls}`}>{st.label}</span></td>
                  <td className="text-right text-sm"><Link href={`/documents/engagements/${e.id}`} className="text-navy-700 underline">{(access.admin && access.permissions.documents === "edit") ? "Update" : "View"}</Link></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

async function LettersTab({ sp, access }: { sp: Sp; access: Access }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("letter_list");
  const list = (data ?? []) as Letter[];
  // The types this person may see: their role's letter types. Owners see all. Round 19: monthly quotes are
  // not a letter type; a signed one is listed as a Corporate letter that came from "Monthly quote".
  const allowed = letterTypes(access);
  const type = allowed.find((t) => t === sp.type) ?? "all";
  const status = sp.status === "signed" ? "signed" : sp.status === "all" ? "all" : "waiting";
  const href = (s: string, t: string) => `/engagements?tab=letters${s === "waiting" ? "" : `&status=${s}`}${t === "all" ? "" : `&type=${t}`}`;
  const ofType = type === "all" ? list : list.filter((r) => r.letter_type === type);
  const waiting = ofType.filter((r) => WAIT.includes(r.status));
  // All is every row the list returns: everything in Waiting and Signed, Outside Studio included.
  const rows = status === "waiting" ? waiting : status === "signed" ? ofType.filter((r) => r.status === "signed") : ofType;
  const open = (r: Letter) => r.source === "outside" ? `/documents/engagements/${r.id}`
    : r.kind === "letter" ? `/engagement-letters/${r.id}` : r.kind === "proposal" ? `/quotes/${r.id}` : r.lead_id ? `/leads/${r.lead_id}/quote` : "/quotes";
  const statuses: [string, string][] = [["waiting", `Waiting for signature (${waiting.length})`], ["signed", "Signed"], ["all", "All"]];
  return (
    <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error) ?? (error ? `Letters could not be read: ${error.message}` : undefined)} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Status" className="inline-flex rounded-lg border border-sand-200 bg-surface p-0.5">
          {statuses.map(([k, l]) => (
            <Link key={k} href={href(k, type)} aria-current={status === k ? "page" : undefined}
              className={`rounded-md px-3 py-1 text-[13px] font-medium ${status === k ? "bg-navy-700 text-white" : "text-ink-2 hover:text-ink"}`}>{l}</Link>
          ))}
        </div>
        {allowed.length > 1 ? (
          <LetterTypeSelect value={type} options={[{ value: "all", label: "All types", href: href(status, "all") },
            ...allowed.map((t) => ({ value: t, label: TYPE_LABEL[t], href: href(status, t) }))]} />
        ) : allowed.length === 1 ? (
          <p className="text-[13px] text-ink-2"><span className="font-medium">Type:</span> {TYPE_LABEL[allowed[0]]} (your role)</p>
        ) : null}
      </div>
      <section className="card overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">{status === "waiting" ? "No letters are waiting for a signature." : "No letters here yet."}</p> : (
          <table className="table">
            <thead><tr><th>Client</th><th>Letter</th><th>Type</th><th>Came from</th><th>Sent</th><th>Signed</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => {
              const [label, cls] = r.status === "other" ? [engagementStatus(r.status_label).label, "bg-sand-100 text-ink-3"] : STATUS[r.status] ?? [r.status, "bg-sand-100 text-ink-3"];
              return (
                <tr key={`${r.source}-${r.id}`}>
                  <td><Link href={open(r)} className="font-medium text-navy-700 hover:underline">{r.client}</Link>
                    {r.source === "outside" && <span className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-purple-700">Outside Studio</span>}</td>
                  <td>{r.letter}</td>
                  <td>{TYPE_LABEL[r.letter_type] ?? r.letter_type}</td>
                  <td>{r.came_from}</td>
                  <td className="whitespace-nowrap">{formatDate(r.sent_at)}</td>
                  <td className="whitespace-nowrap">{r.signed_at ? formatDate(r.signed_at) : ""}</td>
                  <td><span className={`${PILL} ${cls}`}>{label}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
