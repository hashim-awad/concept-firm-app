"use client";
// Step 3.2 "Upload statements" (round 23, Hashim, Nov 16, 2026; image 3). Benchmark: QuickBooks Online "Upload
// from file". Account (the 3.1 accounts), the drop zone (PDFs or photos, any number, any order, or one CSV for the
// year), then the result. Everything that passes goes in by itself; only a misread statement or a missing period
// stops for a person. One button: Done.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Minus, X } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { notify } from "@/components/save-state";
import { AmountInput } from "@/components/amount";
import { confirmStatementUploads, createStatementUploads, discardStatement, pollStatements } from "../../../statements/actions";
import { importChecked, setStatementTarget } from "../../step3-actions";
import { importCsv, unlockFeed } from "../../banking-actions";
import { guarded, lockMessage, type Lock } from "./guard";

let storage: ReturnType<typeof createClient>["storage"] | null = null;
const browserStorage = () => (storage ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }).storage);
const OK_EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
const fmt = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };

// What the window shows for the account chosen.
export type UploadSummary = {
  lines: number; yearLabel: string; outside: number; closing: number | null; bank: number | null; matches: boolean | null; startOff: number | null;
  missing: string[]; toFix: { id: string; label: string }[]; reading: number;
  refused: { id: string; file: string; why: string }[];      // statements for another account, or already in
  pending: { id: string; file: string }[];                     // read and passing: imported here by themselves
};

// Refusals stay listed after the file is removed, for this session.
const KEY = (f: string, a: string) => `banking-refused:${f}:${a}`;
const readRefused = (f: string, a: string): { file: string; why: string }[] => { try { return JSON.parse(sessionStorage.getItem(KEY(f, a)) || "[]"); } catch { return []; } };
const addRefused = (f: string, a: string, x: { file: string; why: string }) => {
  try { sessionStorage.setItem(KEY(f, a), JSON.stringify([...readRefused(f, a), x])); window.dispatchEvent(new Event("banking-refused")); } catch { /* shown once */ }
};
const subscribe = (cb: () => void) => { window.addEventListener("banking-refused", cb); return () => window.removeEventListener("banking-refused", cb); };

// Speed (Hashim, Nov 16, 2026): each statement is tried once per session. A server call in progress makes every
// click wait (Next.js runs them in turn), so a statement that keeps failing must not be tried on every visit.
// A failure is listed with its reason. Round 24: an import goes to the bank feed; nothing posts, so the trial
// balance is not rebuilt.
const TRIED = (f: string) => `banking-tried:${f}`;
const triedIds = (f: string): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(TRIED(f)) || "[]") as string[]); } catch { return new Set(); } };
async function importOnce(fileId: string, items: { id: string; account: string; file: string }[]): Promise<number> {
  const tried = triedIds(fileId);
  let n = 0;
  for (const x of items) {
    if (tried.has(x.id)) continue;
    tried.add(x.id);
    try { sessionStorage.setItem(TRIED(fileId), JSON.stringify([...tried])); } catch { /* tried this time only */ }
    try {
      const r = await importChecked(x.id, x.account, false);
      if (r.ok && r.imported) n++;
      else addRefused(fileId, x.account, { file: x.file, why: r.ok ? "Not imported: some of its lines are already in this file. Check it in View statements." : `Not imported: ${r.error}` });
    } catch { addRefused(fileId, x.account, { file: x.file, why: "Not imported: the import did not finish. Upload it again." }); }
  }
  return n;
}

export function BankingUpload({ fileId, accounts, account, opening, closeHref, summary, fixBase, lock }: {
  fileId: string; accounts: { id: string; label: string }[]; account: string | null; opening: number | null; closeHref: string; summary: UploadSummary | null;
  fixBase: string;   // the address the fix screen opens on, with &fix=<id> added
  lock: Lock;        // round 24: 3.2 or 3.3 signed; nothing is uploaded until the sign-off is removed
}) {
  const router = useRouter();
  const [sending, setSending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [open, setOpen] = useState(opening === null ? "" : (opening / 100).toFixed(2));
  const [close, setClose] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refusedRaw = useSyncExternalStore(subscribe, () => { try { return account ? sessionStorage.getItem(KEY(fileId, account)) ?? "[]" : "[]"; } catch { return "[]"; } }, () => "[]");
  const refused = JSON.parse(refusedRaw) as { file: string; why: string }[];
  const input = useRef<HTMLInputElement>(null);
  const reading = (summary?.reading ?? 0) + sending;

  // While anything reads, the list refreshes every few seconds (and wakes the reader if it stopped).
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(async () => { try { await pollStatements(fileId); } catch { /* next time */ } router.refresh(); }, 3000);
    return () => clearInterval(t);
  }, [reading, fileId, router]);
  // Everything that passes goes in by itself; refusals are removed and listed.
  const work = (summary?.pending.length ?? 0) + (summary?.refused.length ?? 0);
  useEffect(() => {
    if (!summary || !account || busy || !work || lock) return;
    let stop = false;
    (async () => {
      setBusy(true);
      for (const r of summary.refused) { if (stop) break; addRefused(fileId, account, { file: r.file, why: r.why }); await discardStatement(r.id); }
      if (!stop) await importOnce(fileId, summary.pending.map((x) => ({ ...x, account })));
      setBusy(false);
      router.refresh();
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, account]);

  const send = async (files: File[]) => {
    if (!account) return;
    setError(null);
    const c = files.find((f) => /\.csv$/i.test(f.name));
    if (c) { setCsv({ name: c.name, text: await c.text() }); return; }
    const good = files.filter((f) => OK_EXT.test(f.name));
    if (files.length > good.length) notify(`Not uploaded: ${files.filter((f) => !OK_EXT.test(f.name)).map((f) => f.name).join(", ")}. Use PDF, JPG, PNG or HEIC files, or one CSV.`, "error");
    if (!good.length) return;
    setSending((n) => n + good.length);
    try {
      const made = await createStatementUploads(fileId, good.map((f) => ({ name: f.name, size: f.size, type: f.type })));
      if (!made.ok) { notify(made.error, "error"); return; }
      const store = browserStorage().from(made.bucket);
      const sent: string[] = [];
      await Promise.all(good.map(async (f, i) => {
        const u = made.uploads[i];
        const r = u ? await store.uploadToSignedUrl(u.path, u.token, f, { contentType: u.contentType }) : null;
        if (u && r && !r.error) sent.push(u.id); else notify(`${f.name} was not sent. Upload it again.`, "error");
      }));
      if (sent.length) { await setStatementTarget(sent, account); const r = await confirmStatementUploads(sent); if (!r.ok) notify(r.error, "error"); }
    } finally { setSending((n) => n - good.length); router.refresh(); }
  };

  const done = async () => {
    if (csv && account) {
      setBusy(true);
      const r = await guarded((confirm) => importCsv(fileId, account, csv.name, csv.text, open, close, confirm));
      setBusy(false);
      if (!r) return;
      if (!r.ok) { setError(r.error); return; }
      setCsv(null);
    }
    router.push(closeHref); router.refresh();
  };

  const row = (tone: "ok" | "bad" | "none" | "busy", content: React.ReactNode, key: string) => (
    <li key={key} className="flex items-start gap-3 text-[14.5px] leading-snug">
      <span className={`mt-px grid h-6 w-6 flex-none place-items-center rounded-full ${tone === "ok" ? "bg-success text-white" : tone === "bad" ? "bg-danger text-white" : "bg-sand-100 text-ink-3"}`}>
        {tone === "ok" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : tone === "bad" ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : tone === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Minus className="h-3.5 w-3.5" />}
      </span><span>{content}</span></li>
  );
  const s = summary;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-navy-950/45 px-4 py-8" role="dialog" aria-modal="true" aria-label="Upload statements">
      <div className="w-full max-w-[640px] overflow-hidden rounded-[16px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-7 py-5"><h2 className="text-[19px] font-semibold">Upload statements</h2><span className="flex-1" />
          <Link href={closeHref} scroll={false} aria-label="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></Link></div>
        <div className="grid gap-4 px-7 py-6">
          {!lock && <label className="grid gap-2"><span className="text-[14px] font-semibold">Account</span>
            <select aria-label="Account" value={account ?? ""} className="input h-11 text-[15px]"
              onChange={(e) => router.push(`/closebook/${fileId}?step=records&paper=feeds&upload=1&acc=${e.target.value}`)}>
              {!account && <option value="">Choose the account</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select></label>}
          {lock && (
            <div className="grid gap-2 rounded-[10px] border border-[#efd9a6] bg-warning-soft/60 px-4 py-3 text-[14px]" role="alert">
              <span>{lock.label} {lock.label.includes(" and ") ? "are" : "is"} signed. {lockMessage(lock)}</span>
              {lock.canRemove && <span><button type="button" className="btn h-9" disabled={busy} onClick={async () => {
                setBusy(true); const r = await unlockFeed(fileId); setBusy(false);
                if (!r.ok) notify(r.error, "error"); router.refresh();
              }}>Continue</button></span>}
            </div>
          )}
          {/* Round 24 (Hashim, Nov 16, 2026): refused by a sign-off lock, the window shows only the refusal. */}
          {!lock && account && !csv && (
            <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); send([...e.dataTransfer.files]); }}
              className="block cursor-pointer rounded-[10px] border-2 border-dashed border-sand-300 px-5 py-5 text-center text-[14.5px] text-ink-2 hover:border-navy-300">
              Drop all the year&rsquo;s statements (PDF), or one CSV file. <span className="text-navy-700 underline">Choose files</span>
              <input ref={input} type="file" multiple aria-label="Statement files" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.csv,application/pdf,image/jpeg,image/png,image/heic,image/heif,text/csv"
                className="sr-only" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; send(f); }} />
            </label>
          )}
          {!lock && csv && (
            <div className="grid gap-3 rounded-[10px] border border-sand-200 bg-sand-50/60 px-4 py-3.5">
              <p className="text-[14px]"><b>{csv.name}</b></p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-[13px] font-semibold text-ink-2">Opening balance on the statement
                  <AmountInput name="opening" value={open} onValue={setOpen} className="input h-9 text-right" placeholder="0.00" aria-label="Opening balance" /></label>
                <label className="grid gap-1 text-[13px] font-semibold text-ink-2">Closing balance on the statement
                  <AmountInput name="closing" value={close} onValue={setClose} className="input h-9 text-right" placeholder="0.00" aria-label="Closing balance" /></label>
              </div>
            </div>
          )}
          {!lock && error && <p className="rounded-[8px] bg-danger-soft px-3 py-2 text-[13.5px] text-danger" role="alert">{error}</p>}
          {!lock && s && (
            <ul className="grid gap-3">
              {(reading > 0 || busy) && row("busy", reading ? `Reading ${reading} statement${reading === 1 ? "" : "s"}…` : "Adding the statements…", "reading")}
              {s.lines > 0 && row("ok", <><b>{s.lines.toLocaleString("en-CA")} transactions</b> added for {s.yearLabel}</>, "lines")}
              {s.matches === true && s.closing !== null && row("ok", `Closing balance matches the bank: ${fmt(s.closing)}`, "close")}
              {s.startOff !== null && row("bad", `The opening differs from the bank by ${fmt(Math.abs(s.startOff))} at the start of the year: explain it in 3.3`, "start")}
              {s.matches === false && s.startOff === null && s.closing !== null && s.bank !== null && row("bad", `Closing balance ${fmt(s.closing)}, the bank ${fmt(s.bank)}: see 3.3`, "close")}
              {s.missing.map((m) => row("bad", `Missing: ${m}`, `m-${m}`))}
              {s.toFix.map((f) => row("bad", <>To fix: {f.label}. <Link href={`${fixBase}&fix=${f.id}`} scroll={false} className="text-navy-700 underline">Fix it</Link></>, `f-${f.id}`))}
              {refused.map((r, i) => row("bad", `Refused: ${r.file}. ${r.why}`, `r-${i}`))}
              {s.outside > 0 && row("none", `Lines dated before ${s.yearLabel.split(" to ")[0]} or after ${s.yearLabel.split(" to ")[1]} were left out`, "outside")}
            </ul>
          )}
        </div>
        <div className="flex justify-end border-t border-sand-200 px-7 py-4">
          <button type="button" onClick={done} disabled={busy || (!!csv && (!open || !close))} className="btn h-11 px-8 text-[15px]">{lock ? "Close" : "Done"}</button>
        </div>
      </div>
    </div>
  );
}

// On the 3.2 and 3.3 pages: statements read in the background that pass go in by themselves (each tried once).
// Round 24: not while 3.2 or 3.3 is signed (the upload window asks first).
export function AutoImport({ fileId, items, locked }: { fileId: string; items: { id: string; account: string; file: string }[]; locked: boolean }) {
  const router = useRouter();
  const key = items.map((x) => x.id).join(",");
  useEffect(() => {
    if (!items.length || locked) return;
    let stop = false;
    (async () => {
      const n = await importOnce(fileId, items);
      if (!stop && n) router.refresh();
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
