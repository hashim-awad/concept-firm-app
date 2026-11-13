import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { todayToronto } from "@/lib/dates";
import { BOOKS } from "@/lib/closebook/files";
import { createFile } from "../actions";

type Client = { id: string; legal_name: string; business_number: string; year_end_md: string; taxdome_tags: string[] };

// The most recent year-end on or before today, from the client's month and day ("12-31").
function lastYearEnd(md: string, today: string): string {
  if (!/^\d{2}-\d{2}$/.test(md)) return "";
  const y = Number(today.slice(0, 4));
  const fix = (yy: number) => { const [m, d] = md.split("-").map(Number); const last = new Date(Date.UTC(yy, m, 0)).getUTCDate(); return `${yy}-${md.slice(0, 2)}-${String(Math.min(d, last)).padStart(2, "0")}`; };
  return fix(y) <= today ? fix(y) : fix(y - 1);
}

// All files, New file (Phase 3 batch, section 1): 1 pick the client, 2 confirm the year-end,
// 3 file type and how the books are kept, 4 preparer and reviewer. (5, roll forward, comes with step 3.)
export default async function NewFilePage({ searchParams }: PageProps<"/closebook/new">) {
  const access = await requireAccess("closebook", "edit");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, { data: staff }] = await Promise.all([
    supabase.from("clients").select("id, legal_name, business_number, year_end_md, taxdome_tags").eq("kind", "corporation").eq("status", "active").order("legal_name"),
    supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const list = (clients ?? []) as Client[];
  const chosen = list.find((c) => c.id === sp.client);
  const people = (staff ?? []) as { id: string; full_name: string }[];
  const monthly = !!chosen?.taxdome_tags?.includes("BK");
  const yearEnd = chosen ? lastYearEnd(chosen.year_end_md, todayToronto()) : "";

  return (
    <>
      <Link href="/closebook/files" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />All files</Link>
      <PageHeader title="New file" description="One file per client per year-end. Pick the client first: their legal name, Business Number, year-end and TaxDome tags fill in." />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="year_end" className="label">2. Year-end</label>
              <input id="year_end" name="year_end" type="date" defaultValue={yearEnd} required className="input" /></div>
            <div><label htmlFor="year_start" className="label">Year started (only if not a full 12 months)</label>
              <input id="year_start" name="year_start" type="date" className="input" />
              <span className="text-xs text-muted">Leave blank for a full year.</span></div>
          </div>
          <div><label htmlFor="reason" className="label">Reason, if the year is not 12 months</label>
            <input id="reason" name="reason" maxLength={300} placeholder="For example: short first year, incorporated May 15" className="input" /></div>
          <fieldset className="grid gap-2">
            <legend className="label">3. File type{monthly ? " (tag BK: monthly suggested)" : ""}</legend>
            <label className="flex items-start gap-2 text-sm"><input type="radio" name="file_type" value="monthly" defaultChecked={monthly} required className="mt-0.5 h-4 w-4 accent-navy-700" /><span><b>Monthly</b>: Concept keeps the books in QuickBooks. The trial balance is imported and read-only; entries are made in QuickBooks.</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="radio" name="file_type" value="full" defaultChecked={!monthly} className="mt-0.5 h-4 w-4 accent-navy-700" /><span><b>Full</b>: year-end only. The trial balance is built or imported in Closebook, with entries here.</span></label>
          </fieldset>
          <div><label htmlFor="books" className="label">How the books are kept (full files)</label>
            <select id="books" name="books" defaultValue="statements" className="input">
              {Object.entries(BOOKS).filter(([k]) => k !== "concept_qbo").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="preparer" className="label">4. Preparer</label>
              <select id="preparer" name="preparer" defaultValue={access.staff_id} className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
            <div><label htmlFor="reviewer" className="label">Reviewer</label>
              <select id="reviewer" name="reviewer" defaultValue={access.staff_id} className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          </div>
          <button type="submit" className="btn w-fit">Start the file</button>
        </form>
      )}
    </>
  );
}
