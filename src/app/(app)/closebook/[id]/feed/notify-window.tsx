"use client";
// Round 32 (Hashim, Nov 18, 2026): Notify client and Mark as sent, from the Client questions report and from step 4.
// Benchmark: TaxDome's "Notify client" (one email, one link); CaseWare Cloud Queries (contacts, due date).
import { useEffect, useState } from "react";
import { notify } from "@/components/save-state";
import { formatDate, todayToronto } from "@/lib/dates";
import { copyQuestionsLink, downloadQuestions, markQuestionsSent, notifyClient, notifyDraft, type NotifyDraft } from "../../question-actions";
import { FLD, Modal, money } from "./windows";
import { addDays, longDate } from "@/lib/closebook/questions";

export function saveBase64(base64: string, name: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function downloadFile(fileId: string, kind: "xlsx" | "pdf", ids: string[] | null) {
  const r = await downloadQuestions(fileId, kind, ids);
  if (!r.ok) { notify(r.error, "error"); return; }
  saveBase64(r.base64, r.name, kind === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
}

export function NotifyWindow({ fileId, lineIds, onClose, onSent, onCopied }: { fileId: string; lineIds: string[] | null; onClose: () => void; onSent: (sentTo: string) => void; onCopied?: () => void }) {
  const [d, setD] = useState<NotifyDraft | null>(null);
  const [err, setErr] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState("");
  const [replyBy, setReplyBy] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [excel, setExcel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    let live = true;
    notifyDraft(fileId, lineIds).then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.error); return; }
      setD(r.draft); setTo(r.draft.contacts.slice(0, 1).map((c) => c.email)); setReplyBy(r.draft.replyBy || addDays(todayToronto(), 7)); setSubject(r.draft.subject); setMessage(r.draft.message);
    });
    return () => { live = false; };
  }, [fileId, lineIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!d) return;
    setBusy(true);
    const r = await notifyClient(fileId, { lineIds: d.lineIds, to, cc, replyBy, subject, message, attachExcel: excel });
    setBusy(false);
    if (!r.ok) { notify(r.error, "error", { ms: 9000 }); return; }
    onSent(r.sentTo);
  }

  // Copy link: the live link without an email (paste it into TaxDome or Outlook). Switches off any earlier link.
  async function copy() {
    if (!d) return;
    setBusy(true);
    const r = await copyQuestionsLink(fileId, { lineIds: d.lineIds, to, replyBy });
    setBusy(false);
    if (!r.ok) { notify(r.error, "error", { ms: 9000 }); return; }
    setCopied(r.url);
    try { await navigator.clipboard.writeText(r.url); notify("Link copied. Paste it into a TaxDome message or your own email."); }
    catch { notify("The link is below. Select it and copy it."); }
    onCopied?.();
  }

  const ready = !!d && d.count > 0 && to.length > 0 && subject.trim() && message.trim() && replyBy >= todayToronto();
  return (
    <Modal title="Notify client" label="Notify client" onClose={onClose} width={640} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>{copied ? "Close" : "Cancel"}</button>
      {d && <button type="button" className="btn-secondary" disabled={!d.count || busy} onClick={copy} data-notify-copy>Copy link</button>}
      {d && !d.canSend
        ? <button type="button" className="btn" disabled={!d.count} onClick={() => downloadFile(fileId, "xlsx", d.lineIds)}>Download</button>
        : <button type="button" className="btn" disabled={!ready || busy} onClick={send} data-notify-send>{busy ? "Sending…" : "Send"}</button>}
    </>}>
      {err && <p role="alert" className="text-danger">{err}</p>}
      {copied && (
        <label className="grid gap-1 rounded-[8px] border border-success/40 bg-success-soft px-4 py-3 text-[13px]" data-notify-copied>
          <span className="font-semibold">The live link (copied). Any earlier link no longer works.</span>
          <input readOnly value={copied} onFocus={(e) => e.currentTarget.select()} className={`${FLD} font-mono text-[12px]`} aria-label="The live link" />
        </label>
      )}
      {!d && !err && <p className="text-ink-3">Getting the email ready…</p>}
      {d && <>
        <p className="font-semibold" data-notify-count>{d.count === 0 ? "No open questions to send." : `${d.count} question${d.count === 1 ? "" : "s"} will be sent.`}</p>
        {d.items.length > 0 && (
          <ol className="-mt-2 grid max-h-56 gap-2 overflow-y-auto rounded-[8px] border border-sand-200 bg-sand-50 px-4 py-2.5 text-[13px]" data-notify-list aria-label="The questions the client will see">
            {d.items.map((it) => (
              <li key={it.id} data-notify-item={it.id}>
                <p className="text-[12px] text-ink-3"><span className="whitespace-nowrap">{formatDate(it.date)}</span> · {it.description} · <span className="whitespace-nowrap tabular-nums">${money(it.cents)} {it.out ? "paid out" : "received"}</span></p>
                {it.questions.map((q, i) => <p key={i} className="whitespace-pre-wrap">{q}{it.again && <span className="ml-1.5 text-[11.5px] text-ink-3">(sent before, sent again)</span>}</p>)}
              </li>
            ))}
          </ol>
        )}
        {!d.canSend && (
          <div className="rounded-[8px] border border-warning/40 bg-warning-soft px-4 py-3 text-[13px]" data-notify-missing>
            <p className="font-semibold">Sending by email is not set up here. Use Copy link and paste the link into a TaxDome message or your own email, or Download the questions.</p>
            <p className="mt-1">Missing: {d.missing.join(", ")}.</p>
          </div>
        )}
        {d.canSend && <>
          <fieldset className="grid gap-1.5"><legend className="mb-1 font-semibold">To</legend>
            {d.contacts.length === 0 && <p className="text-[13px] text-danger">The client record has no email address. Add one on the client&rsquo;s page.</p>}
            {d.contacts.map((c) => (
              <label key={c.email} className="flex items-center gap-2">
                <input type="checkbox" checked={to.includes(c.email)} onChange={(e) => setTo(e.target.checked ? [...to, c.email] : to.filter((x) => x !== c.email))} />
                <span>{c.name}</span><span className="text-ink-3">{c.email}</span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <label className="grid gap-1 font-semibold">Cc <span className="sr-only">(optional)</span><input aria-label="Cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional. Separate with commas." className={`${FLD} font-normal`} /></label>
            <label className="grid gap-1 font-semibold">Reply by<input type="date" aria-label="Reply by" value={replyBy} min={todayToronto()} onChange={(e) => setReplyBy(e.target.value)} className={`${FLD} font-normal`} /></label>
          </div>
          <label className="grid gap-1 font-semibold">Subject<input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={`${FLD} font-normal`} /></label>
          <label className="grid gap-1 font-semibold">Message<textarea aria-label="Message" value={message} onChange={(e) => setMessage(e.target.value)} rows={7} maxLength={3000} className="input font-normal" /></label>
          <p className="-mt-2 text-[13px] text-ink-2" data-notify-answer-by>Added after the message, from Reply by: <b className="text-ink">{replyBy ? d.answerBy.replace("{1}", longDate(replyBy)) : ""}</b></p>
          <div className="rounded-[8px] border border-sand-200 bg-sand-50 px-4 py-3 text-[13.5px]" data-notify-preview>
            <p className="text-[11.5px] font-semibold tracking-[.06em] text-ink-3 uppercase">The link, as the client will see it</p>
            <p className="mt-1.5"><b className="text-navy-700 underline">{d.linkText}</b></p>
            <p className="mt-3"><b>{d.signature.name}</b>{d.signature.credentials ? `, ${d.signature.credentials}` : ""}</p>
            <p className="text-ink-2">{[d.signature.title, d.signature.firm].filter(Boolean).join(" | ")}</p>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={excel} onChange={(e) => setExcel(e.target.checked)} />Attach the questions as an Excel file</label>
          <p className="text-[12.5px] text-ink-3">The email goes from your Microsoft 365 mailbox. Send or Copy link makes a new link; any earlier link for this file stops working.</p>
        </>}
      </>}
    </Modal>
  );
}

export function MarkSentWindow({ fileId, lineIds, n, onClose, onDone }: { fileId: string; lineIds: string[]; n: number; onClose: () => void; onDone: (n: number) => void }) {
  const [date, setDate] = useState(todayToronto());
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Mark as sent" onClose={onClose} width={440} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={busy || !date || !n} onClick={async () => {
        setBusy(true); const r = await markQuestionsSent(fileId, lineIds, date); setBusy(false);
        if (!r.ok) { notify(r.error, "error"); return; }
        onDone(r.n);
      }}>Mark as sent</button></>}>
      <p className="text-ink-2">Use this when you sent {n === 1 ? "the question" : `the ${n} questions`} another way, by phone or your own email. {n === 1 ? "It moves" : "They move"} to Waiting.</p>
      <label className="grid gap-1 font-semibold">Date sent<input type="date" aria-label="Date sent" value={date} max={todayToronto()} onChange={(e) => setDate(e.target.value)} className={`${FLD} font-normal`} /></label>
    </Modal>
  );
}
