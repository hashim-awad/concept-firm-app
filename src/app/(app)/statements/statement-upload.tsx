"use client";
// Round 20 (Hashim, Nov 15, 2026; mock 01): upload PDF statements and photos, many at once. Each file
// becomes its own background job; the list polls every few seconds while any is reading, and the user can
// leave and come back (the server loads the list again). Used on Closebook step 3 (fileId) and on the
// standalone tool (fileId null), which adds a format choice and "Download all".
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileText, Upload } from "lucide-react";
import type { StatementRow } from "@/lib/statements/server";
import { createClient } from "@supabase/supabase-js";
import { confirmStatementUploads, createStatementUploads, discardStatement, doneStatements, pollStatements, retryStatement } from "./actions";
import { StatementList, type PendingUpload } from "./statement-list";

// The browser's own storage client, only to send files to the signed upload links the server made.
let storage: ReturnType<typeof createClient>["storage"] | null = null;
const browserStorage = () => (storage ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }).storage);

const OK_EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
const POLL_MS = 4000;
// Files go up a few at a time.
const AT_ONCE = 3;

export function StatementImport({ fileId, initial, canEdit, csvHref, startOpen = false, standalone = false }: {
  fileId: string | null; initial: StatementRow[]; canEdit: boolean; csvHref?: string; startOpen?: boolean; standalone?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [open, setOpen] = useState(startOpen || standalone || initial.length > 0);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const input = useRef<HTMLInputElement>(null);
  const polling = useRef(false);

  // The server's list is the truth; a fresh render (router.refresh) brings it in.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setRows(initial); }

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const r = await pollStatements(fileId);
      if (r.ok) setRows(r.rows);
    } catch { /* the next poll tries again */ } finally { polling.current = false; }
  }, [fileId]);

  const reading = rows.some((r) => r.status === "queued" || r.status === "reading");
  const uploading = pending.some((p) => !p.error);
  useEffect(() => {
    if (!reading && !uploading) return;
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [reading, uploading, poll]);

  const send = async (files: File[]) => {
    setErr(null);
    const bad = files.filter((f) => !OK_EXT.test(f.name));
    const good = files.filter((f) => OK_EXT.test(f.name));
    if (bad.length) setErr(`Not uploaded: ${bad.map((f) => f.name).join(", ")}. Use PDF, JPG, PNG or HEIC files.`);
    if (!good.length) return;
    const items = good.map((f, i) => ({ f, key: `${Date.now()}-${i}-${f.name}` }));
    setPending((p) => [...items.map(({ f, key }) => ({ key, name: f.name, error: null })), ...p]);
    const failed = (key: string, error: string) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error } : x)));
    const done = (keys: string[]) => setPending((p) => p.filter((x) => !keys.includes(x.key)));
    // Straight to storage (no server request carries the file, so large scans work on Vercel too):
    // 1. the server makes the jobs and a signed upload link per file; 2. the browser sends each file;
    // 3. the server checks they arrived and queues them for reading.
    let made: Awaited<ReturnType<typeof createStatementUploads>>;
    try { made = await createStatementUploads(fileId, good.map((f) => ({ name: f.name, size: f.size, type: f.type }))); }
    catch { made = { ok: false, error: "The upload could not start. Check the connection and try again." }; }
    if (!made.ok) { const e = made.error; items.forEach(({ key }) => failed(key, e)); return; }
    const store = browserStorage().from(made.bucket);
    const sent: { id: string; key: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        const { f, key } = items[i], u = made.ok ? made.uploads[i] : null;
        if (!u) { failed(key, "The file could not be sent. Upload it again."); continue; }
        try {
          const r = await store.uploadToSignedUrl(u.path, u.token, f, { contentType: u.contentType });
          if (r.error) failed(key, `The file could not be sent: ${r.error.message}. Upload it again.`);
          else sent.push({ id: u.id, key });
        } catch { failed(key, "The file could not be sent. Check the connection and upload it again."); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, worker));
    if (sent.length) {
      try {
        const r = await confirmStatementUploads(sent.map((x) => x.id));
        if (!r.ok) setErr(r.error);
      } catch { setErr("The files were sent but could not be queued. Refresh the page to see them."); }
      done(sent.map((x) => x.key));
    }
    await poll();
  };

  const act = async (id: string, f: (id: string) => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id); setErr(null);
    try {
      const r = await f(id);
      if (!r.ok) setErr(r.error ?? "That did not work. Try again.");
    } finally { setBusy(null); await poll(); }
  };

  // Standalone: every statement that balances can be downloaded together.
  const downloadable = rows.filter((r) => (r.status === "ready" || r.status === "needs_look") && r.difference_cents === 0);
  const downloadAll = () => {
    if (!downloadable.length) return;
    const a = document.createElement("a");
    a.href = `/api/statements/download-all?ids=${downloadable.map((r) => r.id).join(",")}&format=${format}`;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
  };
  // Done (fix, Hashim, Nov 15, 2026): every statement on this page is deleted at once.
  const done = async () => {
    if (!rows.length) return;
    if (!confirm(`Delete all ${rows.length} statement${rows.length === 1 ? "" : "s"} on this page? Download what you need first.`)) return;
    setBusy("done"); setErr(null);
    try {
      const r = await doneStatements();
      if (!r.ok) setErr(r.error);
    } finally { setBusy(null); await poll(); router.refresh(); }
  };

  const dropZone = (
    <div className="grid gap-3 rounded-[var(--radius-ds)] border border-sand-200 bg-white p-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (canEdit) send([...e.dataTransfer.files]); }}
        className={`grid cursor-pointer justify-items-center gap-1 rounded-[var(--radius-ds)] border-2 border-dashed px-5 py-6 text-center text-sm text-ink-2 transition-colors ${over ? "border-navy-600 bg-navy-50" : "border-sand-300 hover:border-navy-300"}`}>
        <Upload className="mb-1 h-6 w-6 text-ink-2" aria-hidden />
        <span>Drop statements here, or <span className="font-semibold text-navy-700">choose files</span></span>
        <span className="text-[12.5px] text-ink-3">PDF, or photos (JPG, PNG, HEIC). Many at once: a year is 12 or more per account. Locked PDFs with no password are unlocked first.</span>
        <input ref={input} type="file" multiple disabled={!canEdit} aria-label="Statement files"
          accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
          className="sr-only" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; send(f); }} />
      </label>
      {standalone ? (
        <p className="text-[12.5px] leading-relaxed text-ink-2">Each statement is read on its own in the background. You can leave this page: <b>My day</b> and this page show when statements are ready.</p>
      ) : <>
        <p className="text-[12.5px] leading-relaxed text-ink-2">Each statement is read on its own in the background. You can leave this page: <b>My day</b> and step 3 show when statements are ready to check.</p>
        <p className="text-[12px] leading-relaxed text-ink-3">The account is found from each statement&rsquo;s last digits and matched to this file&rsquo;s bank accounts on the Verify screen.</p>
      </>}
    </div>
  );

  return (
    <div className="grid gap-3">
      {!standalone && (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-semibold text-ink">Import bank statements</h2>
          <span className="flex-1" />
          {canEdit && csvHref && <Link href={csvHref} scroll={false} className="btn-secondary"><Upload className="h-4 w-4" aria-hidden />Upload CSV</Link>}
          {canEdit && <button type="button" className="btn h-9" onClick={() => { setOpen(true); setTimeout(() => input.current?.click(), 0); }}>
            <FileText className="h-4 w-4" aria-hidden />Upload PDF statements</button>}
        </div>
      )}
      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {standalone && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-ds)] border border-sand-200 bg-white px-4 py-2.5 text-sm">
          <span className="font-medium">Download as</span>
          <span className="inline-flex overflow-hidden rounded-md border border-sand-300">
            {(["csv", "xlsx"] as const).map((v) => (
              <label key={v} className="cursor-pointer px-3 py-1 has-[:checked]:bg-navy-700 has-[:checked]:text-white [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-300">
                <input type="radio" name="format" value={v} checked={format === v} onChange={() => setFormat(v)} className="sr-only" />{v === "csv" ? "CSV" : "Excel"}
              </label>
            ))}
          </span>
          <span className="flex-1" />
          <span className="text-[12.5px] text-ink-3">{downloadable.length ? `${downloadable.length} ready to download` : "Statements download when the difference is 0.00."}</span>
          <button type="button" className="btn h-9" disabled={!downloadable.length} onClick={downloadAll}><Download className="h-4 w-4" aria-hidden />Download all</button>
          <button type="button" className="btn-secondary h-9" disabled={!rows.length || busy === "done"} onClick={done}>Done</button>
        </div>
      )}
      {open && (
        <div className="grid items-start gap-4 lg:grid-cols-[2fr_5fr]">
          {canEdit ? dropZone : <p className="text-sm text-ink-3">You can see the statements but not upload them.</p>}
          <StatementList rows={rows} pending={pending} canEdit={canEdit} busy={busy} standalone={standalone}
            onRetry={(id) => act(id, retryStatement)}
            onRemove={(id) => { if (confirm("Remove this statement? The file and what was read are deleted.")) act(id, discardStatement); }}
            onDismiss={(key) => setPending((p) => p.filter((x) => x.key !== key))} />
        </div>
      )}
    </div>
  );
}
