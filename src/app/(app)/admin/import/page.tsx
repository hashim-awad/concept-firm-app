import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { formatDateTime } from "@/lib/dates";
import { floorCorrections } from "@/lib/import/run";
import { ActionButton, ImportForm } from "./import-forms";
import { applyFloorCorrections, regenerateAction } from "./actions";

export default async function ImportPage() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: runs }, fc, { count: engs }, { count: regen }] = await Promise.all([
    supabase.from("import_runs").select("id, source, file_name, dry_run, counts, created_at").order("created_at", { ascending: false }).limit(15),
    floorCorrections(supabase),
    // Letter inputs carry fees, so they are read through engagement_fees() (Pricing permission).
    Promise.all([supabase.rpc("engagement_fees"), supabase.from("engagements").select("id, type")]).then(([f, e]) => {
      const corp = new Set((e.data ?? []).filter((x) => x.type !== "T1 personal").map((x) => x.id));
      return { count: ((f.data ?? []) as { id: string; letter_data: unknown }[]).filter((x) => x.letter_data != null && corp.has(x.id)).length };
    }),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "regenerated"),
  ]);
  return (
    <>
      <PageHeader title="Import from Studio" description="Owners only. Studio's data comes in once, from CSV files you export from Notion. The files are read in memory and never stored. Client data never passes through the app's code or this build conversation." />

      <section className="card mb-6 space-y-2 text-sm">
        <h2 className="text-base font-semibold">Steps, in this order</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Notion, open each Studio database, then the menu (three dots), Export, format Markdown &amp; CSV. Unzip the download.</li>
          <li>Import <b>Price Floors</b>, then <b>Service Catalog</b>, then <b>Clients</b>, then <b>Engagements</b>, then <b>Proposals</b>. Engagements and Proposals link to clients by legal name, so Clients go first.</li>
          <li>For each file: choose it, read the check (counts and problems), then press <b>Import</b>. Running a file again adds only rows not already in the app.</li>
          <li>Then regenerate past letters and proposals, and apply the agreed floor corrections (below).</li>
        </ol>
      </section>

      <ImportForm />

      <section className="card mt-6 space-y-3">
        <h2 className="font-semibold">Past letters and proposals (decision 28)</h2>
        <p className="text-sm text-muted">
          Rebuilds the PDF of each past corporate letter and sent proposal from Studio&rsquo;s saved data and files it in the vault. Every page says &ldquo;Regenerated from Studio records, not the signed original&rdquo;. No signature image is placed on them. Past T1 letters come in as records only. Studio did not save a proposal&rsquo;s &ldquo;What we heard&rdquo; lines, so those are blank on regenerated proposals.
        </p>
        <p className="text-sm">Corporate engagements with saved letter data: {engs ?? 0}. Regenerated documents in the vault: {regen ?? 0}.</p>
        <ActionButton label="Regenerate the next 15" run={regenerateAction} />
      </section>

      <section className="card mt-6 space-y-3">
        <h2 className="font-semibold">Price Floors corrections (decision 26)</h2>
        <p className="text-sm text-muted">Recorded as price-book changes after the import, so the activity log shows the Studio value and the corrected value.</p>
        {fc.missing.length > 0 && <p className="text-sm text-danger">Not in the app yet: {fc.missing.join(", ")}. Import Price Floors first.</p>}
        {fc.changes.length === 0 ? <p className="text-sm">Nothing to change.</p> : (
          <>
            <table className="table text-sm"><thead><tr><th>Offer</th><th>Field</th><th>Now</th><th>Will be</th></tr></thead>
              <tbody>{fc.changes.map((c, i) => <tr key={i}><td>{c.offer}</td><td>{c.field}</td><td>{String(c.from ?? "")}</td><td className="font-medium">{String(c.to)}</td></tr>)}</tbody></table>
            <ActionButton label="Apply these corrections" run={applyFloorCorrections} confirm="Apply the floor corrections shown?" />
          </>
        )}
      </section>

      <section className="card mt-6 overflow-x-auto p-0">
        <h2 className="px-5 pt-4 pb-2 font-semibold">Recent runs</h2>
        {(runs ?? []).length === 0 ? <p className="px-5 pb-4 text-sm text-muted">None yet.</p> : (
          <table className="table text-sm"><thead><tr><th>When</th><th>Source</th><th>File</th><th>Kind</th><th>Counts</th></tr></thead>
            <tbody>{(runs ?? []).map((r) => (
              <tr key={r.id}><td>{formatDateTime(r.created_at)}</td><td>{r.source}</td><td>{r.file_name}</td><td>{r.dry_run ? "Check" : "Import"}</td>
                <td className="text-xs">{Object.entries(r.counts as Record<string, number>).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}</td></tr>
            ))}</tbody></table>
        )}
      </section>
    </>
  );
}
