import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { PageHeader } from "@/components/ds/primitives";
import { messageFrom } from "@/lib/messages";
import { todayToronto } from "@/lib/dates";
import { DATA_SOURCE, MONTHLY_READY, fullYearStart, nextDay, type DataSource } from "@/lib/closebook/files";
import { YearLine } from "./year-line";
import { createFile } from "../actions";
import { InfoTip } from "@/components/ds/info-tip";

type Client = { id: string; legal_name: string; business_number: string; year_end_md: string; taxdome_tags: string[] };

// The most recent year-end on or before today, from the client's month and day ("12-31").
function lastYearEnd(md: string, today: string): string {
  if (!/^\d{2}-\d{2}$/.test(md)) return "";
  const y = Number(today.slice(0, 4));
  const fix = (yy: number) => { const [m, d] = md.split("-").map(Number); const last = new Date(Date.UTC(yy, m, 0)).getUTCDate(); return `${yy}-${md.slice(0, 2)}-${String(Math.min(d, last)).padStart(2, "0")}`; };
  return fix(y) <= today ? fix(y) : fix(y - 1);
}

// New year-end file (Phase 3 batch, section 1; labels Hashim, Nov 15, 2026, benchmark CaseWare Cloud's
// "Create engagement" and ProFile's tax year dates): 1 pick the client, 2 the year (one line, Change
// for the dates), 3 data source, 4 preparer and reviewer.
export default async function NewFilePage({ searchParams }: PageProps<"/closebook/new">) {
  const access = await requireAccess("closebook", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, { data: staff }] = await Promise.all([
    supabase.from("clients").select("id, legal_name, business_number, year_end_md, taxdome_tags").eq("kind", "corporation").eq("status", "active").order("legal_name"),
    supabase.from("staff").select("id, full_name, role:roles!staff_role_id_fkey(cb_prepare, cb_review, role_permissions(area_key, level))").eq("is_active", true).order("full_name"),
  ]);
  const list = (clients ?? []) as Client[];
  const chosen = list.find((c) => c.id === sp.client);
  // R3a-1: the reviewer has the Review right; the preparer has Closebook Edit and the Prepare right (Settings, Team and roles).
  type Person = { id: string; full_name: string; role: { cb_prepare: boolean; cb_review: boolean; role_permissions: { area_key: string; level: string }[] } | null };
  const all = (staff ?? []) as unknown as Person[];
  const reviewers = all.filter((p) => !!p.role?.cb_review);
  const people = all.filter((p) => !!p.role?.cb_prepare && p.role.role_permissions.some((x) => x.area_key === "closebook" && x.level === "edit"));
  const yearEnd = chosen ? lastYearEnd(chosen.year_end_md, todayToronto()) : "";
  // The start is the day after the previous year end: the client's last file before this one, or a full year.
  const { data: prior } = chosen && yearEnd
    ? await supabase.from("cb_files").select("year_end").eq("client_id", chosen.id).lt("year_end", yearEnd).order("year_end", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const yearStart = yearEnd ? (prior?.year_end ? nextDay(prior.year_end as string) : fullYearStart(yearEnd)) : "";
  // Our QuickBooks file (monthly) is offered only once that route works end to end.
  const sources = (Object.keys(DATA_SOURCE) as DataSource[]).filter((k) => k !== "ours" || MONTHLY_READY);

  return (
    <>
      <Link href="/closebook/files" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />All files</Link>
      <PageHeader title={<span className="inline-flex items-start">New year-end file<InfoTip>One file per client per year-end. Pick the client first: their legal name, Business Number, year-end and TaxDome tags fill in.</InfoTip></span>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action="/closebook/new" className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-72 flex-1"><label htmlFor="client" className="label">1. Client</label>
          <select id="client" name="client" defaultValue={chosen?.id ?? ""} required className="input">
            <option value="" disabled>Choose a company</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
          </select></div>
        <button type="submit" className="btn-secondary">{chosen ? "Change client" : "Continue"}</button>
      </form>

      {chosen && (
        <form action={createFile} className="card grid gap-5">
          <input type="hidden" name="client" value={chosen.id} />
          <dl className="grid gap-x-6 gap-y-1 rounded-lg border border-sand-200 bg-sand-50 p-4 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Legal name</dt><dd className="font-medium">{chosen.legal_name}</dd>
            <dt className="text-muted">Business Number</dt><dd>{chosen.business_number || "Not in TaxDome yet"}</dd>
            <dt className="text-muted">Year-end</dt><dd>{chosen.year_end_md || "Not in TaxDome yet"}</dd>
            <dt className="text-muted">TaxDome tags</dt><dd>{chosen.taxdome_tags?.length ? chosen.taxdome_tags.join(", ") : "None"}</dd>
          </dl>
          <YearLine key={chosen.id} defaultStart={yearStart} defaultEnd={yearEnd} />
          <fieldset className="grid gap-2">
            <legend className="label">3. Data source</legend>
            {sources.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <input type="radio" name="data_source" value={k} required className="mt-0.5 h-4 w-4 accent-navy-700" />
                <span><b className="font-semibold">{DATA_SOURCE[k].label}</b><span className="block text-ink-2">{DATA_SOURCE[k].line}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="preparer" className="label">4. Preparer</label>
              <select id="preparer" name="preparer" defaultValue={access.staff_id} className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
            <div><span className="flex items-start"><label htmlFor="reviewer" className="label">Reviewer</label><InfoTip>Reviewers need the Review right (Settings, Team and roles).</InfoTip></span>
              <select id="reviewer" name="reviewer" defaultValue={reviewers.some((p) => p.id === access.staff_id) ? access.staff_id : reviewers[0]?.id} className="input">{reviewers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          </div>
          <button type="submit" className="btn w-fit">Start the file</button>
        </form>
      )}
    </>
  );
}
