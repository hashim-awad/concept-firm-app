import { SettingsShell } from "../settings-shell";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, todayToronto } from "@/lib/dates";

// Download full export (decision 9): Hashim downloads it once a month and keeps it in the firm's
// secure storage. Supabase backs up the database daily; this adds the stored files.
export default async function ExportPage() {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "last_full_export").maybeSingle();
  const last = data?.value as { at?: string; tables?: number; rows?: number; files?: number } | undefined;
  // Whole days between the export's date and today (both as Toronto calendar dates).
  const days = last?.at ? Math.round((Date.parse(todayToronto()) - Date.parse(new Date(last.at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }))) / 86_400_000) : null;
  return (
    <SettingsShell title="Download full export" help={<>
      <p>One ZIP file with every table and every stored file. Download it once a month.</p>
      <h4>What it holds</h4>
      <ul className="list-disc space-y-1 pl-5">
        <li>Every table, exactly as stored (JSON), and the same tables for Excel (CSV).</li>
        <li>Every stored file: the vault PDFs, signed quotes and the signature image.</li>
        <li>A manifest with each file&rsquo;s size and fingerprint, and a README.</li>
      </ul>
      <p>Supabase keeps daily database backups, but they do not include stored files. This export does.</p>
      <p>Owners only.</p>
    </>}>
      <section className="card grid gap-4">
        <p className="text-sm">
          {last?.at
            ? <>Last export: <b>{formatDateTime(last.at)}</b> ({last.tables} tables, {last.rows} rows, {last.files} files).{days !== null && days > 31 && <span className="text-warning"> That is {days} days ago. Download a new one.</span>}</>
            : <span className="text-warning">No export downloaded yet.</span>}
        </p>
        <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">The file holds client information. Save it only in the firm&rsquo;s secure storage, never on a personal device or in email.</p>
        <a href="/admin/export/download" download className="btn w-fit">Download full export</a>
        <p className="text-xs text-muted">It can take a minute or two. Keep this page open until the download finishes.</p>
      </section>
    </SettingsShell>
  );
}
