"use client";
// Round 24 (Hashim, Nov 16, 2026): the control rules for statements and lines. A statement is a source document and
// is never deleted; a mistake is excluded, with a reason, and stays visible. Benchmark: QuickBooks Online's bank
// feed ("Exclude", "Undo", the bank detail kept beside what the bookkeeper adds). Each window says one thing and has
// one main button. A signed 3.2 or 3.3 asks first (guard.ts).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { confirmAction, notify } from "@/components/save-state";
import { confirmStatementUploads, createStatementUploads, pollStatements } from "../../../statements/actions";
import { setAccountCoverage } from "../../step3-actions";
import { readStatementsAgain } from "../../fix-actions";
import { excludeStatement, markReplacement, purgeStatement, replaceStatementFile, restoreStatement, setLineDate, setLineMemo, type Blocker } from "../../banking-actions";
import { Win } from "./windows";
import { date, money } from "./banking-ui";
import { guarded, isLockRefusal } from "./guard";
import { REASONS } from "@/lib/closebook/feed";

let storage: ReturnType<typeof createClient>["storage"] | null = null;
const browserStorage = () => (storage ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }).storage);


// ---------- Exclude statement (rule 9): a reason is required; refused while a line is in the books.
export function ExcludeWindow({ fileId, statement, title, sub, closeHref, lineHref, explainHref }: {
  fileId: string; statement: string; title: string; sub: string; closeHref: string;
  lineHref: string;      // step 4, with &line=<id> added
  explainHref: string;   // 3.3's Explain window for this account
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const r = await guarded((confirm) => excludeStatement(fileId, statement, reason, note, confirm));
      if (!r) return;
      if (!r.ok) { if ("blockers" in r && r.blockers.length) setBlockers(r.blockers); else if (isLockRefusal(r.error)) setLocked(r.error); else notify(r.error, "error"); return; }
      notify(`Statement excluded. ${r.lines} line${r.lines === 1 ? "" : "s"} left the feed.`);
      router.push(closeHref); router.refresh();
    } finally { setBusy(false); }
  };
  if (locked) return <LockedWindow title={title} sub={sub} closeHref={closeHref} text={locked} />;
  const what = (b: Blocker) => (b.kind === "transfer" ? "Transfer" : b.kind === "outstanding" ? "Clears an outstanding item" : "Coded");
  return (
    <Win title={title} sub={sub} closeHref={closeHref} width={600} footer={<>
      <span className="flex-1" /><Link href={closeHref} scroll={false} className="btn-secondary">Cancel</Link>
      <button type="button" onClick={go} disabled={busy || !reason || (reason === "other" && !note.trim())} className="btn h-9">Exclude</button></>}>
      {blockers ? (
        <div className="grid gap-2 rounded-[var(--radius-ds)] border border-danger/30 bg-danger-soft/50 px-4 py-3" role="alert">
          <b className="text-[14px]">Not excluded. Undo these {blockers.length} line{blockers.length === 1 ? "" : "s"} first:</b>
          <ul className="grid gap-1 text-[13.5px]">{blockers.map((b) => (
            <li key={b.id} className="flex flex-wrap gap-x-2"><span className="tabular-nums">{date(b.date)}</span><span>{b.description}</span>
              <span className="tabular-nums">{money(Math.round(Number(b.amount) * 100))}</span><span className="text-ink-3">· {what(b)}</span>
              <Link href={b.kind === "outstanding" ? explainHref : `${lineHref}${b.id}`} className="text-navy-700 underline">Open</Link></li>))}</ul>
        </div>
      ) : null}
      <fieldset className="grid gap-2"><legend className="mb-1 text-[14px] font-semibold">Why is it excluded?</legend>
        {REASONS.map((r) => (
          <label key={r.key} className="flex items-center gap-2 text-[14.5px]"><input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />{r.label}</label>
        ))}
        {reason === "other" && <input aria-label="Say why" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Say why" className="input h-9" />}
      </fieldset>
      <p className="text-[13.5px] text-ink-2">Its lines leave the feed and post nothing. The statement stays in View statements, under Excluded.</p>
    </Win>
  );
}

// ---------- Restore and Purge, on an excluded statement (rules 10, 11)
export function ExcludedActions({ fileId, statement, canPurge }: { fileId: string; statement: string; canPurge: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    setBusy(true);
    try {
      const r = await guarded((confirm) => restoreStatement(fileId, statement, confirm));
      if (!r) return;
      if (!r.ok) { notify(r.error, "error"); return; }
      notify("Statement restored."); router.refresh();
    } finally { setBusy(false); }
  };
  const purge = async () => {
    if (!(await confirmAction({ title: "Purge this statement?", body: "This erases another client's data from this file. It can't be undone.", confirm: "Purge", danger: true }))) return;
    setBusy(true);
    try {
      const r = await purgeStatement(fileId, statement);
      if (!r.ok) { notify(r.error, "error"); return; }
      notify("Statement purged."); router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex gap-3">
      <button type="button" disabled={busy} onClick={restore} className="text-[13px] text-navy-700 underline">Restore</button>
      {canPurge && <button type="button" disabled={busy} onClick={purge} className="text-[13px] text-danger underline">Purge</button>}
    </span>
  );
}

// ---------- Replace file (rule 8): a clearer copy of the same statement. Read, then compared line by line.
const OK_EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
export function ReplaceWindow({ fileId, statement, sub, closeHref }: { fileId: string; statement: string; sub: string; closeHref: string }) {
  const router = useRouter();
  const [state, setState] = useState<"pick" | "reading" | "checking" | "error">("pick");
  const [error, setError] = useState("");
  const job = useRef<string | null>(null);
  const finish = async (id: string) => {
    setState("checking");
    const r = await guarded((confirm) => replaceStatementFile(fileId, statement, id, confirm));
    if (!r) { setState("pick"); return; }
    if (!r.ok) { setError(r.error); setState("error"); return; }
    notify("File replaced. The lines are unchanged.");
    router.push(closeHref); router.refresh();
  };
  // While the new file is read, ask every few seconds.
  useEffect(() => {
    if (state !== "reading") return;
    const t = setInterval(async () => {
      const id = job.current; if (!id) return;
      const p = await pollStatements(fileId);
      const row = p.ok ? p.rows.find((x) => x.id === id) : null;
      if (!row) return;
      if (row.status === "failed") { clearInterval(t); setError("The new file could not be read. Upload it again."); setState("error"); return; }
      if (row.status === "ready" || row.status === "needs_look") { clearInterval(t); await finish(id); }
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const send = async (f: File | undefined) => {
    if (!f) return;
    if (!OK_EXT.test(f.name)) { setError("Use a PDF, JPG, PNG or HEIC file."); setState("error"); return; }
    setError(""); setState("reading");
    const made = await createStatementUploads(fileId, [{ name: f.name, size: f.size, type: f.type }]);
    if (!made.ok) { setError(made.error); setState("error"); return; }
    const u = made.uploads[0];
    const m = await markReplacement(fileId, statement, [u.id]);
    if (!m.ok) { setError(m.error); setState("error"); return; }
    const r = await browserStorage().from(made.bucket).uploadToSignedUrl(u.path, u.token, f, { contentType: u.contentType });
    if (r.error) { setError(`${f.name} was not sent. Upload it again.`); setState("error"); return; }
    const c = await confirmStatementUploads([u.id]);
    if (!c.ok) { setError(c.error); setState("error"); return; }
    job.current = u.id;
  };
  if (state === "error" && isLockRefusal(error)) return <LockedWindow title="Replace file" sub={sub} closeHref={closeHref} text={error} />;
  return (
    <Win title="Replace file" sub={sub} closeHref={closeHref} width={560}>
      <p className="text-[14px] text-ink-2">Upload a clearer copy of the same statement. It must read to the same account, period, opening and closing, and the same lines. The lines in the file do not change.</p>
      {(state === "pick" || state === "error") && (
        <label className="block cursor-pointer rounded-[var(--radius-ds)] border-2 border-dashed border-sand-300 px-5 py-5 text-center text-[14.5px] text-ink-2 hover:border-navy-300">
          Drop the file here, or <span className="text-navy-700 underline">choose it</span>
          <input type="file" aria-label="Clearer copy" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; send(f); }} />
        </label>
      )}
      {state === "reading" && <p className="text-[14px]">Reading the new file…</p>}
      {state === "checking" && <p className="text-[14px]">Comparing it with the imported statement…</p>}
      {error && <p className="rounded-[8px] bg-danger-soft px-3 py-2 text-[13.5px] text-danger" role="alert">{error}</p>}
    </Win>
  );
}

// ---------- A line (rules 5, 6): the bank's own data is shown, read-only; the accounting date and the memo are ours.
export function LineWindow({ fileId, line, closeHref, yearStart, yearEnd }: {
  fileId: string; closeHref: string; yearStart: string; yearEnd: string;
  line: { id: string; bankDate: string; acctDate: string; description: string; cents: number; memo: string; account: string };
}) {
  const router = useRouter();
  const [d, setD] = useState(line.acctDate);
  const [memo, setMemo] = useState(line.memo);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      if (d !== line.acctDate) {
        const r = await guarded((confirm) => setLineDate(fileId, line.id, d, confirm));
        if (!r) return;
        if (!r.ok) { if (isLockRefusal(r.error)) setLocked(r.error); else notify(r.error, "error"); return; }
      }
      if (memo.trim() !== line.memo) {
        const r = await guarded((confirm) => setLineMemo(fileId, line.id, memo, confirm));
        if (!r) return;
        if (!r.ok) { if (isLockRefusal(r.error)) setLocked(r.error); else notify(r.error, "error"); return; }
      }
      notify("Saved."); router.push(closeHref); router.refresh();
    } finally { setBusy(false); }
  };
  if (locked) return <LockedWindow title="Line" sub={line.account} closeHref={closeHref} text={locked} />;
  const row = (k: string, v: React.ReactNode) => <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-sand-100 py-2 text-[14px]"><span className="text-ink-3">{k}</span><span>{v}</span></div>;
  return (
    <Win title="Line" sub={line.account} closeHref={closeHref} width={560} footer={<>
      <span className="flex-1" /><Link href={closeHref} scroll={false} className="btn-secondary">Cancel</Link>
      <button type="button" onClick={save} disabled={busy || (d === line.acctDate && memo.trim() === line.memo)} className="btn h-9">Save</button></>}>
      <label className="grid gap-1 text-[13px] font-semibold text-ink-2">Date (the posting uses it)
        <input type="date" value={d} min={yearStart} max={yearEnd} onChange={(e) => setD(e.target.value)} className="input h-9 w-[12rem]" aria-label="Date" />
        <span className="text-[12px] font-normal text-ink-3">Bank: {date(line.bankDate)}</span></label>
      <div>
        {row("Description", line.description)}
        {row("Amount", <span className="tabular-nums">{money(line.cents)}</span>)}
      </div>
      <label className="grid gap-1 text-[13px] font-semibold text-ink-2">Memo
        <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} className="input h-9" aria-label="Memo" /></label>
      <p className="text-[12.5px] text-ink-3">The bank&rsquo;s date, description and amount do not change. Each change is in the file history.</p>
    </Win>
  );
}

// Refused by a sign-off lock: the refusal, and Close.
function LockedWindow({ title, sub, closeHref, text }: { title: string; sub: string; closeHref: string; text: string }) {
  return (
    <Win title={title} sub={sub} closeHref={closeHref} width={520} footer={<><span className="flex-1" /><Link href={closeHref} scroll={false} className="btn h-9">Close</Link></>}>
      <p className="rounded-[var(--radius-ds)] border border-[#efd9a6] bg-warning-soft/60 px-4 py-3 text-[14.5px]" role="alert">{text}</p>
    </Win>
  );
}

// ---------- Round 25: "Record why a period has no statement" (point 23). Changing it while 3.2 or 3.3 is signed asks
// first (rule G17); a reviewer's sign-off only the reviewer removes, and the form then shows only the refusal.
export function CoverageForm({ fileId, account, opened, closed, note }: { fileId: string; account: string; opened: string; closed: string; note: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  if (locked) return <p className="mt-3 rounded-[var(--radius-ds)] border border-[#efd9a6] bg-warning-soft/60 px-4 py-3 text-[14.5px]" role="alert">{locked}</p>;
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget), v = (k: string) => String(f.get(k) ?? "");
      setBusy(true);
      try {
        const r = await guarded((confirm) => setAccountCoverage(fileId, account, v("opened"), v("closed"), v("note"), false, confirm));
        if (!r) return;
        if (!r.ok) { if (isLockRefusal(r.error)) setLocked(r.error); else notify(r.error, "error"); return; }
        notify("Reason recorded."); router.refresh();
      } finally { setBusy(false); }
    }}>
      <label className="grid gap-1 text-[12.5px] text-ink-2">Opened in the year, on<input type="date" name="opened" defaultValue={opened} className="input h-9" /></label>
      <label className="grid gap-1 text-[12.5px] text-ink-2">Closed in the year, on<input type="date" name="closed" defaultValue={closed} className="input h-9" /></label>
      <label className="grid gap-1 text-[12.5px] text-ink-2 sm:col-span-2">No statements (say why)<input name="note" defaultValue={note} maxLength={300} className="input h-9" /></label>
      <div className="sm:col-span-2"><button type="submit" disabled={busy} className="btn-secondary h-9">Save</button></div>
    </form>
  );
}

// ---------- Round 29: "Read again" for statements waiting to be fixed, in View statements (the upload window now shows
// only the upload just done). The same stored files go back to the reader; imported statements are never read again.
export function ReadAgainButton({ ids, label, plain }: { ids: string[]; label: string; plain?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy || !ids.length} className={plain ? "text-[13px] text-navy-700 underline" : "btn-secondary h-9"} onClick={async () => {
      const n = ids.length;
      if (!(await confirmAction({ title: n === 1 ? "Read this statement again?" : `Read ${n} statements again?`,
        body: "The reader reads the same files again. The lines read and any changes made in Fix it are replaced. Nothing is imported until each passes its checks.", confirm: "Read again" }))) return;
      setBusy(true);
      try {
        const r = await readStatementsAgain(ids);
        if (!r.ok) { notify(r.error, "error"); return; }
        notify(`${r.queued} sent to the reader.`); router.refresh();
      } finally { setBusy(false); }
    }}>{label}</button>
  );
}

// ---------- Round 30: a 3.3 row opens its line window (date and memo) when clicked; no Edit link on every row.
export function LineRow({ href, label, className, children }: { href: string; label: string; className: string; children: React.ReactNode }) {
  const router = useRouter();
  const go = () => router.push(href, { scroll: false });
  return (
    <tr className={`${className} cursor-pointer hover:bg-navy-50/60`} tabIndex={0} aria-label={label} title="Click to change the date or the memo" onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}>{children}</tr>
  );
}
