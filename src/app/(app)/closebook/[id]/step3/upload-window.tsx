"use client";
// Closebook step 3, the upload window (round 22, Hashim, Nov 16, 2026; mock screens 3 and 7). Benchmark:
// QuickBooks Online "Upload from file": a window over the Banking page; files are read, then checked one by one
// before anything goes into the books. Many PDFs or photos at once (or a CSV); reading runs in the background,
// so the window can close. Each statement shows one status (point 9). "Import all that pass" lists them
// first (point 11); the done stage sums up and closes back to the page (point 12).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { confirmAction, notify } from "@/components/save-state";
import { UPLOAD_LABEL, type UploadStatus } from "@/lib/closebook/step3";
import type { S3Upload } from "@/lib/closebook/step3-server";
import { confirmStatementUploads, createStatementUploads, discardStatement, pollStatements, retryStatement } from "../../../statements/actions";
import { importChecked, setStatementTarget, skipStatement } from "../../step3-actions";

let storage: ReturnType<typeof createClient>["storage"] | null = null;
const browserStorage = () => (storage ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }).storage);
const OK_EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string | null) => (iso ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}` : "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const PILL: Record<UploadStatus, string> = {
  reading: "bg-navy-50 text-navy-700", ready: "bg-success-soft text-success", needs_look: "bg-warning-soft text-warning", no_digits: "bg-warning-soft text-warning",
  outside: "bg-sand-100 text-ink-2", already: "bg-sand-100 text-ink-2", skipped: "bg-sand-100 text-ink-2", wrong_account: "bg-danger-soft text-danger", no_account: "bg-danger-soft text-danger",
  failed: "bg-danger-soft text-danger", imported: "bg-success-soft text-success",
};
const ORDER: UploadStatus[] = ["ready", "needs_look", "no_digits", "reading", "wrong_account", "no_account", "outside", "already", "skipped", "failed", "imported"];

// What happened in this window, for the done stage (kept in the browser for the session).
type Session = { imported: Record<string, { lines: number; outside: number; to: string[] }>; moved: Record<string, string>; skipped: string[]; notImported: Record<string, string> };
const empty: Session = { imported: {}, moved: {}, skipped: [], notImported: {} };
const keyOf = (fileId: string, acc: string) => `s3-session:${fileId}:${acc}`;
const parse = (raw: string | null): Session => { try { return { ...empty, ...JSON.parse(raw || "{}") }; } catch { return empty; } };
export function readSession(fileId: string, acc: string): Session { try { return parse(sessionStorage.getItem(keyOf(fileId, acc))); } catch { return empty; } }
export function writeSession(fileId: string, acc: string, f: (s: Session) => Session) {
  try { sessionStorage.setItem(keyOf(fileId, acc), JSON.stringify(f(readSession(fileId, acc)))); window.dispatchEvent(new Event("s3-session")); } catch { /* the done stage shows less */ }
}
const subscribe = (cb: () => void) => { window.addEventListener("s3-session", cb); return () => window.removeEventListener("s3-session", cb); };
function useSession(fileId: string, acc: string): Session {
  const raw = useSyncExternalStore(subscribe, () => { try { return sessionStorage.getItem(keyOf(fileId, acc)) ?? ""; } catch { return ""; } }, () => "");
  return useMemo(() => parse(raw), [raw]);
}

export type Target = { id: string; label: string; kind: "bank" | "card"; last4: string | null } | null;

export function UploadWindow({ fileId, target, uploads, href, closeHref, editable, done, csvHref }: {
  fileId: string; target: Target; uploads: S3Upload[]; href: string; closeHref: string; editable: boolean; done: boolean; csvHref: string | null;
}) {
  const router = useRouter();
  const accKey = target?.id ?? "all";
  const session = useSession(fileId, accKey);
  const [pending, setPending] = useState<{ key: string; name: string; error: string | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mine = uploads.filter((u) => (target ? u.account === target.id || u.target_account === target.id : u.status !== "imported") || session.moved[u.id] || session.imported[u.id]);
  const rows = mine.filter((u) => u.state.status !== "imported" || session.imported[u.id])
    .sort((a, b) => ORDER.indexOf(a.state.status) - ORDER.indexOf(b.state.status) || (a.period_start ?? "").localeCompare(b.period_start ?? "") || a.file_name.localeCompare(b.file_name));
  const reading = rows.some((r) => r.state.status === "reading") || pending.some((p) => !p.error);

  // While anything reads, the list refreshes every few seconds (and wakes the reader if it stopped).
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(async () => { try { await pollStatements(fileId); } catch { /* next time */ } router.refresh(); }, 4000);
    return () => clearInterval(t);
  }, [reading, fileId, router]);

  const send = async (files: File[]) => {
    const good = files.filter((f) => OK_EXT.test(f.name)), bad = files.filter((f) => !OK_EXT.test(f.name));
    if (bad.length) notify(`Not uploaded: ${bad.map((f) => f.name).join(", ")}. Use PDF, JPG, PNG or HEIC files.`, "error");
    if (!good.length) return;
    const items = good.map((f, i) => ({ f, key: `${Date.now()}-${i}` }));
    setPending((p) => [...items.map((x) => ({ key: x.key, name: x.f.name, error: null })), ...p]);
    const fail = (key: string, error: string) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error } : x)));
    let made: Awaited<ReturnType<typeof createStatementUploads>>;
    try { made = await createStatementUploads(fileId, good.map((f) => ({ name: f.name, size: f.size, type: f.type }))); }
    catch { made = { ok: false, error: "The upload could not start. Check the connection and try again." }; }
    if (!made.ok) { const e = made.error; items.forEach((x) => fail(x.key, e)); return; }
    const store = browserStorage().from(made.bucket);
    const sent: { id: string; key: string }[] = [];
    await Promise.all(items.map(async (x, i) => {
      const u = made.ok ? made.uploads[i] : null;
      if (!u) return fail(x.key, "The file could not be sent. Upload it again.");
      try { const r = await store.uploadToSignedUrl(u.path, u.token, x.f, { contentType: u.contentType }); if (r.error) fail(x.key, `Not sent: ${r.error.message}`); else sent.push({ id: u.id, key: x.key }); }
      catch { fail(x.key, "The file could not be sent. Check the connection and upload it again."); }
    }));
    if (sent.length) {
      // The account the window is for, so a statement for another account is stopped (point 13).
      if (target) await setStatementTarget(sent.map((x) => x.id), target.id);
      const r = await confirmStatementUploads(sent.map((x) => x.id));
      if (!r.ok) notify(r.error, "error");
      setPending((p) => p.filter((x) => !sent.some((y) => y.key === x.key)));
    }
    router.refresh();
  };

  const act = async (id: string, f: () => Promise<{ ok: boolean; error?: string }>, note?: string) => {
    setBusy(id);
    try { const r = await f(); if (!r.ok) notify(r.error ?? "That did not work. Try again.", "error"); else if (note) notify(note); }
    finally { setBusy(null); router.refresh(); }
  };
  const pass = rows.filter((r) => r.state.status === "ready");
  const importAll = async () => {
    if (!pass.length) return;
    const ok = await confirmAction({ title: `Import ${plural(pass.length, "statement")}?`, confirm: `Import ${pass.length}`, body: (
      <div className="grid gap-2 text-sm"><p>These passed every check. Only their lines inside the year go into the books.</p>
        <ul className="list-disc pl-5">{pass.map((r) => <li key={r.id}>{r.file_name} · {short(r.period_start)} to {short(r.period_end)}</li>)}</ul></div>) });
    if (!ok) return;
    setBusy("all");
    for (const r of pass) {
      try {
        const res = await importChecked(r.id, target?.id ?? r.account, false);
        if (!res.ok) writeSession(fileId, accKey, (s) => ({ ...s, notImported: { ...s.notImported, [r.id]: res.error } }));
        else if (!res.imported) writeSession(fileId, accKey, (s) => ({ ...s, notImported: { ...s.notImported, [r.id]: "Some lines are already in this file. Check it one by one." } }));
        else writeSession(fileId, accKey, (s) => ({ ...s, imported: { ...s.imported, [r.id]: { lines: res.lines, outside: res.outside, to: res.accounts } } }));
      } catch { writeSession(fileId, accKey, (s) => ({ ...s, notImported: { ...s.notImported, [r.id]: "The import did not finish. Try again." } })); }
    }
    setBusy(null);
    router.push(`${href}&done=1`); router.refresh();
  };
  const firstToCheck = rows.find((r) => ["ready", "needs_look", "no_digits", "wrong_account", "no_account"].includes(r.state.status));
  const counts = ORDER.map((k) => [k, rows.filter((r) => r.state.status === k).length] as const).filter(([, n]) => n);

  if (done) return <DoneStage fileId={fileId} accKey={accKey} target={target} rows={mine} session={session} closeHref={closeHref} />;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-y-auto bg-navy-950/40 px-4 py-8" role="dialog" aria-modal="true" aria-label="Upload statements">
      <div className="flex min-h-[70vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3.5"><h2 className="text-[17px] font-semibold">Upload statements</h2>
          <span className="text-[13px] text-ink-3">{target ? target.label : "All accounts"}</span><span className="flex-1" />
          <Link href={closeHref} scroll={false} aria-label="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></Link></div>
        <div className="grid content-start gap-3.5 px-5 py-4">
          {editable && (
            <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}
              className={`flex cursor-pointer flex-wrap items-center gap-3.5 rounded-[10px] border-2 border-dashed px-4 py-3.5 text-[13.5px] ${over ? "border-navy-600 bg-navy-50" : "border-sand-300 hover:border-navy-300"}`}>
              <Upload className="h-5 w-5 text-ink-2" aria-hidden />
              <span>Drop statements here, or <b className="text-navy-700">choose files</b>. PDFs or photos, many at once. Reading runs in the background: you can close this window.</span>
              <input ref={input} type="file" multiple aria-label="Statement files" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
                className="sr-only" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; send(f); }} />
              <span className="flex-1" />
              {csvHref && <Link href={csvHref} scroll={false} onClick={(e) => e.stopPropagation()} className="btn-secondary h-9">Upload CSV</Link>}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2"><b className="text-[14px]">{plural(rows.length + pending.length, "file")}</b>
            {counts.map(([k, n]) => <span key={k} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[k]}`}>{n} {UPLOAD_LABEL[k].toLowerCase().replace(/: not needed$/, "")}</span>)}</div>
          <div className="overflow-hidden rounded-[10px] border border-sand-200">
            <table className="table table-compact">
              <thead><tr><th>File</th><th>Status</th><th>Account found</th><th>Period</th><th /></tr></thead>
              <tbody>
                {pending.map((p) => <tr key={p.key}><td><FileText className="mr-1.5 inline h-4 w-4 text-ink-3" aria-hidden />{p.name}</td>
                  <td>{p.error ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PILL.failed}`}>Failed</span> : <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${PILL.reading}`}><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Uploading</span>}</td>
                  <td /><td /><td className="text-[12.5px] text-danger">{p.error}</td></tr>)}
                {rows.map((r) => {
                  const st = r.state.status, grey = ["outside", "already", "skipped"].includes(st);
                  const f = r.found[0];
                  const open = ["ready", "needs_look", "no_digits", "wrong_account", "no_account", "imported"].includes(st);
                  const link = `${href}&check=${r.id}`;
                  const moved = session.moved[r.id];
                  return (
                    <tr key={r.id} className={grey ? "bg-sand-50 text-ink-3" : ""}>
                      <td><FileText className="mr-1.5 inline h-4 w-4 text-ink-3" aria-hidden />{open ? <Link href={link} scroll={false} className="hover:underline">{r.file_name}</Link> : r.file_name}</td>
                      <td>{moved ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PILL.reading}`}>Moved</span>
                        : <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${PILL[st]}`}>{st === "reading" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}{UPLOAD_LABEL[st]}</span>}</td>
                      <td className="text-[13px]">{f ? `${f.last4 ? `••• ${f.last4}` : "No last digits"} (${f.kind === "card" ? "card" : "bank account"})` : ""}</td>
                      <td className="text-[13px] whitespace-nowrap">{r.period_start ? `${short(r.period_start)} to ${short(r.period_end)}` : ""}</td>
                      <td className="text-right text-[12.5px]">
                        {moved ? `to ${moved}` : st === "ready" ? <>{plural(r.lines, "line")} · checks pass <Link href={link} scroll={false} className="ml-2 text-navy-700 underline">Check</Link></>
                        : st === "needs_look" ? <>{plural(r.review, "line")} for review <Link href={link} scroll={false} className="ml-2 text-navy-700 underline">Check</Link></>
                        : st === "no_digits" ? <>{r.state.reason} <Link href={link} scroll={false} className="ml-2 text-navy-700 underline">Check</Link></>
                        : st === "wrong_account" && r.state.other && editable ? <button type="button" disabled={busy === r.id} className="text-navy-700 underline"
                            onClick={() => act(r.id, () => setStatementTarget([r.id], r.state.other!.id), `Moved to ${r.state.other!.number} ${r.state.other!.name}.`).then(() => writeSession(fileId, accKey, (s) => ({ ...s, moved: { ...s.moved, [r.id]: `${r.state.other!.number} ${r.state.other!.name}` } })))}>
                            Move it to {r.state.other.number} {r.state.other.name}</button>
                        : st === "no_account" ? <>{r.state.reason} {editable && <Link href={`${href.replace(/&upload=[^&]*/, "")}&add=1&type=${f?.kind === "card" ? "card" : "chequing"}&last4=${f?.last4 ?? ""}&then=${encodeURIComponent(link)}`} scroll={false} className="ml-1 text-navy-700 underline">Add it?</Link>}</>
                        : st === "outside" && editable ? <button type="button" disabled={busy === r.id} onClick={() => act(r.id, () => skipStatement(r.id, true, null), "Skipped. It stays listed.").then(() => writeSession(fileId, accKey, (s) => ({ ...s, skipped: [...s.skipped, r.id] })))} className="btn-secondary h-7 px-2.5 text-[12.5px]">Skip</button>
                        : st === "skipped" && editable ? <button type="button" disabled={busy === r.id} onClick={() => act(r.id, () => skipStatement(r.id, false, r.review ? "needs_look" : "ready"))} className="text-navy-700 underline">Bring back</button>
                        : st === "already" ? <>{r.state.reason} {editable && <button type="button" onClick={async () => { if (await confirmAction({ title: "Remove this copy?", body: "The file and what was read are deleted. The statement already imported stays.", confirm: "Remove", danger: true })) act(r.id, () => discardStatement(r.id)); }} className="ml-1 text-danger underline">Remove</button>}</>
                        : st === "failed" ? <><span className="text-danger">{r.error || "The file could not be read."}</span> {editable && <><button type="button" disabled={busy === r.id} onClick={() => act(r.id, () => retryStatement(r.id))} className="btn-secondary ml-1 h-7 px-2.5 text-[12.5px]"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Retry</button>
                          <button type="button" disabled={busy === r.id} onClick={async () => { if (await confirmAction({ title: "Remove this file?", body: "The file is deleted. Nothing was imported from it.", confirm: "Remove", danger: true })) act(r.id, () => discardStatement(r.id)); }} className="ml-2 text-danger underline">Remove</button></>}</>
                        : st === "imported" && session.imported[r.id] ? `Imported: ${plural(session.imported[r.id].lines, "line")}` : ""}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && !pending.length && <tr><td colSpan={5} className="py-6 text-center text-[13px] text-ink-3">No statements here yet. Drop the PDFs or photos above.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-sand-200 bg-[#fcfbf8] px-5 py-3">
          <span className="text-[12.5px] text-ink-3">Nothing goes into the books until you import it.</span><span className="flex-1" />
          <Link href={closeHref} scroll={false} className="btn-secondary">Close</Link>
          {editable && <button type="button" disabled={!pass.length || busy === "all"} onClick={importAll} className="btn-secondary">{busy === "all" ? "Importing…" : `Import all that pass (${pass.length})`}</button>}
          {firstToCheck ? <Link href={`${href}&check=${firstToCheck.id}`} scroll={false} className="btn h-9">Check one by one</Link>
            : Object.keys(session.imported).length || session.skipped.length ? <Link href={`${href}&done=1`} scroll={false} className="btn h-9">Done</Link> : null}
        </div>
      </div>
    </div>
  );
}

function DoneStage({ fileId, accKey, target, rows, session, closeHref }: { fileId: string; accKey: string; target: Target; rows: S3Upload[]; session: Session; closeHref: string }) {
  const imported = rows.filter((r) => session.imported[r.id]);
  const lines = imported.reduce((n, r) => n + session.imported[r.id].lines, 0);
  const starts = imported.map((r) => r.period_start ?? "").filter(Boolean).sort(), ends = imported.map((r) => r.period_end ?? "").filter(Boolean).sort();
  const what = (r: S3Upload): [string, string, string] => {
    const im = session.imported[r.id];
    if (im) return ["Imported", PILL.imported, `${plural(im.lines, "line")} in the year${im.outside ? `, ${im.outside} outside the year not imported` : ""}`];
    if (session.moved[r.id]) return ["Moved", PILL.reading, `to ${session.moved[r.id]}, waiting to check there`];
    if (session.notImported[r.id]) return ["Not imported", PILL.failed, session.notImported[r.id]];
    const st = r.state.status;
    if (st === "skipped" || st === "outside") return ["Skipped", PILL.skipped, "outside the year"];
    if (st === "already") return ["Not imported", PILL.already, r.state.reason.toLowerCase().replace(/\.$/, "")];
    if (st === "reading") return ["Still reading", PILL.reading, "it shows on the card when ready"];
    if (st === "failed") return ["Failed", PILL.failed, "retry it from the card, or upload a clearer copy"];
    if (st === "imported") return ["Imported", PILL.imported, "before this window"];
    return ["Waiting to check", PILL.needs_look, "it stays on the card's list"];
  };
  const clear = () => { try { sessionStorage.removeItem(keyOf(fileId, accKey)); window.dispatchEvent(new Event("s3-session")); } catch { /* nothing kept */ } };
  const left = rows.filter((r) => ["ready", "needs_look", "reading", "no_digits"].includes(r.state.status)).length;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-y-auto bg-navy-950/40 px-4 py-10" role="dialog" aria-modal="true" aria-label="Upload statements: done">
      <div className="flex w-full max-w-[860px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3.5"><h2 className="text-[17px] font-semibold">Upload statements: done</h2>
          <span className="text-[13px] text-ink-3">{target?.label ?? "All accounts"}</span><span className="flex-1" />
          <Link href={closeHref} onClick={clear} scroll={false} aria-label="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></Link></div>
        <div className="grid gap-3 px-5 py-4">
          <p className="rounded-[10px] border border-success/30 bg-success-soft px-3.5 py-2.5 text-[13.5px] text-[#14532d]">
            <b>{imported.length ? `${plural(imported.length, "statement")} imported${target ? ` into ${target.label}` : ""}: ${plural(lines, "line")}.` : "Nothing was imported."}</b>
            {imported.length ? ` ${short(starts[0])} to ${short(ends[ends.length - 1])}.` : ""}</p>
          <div className="overflow-hidden rounded-[10px] border border-sand-200">
            <table className="table table-compact"><thead><tr><th>What happened</th><th>File</th><th /></tr></thead>
              <tbody>{rows.filter((r) => r.state.status !== "imported" || session.imported[r.id])
                .sort((a, b) => (a.period_start ?? "9999").localeCompare(b.period_start ?? "9999") || a.file_name.localeCompare(b.file_name)).map((r) => { const [w, cls, why] = what(r); return (
                <tr key={r.id} className={w === "Skipped" || w === "Not imported" && cls === PILL.already ? "bg-sand-50 text-ink-3" : ""}>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{w}</span></td>
                  <td className="text-[13px]">{r.file_name}{r.period_start ? ` · ${short(r.period_start)} to ${short(r.period_end)}` : ""}</td><td className="text-[12.5px]">{why}</td></tr>); })}</tbody></table>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-sand-200 bg-[#fcfbf8] px-5 py-3">
          <span className="text-[12.5px] text-ink-3">{left ? `Next on this card: check ${plural(left, "statement")}${rows.some((r) => r.state.status === "reading") ? " when they finish reading" : ""}.` : "Nothing left to check on this card."}</span>
          <span className="flex-1" /><Link href={closeHref} onClick={clear} scroll={false} className="btn h-9">Close</Link>
        </div>
      </div>
    </div>
  );
}
