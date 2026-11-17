"use client";
// The client's cards (round 32, E). Three parts per card, as TaxDome's screens 06 and 07: the transaction, the thread
// (the current question in bold), and the answer box with Send and Attach file. They stack at phone width.
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { CheckCircle2, FileText, Paperclip, X } from "lucide-react";
import type { CqCard } from "@/lib/closebook/client-questions-server";
import { ANSWER_EXT, ANSWER_FILES, ANSWER_MAX, money, shortDate } from "@/lib/closebook/questions";
import { getUploads, sendAnswer } from "./actions";

let storage: ReturnType<typeof createClient>["storage"] | null = null;
const browserStorage = () => (storage ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }).storage);

type Tab = "waiting" | "answered" | "all";
const when = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" });

export function QuestionsBoard({ token, cards: first }: { token: string; cards: CqCard[] }) {
  const [cards, setCards] = useState(first);
  const [tab, setTab] = useState<Tab>(first.some((c) => c.waiting) ? "waiting" : "all");
  const [sent, setSent] = useState<string | null>(null);
  const counts = { waiting: cards.filter((c) => c.waiting).length, answered: cards.filter((c) => c.answered).length, all: cards.length };
  const shown = useMemo(() => cards.filter((c) => (tab === "waiting" ? c.waiting : tab === "answered" ? c.answered : true)), [cards, tab]);
  const TABS: [Tab, string][] = [["waiting", "Waiting for answer"], ["answered", "Answered"], ["all", "All"]];
  return (
    <div>
      <div role="tablist" className="flex w-full rounded-xl bg-sand-100 p-1 sm:inline-flex sm:w-auto" data-cq-tabs>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex min-h-11 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium sm:flex-none sm:px-3 sm:text-sm ${tab === k ? "bg-surface text-navy-700 shadow-sm" : "text-ink-2 hover:text-ink"}`}>
            {label}<span className={`min-w-5 rounded-full px-1.5 text-xs tabular-nums ${tab === k ? "bg-navy-700 text-white" : "bg-sand-200 text-ink-2"}`}>{counts[k]}</span>
          </button>
        ))}
      </div>
      {sent && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1.5 text-sm font-medium text-success" data-cq-pill><CheckCircle2 className="h-4 w-4" aria-hidden />Answer sent</p>}
      <div className="mt-5 space-y-4">
        {shown.map((c) => <Card key={c.id} token={token} c={c} onSent={(entry) => {
          setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, waiting: false, answered: true, thread: [...x.thread, entry] } : x)));
          setSent(c.id);
        }} />)}
        {!shown.length && <p className="rounded-2xl border border-sand-200 bg-surface p-8 text-center text-ink-2">{tab === "waiting" ? "You have answered every question. Thank you." : "Nothing here yet."}</p>}
      </div>
    </div>
  );
}

function Card({ token, c, onSent }: { token: string; c: CqCard; onSent: (e: CqCard["thread"][number]) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const lastQ = [...c.thread].reverse().find((e) => e.kind === "q");

  function add(list: FileList | null) {
    setErr("");
    const next = [...files];
    for (const f of Array.from(list ?? [])) {
      if (!ANSWER_EXT.test(f.name)) { setErr(`${f.name}: only PDF, JPG, PNG or HEIC files.`); continue; }
      if (f.size > ANSWER_MAX) { setErr(`${f.name} is over 10 MB.`); continue; }
      if (next.length >= ANSWER_FILES) { setErr(`Up to ${ANSWER_FILES} files per answer.`); break; }
      next.push(f);
    }
    setFiles(next);
    if (pick.current) pick.current.value = "";
  }

  async function send() {
    if (!text.trim() && !files.length) { setErr("Type an answer or attach a file."); return; }
    setBusy(true); setErr("");
    let done: { path: string; name: string; size: number }[] = [];
    if (files.length) {
      const u = await getUploads(token, c.id, files.map((f) => ({ name: f.name, size: f.size, type: f.type })));
      if (!u.ok) { setBusy(false); setErr(u.error); return; }
      for (let i = 0; i < u.uploads.length; i++) {
        const x = u.uploads[i];
        const r = await browserStorage().from("documents").uploadToSignedUrl(x.path, x.token, files[i], { contentType: x.contentType });
        if (r.error) { setBusy(false); setErr(`${files[i].name} did not upload. Please try again.`); return; }
      }
      done = u.uploads.map((x) => ({ path: x.path, name: x.name, size: x.size }));
    }
    const r = await sendAnswer(token, c.id, text, done);
    setBusy(false);
    if (!r.ok) { setErr(r.error); router.refresh(); return; }
    onSent({ kind: "a", body: text.trim(), at: new Date().toISOString(), files: files.map((f) => f.name) });
    setText(""); setFiles([]);
  }

  const amount = `$${money(c.cents)}`;
  return (
    <article className="grid gap-5 rounded-2xl border border-sand-200 bg-surface p-5 shadow-[var(--shadow-card)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] md:gap-0 md:p-6" data-cq-card={c.id}>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm md:pr-6">
        <dt className="text-ink-3">Amount</dt><dd className="text-ink"><span className="whitespace-nowrap font-semibold tabular-nums" data-nowrap>{amount}</span> <span className="whitespace-nowrap text-ink-3">{c.out ? "paid out" : "received"}</span></dd>
        <dt className="text-ink-3">Date</dt><dd className="text-ink"><span className="whitespace-nowrap" data-nowrap>{shortDate(c.date)}</span></dd>
        <dt className="text-ink-3">Description</dt><dd className="break-words text-ink">{c.description}</dd>
        <dt className="text-ink-3">Account</dt><dd className="text-ink">{c.account}</dd>
      </dl>
      <div className="space-y-3 border-sand-200 text-sm md:border-l md:px-6" data-cq-thread>
        {c.thread.map((e, i) => (
          <div key={i} className={e.kind === "a" ? "rounded-lg bg-sand-50 px-3 py-2" : ""}>
            <p className="text-xs text-ink-3">{e.kind === "q" ? "Q" : "Your answer"} · <span className="whitespace-nowrap" data-nowrap>{when(e.at)}</span></p>
            <p className={`whitespace-pre-wrap ${e.kind === "q" && e === lastQ && c.waiting ? "font-semibold text-ink" : "text-ink-2"}`}>{e.body || (e.files.length ? "(file attached)" : "")}</p>
            {e.files.map((f) => <p key={f} className="mt-1 flex items-center gap-1.5 text-xs text-ink-2"><FileText className="h-3.5 w-3.5" aria-hidden />{f}</p>)}
          </div>
        ))}
      </div>
      <div className="border-sand-200 md:border-l md:pl-6">
        {c.waiting ? (
          <div className="space-y-3">
            <label className="block text-sm text-ink-2" htmlFor={`a-${c.id}`}>{lastQ?.body}</label>
            <textarea id={`a-${c.id}`} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter your answer"
              className="block w-full resize-y rounded-xl border border-sand-300 bg-white px-3 py-2 text-base outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-100" />
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-sand-50 px-2 py-1 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-ink-3" aria-hidden /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="grid h-11 w-11 shrink-0 place-items-center rounded text-ink-3 hover:bg-sand-200 hover:text-ink"><X className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <button type="button" onClick={send} disabled={busy} className="min-h-11 w-full rounded-xl bg-navy-700 px-5 font-semibold text-white hover:bg-navy-800 disabled:opacity-60 sm:w-auto">{busy ? "Sending…" : "Send"}</button>
              <button type="button" onClick={() => pick.current?.click()} disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-navy-200 font-medium text-navy-700 hover:text-navy-800 sm:w-auto sm:border-0 sm:px-1"><Paperclip className="h-4 w-4" aria-hidden />Attach file</button>
              <input ref={pick} type="file" multiple hidden accept="image/*,application/pdf,.pdf,.heic,.heif" onChange={(e) => add(e.target.files)} />
            </div>
            <p className="text-xs text-ink-3">Take a photo of the receipt, or choose a photo or PDF. Up to 5 files, 10 MB each.</p>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />{c.answered ? "Answered. Thank you." : "No answer needed now."}</p>
        )}
      </div>
    </article>
  );
}
