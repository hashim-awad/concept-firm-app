"use client";
// My day, owners: every open T2 deadline due before a date marked done in one step, with one reason kept on
// each line. The count updates as the date changes; the server works the list out again from the date.
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { cleanReason, doneBeforeSummary, dueBefore } from "@/lib/deadlines";
import { markDoneBefore } from "./my-day-actions";

export type Candidate = { key: string; clientId: string; client: string; kind: string; due: string; yearEndText: string; dueText: string };

function Submit({ n, ok }: { n: number; ok: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!ok || pending} className="btn h-9 px-4 text-sm disabled:opacity-50">
      {pending ? "Marking done…" : `Mark ${n} done`}
    </button>
  );
}

export function MarkDoneBeforeDialog({ candidates, labels, showDone }: { candidates: Candidate[]; labels: Record<string, string>; showDone: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [before, setBefore] = useState("");
  const [reason, setReason] = useState("");
  const list = dueBefore(candidates, before);
  const ok = list.length > 0 && cleanReason(reason) !== null;
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="btn-secondary h-8 px-3 text-sm font-medium">Mark done before a date</button>
      <dialog ref={ref} aria-labelledby={titleId}
        className="m-auto max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto rounded-2xl border border-sand-200 bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]">
        <form action={markDoneBefore} className="grid gap-4 p-6 text-sm font-normal">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold">Mark done before a date</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-0.5 text-ink-3 hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
          </div>
          <p className="text-muted">For deadlines already dealt with outside Studio. Each one keeps the reason. You can undo the whole step today; after today, reopen lines one by one with Show done.</p>
          {showDone && <input type="hidden" name="view" value="done" />}
          <input type="hidden" name="expected" value={list.length} />
          <label className="grid gap-1">
            <span className="font-medium">Every deadline due before</span>
            <input type="date" name="before" required value={before} onChange={(e) => setBefore(e.target.value)} className="input h-9 w-48" />
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Reason (kept with each deadline)</span>
            <input type="text" name="reason" required minLength={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Filed before Studio" className="input h-9" />
          </label>
          <div aria-live="polite" className="rounded-lg bg-sand-50 p-3">
            {!before ? <p className="text-muted">Choose a date to see which deadlines will be marked done.</p>
              : list.length === 0 ? <p>No open deadlines are due before {formatDate(before)}.</p> : (
                <>
                  <p className="font-medium">{doneBeforeSummary(list, labels, formatDate(before))}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-navy-700 underline">See the list</summary>
                    <ul className="mt-2 grid max-h-60 gap-1 overflow-y-auto">{list.map((x) => (
                      <li key={x.key}>{x.client}: {labels[x.kind] ?? x.kind}, year end {x.yearEndText}, due {x.dueText}</li>
                    ))}</ul>
                  </details>
                </>
              )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} className="btn-secondary h-9 px-4 text-sm">Cancel</button>
            <Submit n={list.length} ok={ok} />
          </div>
        </form>
      </dialog>
    </>
  );
}
