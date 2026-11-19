"use client";
// Piece 10 (Hashim, Nov 19, 2026; mock L; benchmark CaseWare Cloud's analytical review): step 6, "Compare to last year",
// the preparer's page. Four sections, top to bottom: Flagged changes (with the Lead sheets view), New accounts this year,
// Accounts not used this year, What changed this year. Each change saves at once; the database checks every rule again.
import Link from "next/link";
import { useState, useTransition } from "react";
import { REASONS } from "./lead-sheets";
import { answerYearChange, confirmNewAccount, reviewNewAccount, reviewYearChange, seenUnused } from "../compare-actions";
import { explainFlagInline, signStep } from "../actions";
import { YEAR_QUESTIONS } from "@/lib/closebook/compare";

export type FlagRowView = { id: string; label: string; last: string; final: string; change: string; pct: string; ledger: string; note?: { reason: string; note: string } };
export type AcctRowView = { key: string; label: string; line: string; amount: string; ledger: string; confirmed?: boolean };

const th = "px-3 py-2 text-left text-[11.5px] font-semibold text-ink-2";
const td = "px-3 py-2.5 align-middle text-[13.5px]";

export function CompareStep({ fileId, editable, flagRule, leadHref, flagged, newAccounts, unused, seen, answers, canSign, back }: {
  fileId: string; editable: boolean; flagRule: string; leadHref: string; flagged: FlagRowView[]; newAccounts: AcctRowView[]; unused: AcctRowView[];
  seen: boolean; answers: Record<string, { answer: boolean; note: string }>; canSign: boolean; back: string;
}) {
  const [err, setErr] = useState("");
  const amt = (v: string, href: string) => <Link href={href} className="text-navy-700 hover:underline" data-compare-amount>{v}</Link>;
  return (
    <div className="grid gap-5" data-compare-step>
      {err && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}

      <section aria-label="Flagged changes" id="flagged">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-navy-900">Flagged changes <span className="ml-1 text-[12.5px] font-normal text-ink-3">{flagRule}</span></h2>
          <Link href={leadHref} className="text-[12.5px] font-medium text-navy-700 hover:underline" data-lead-view>Lead sheets view</Link>
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[900px]">
            <thead className="bg-sand-50"><tr><th className={th}>Account</th><th className={`${th} text-right`}>Last year</th><th className={`${th} text-right`}>This year</th>
              <th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>%</th><th className={th}>Reason</th><th className={th}>Note</th></tr></thead>
            <tbody className="divide-y divide-sand-100">
              {flagged.map((r) => <FlagRow key={r.id} fileId={fileId} r={r} editable={editable} amt={amt} onError={setErr} />)}
              {flagged.length === 0 && <tr><td colSpan={7} className={`${td} text-ink-2`}>No account changed by more than the flag amount and percentage.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="New accounts this year" id="new-accounts">
        <h2 className="mb-2 text-[14px] font-semibold text-navy-900">New accounts this year <span className="ml-1 text-[12.5px] font-normal text-ink-3">A balance this year and none last year.</span></h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead className="bg-sand-50"><tr><th className={th}>Account</th><th className={th}>GIFI line</th><th className={`${th} text-right`}>This year</th><th className={`${th} w-24`}>Confirmed</th></tr></thead>
            <tbody className="divide-y divide-sand-100">
              {newAccounts.map((r) => (
                <tr key={r.key} data-new-account={r.label}>
                  <td className={td}>{r.label}</td><td className={td}>{r.line || <span className="text-danger">No GIFI line</span>}</td>
                  <td className={`${td} text-right tabular-nums`}>{amt(r.amount, r.ledger)}</td>
                  <td className={td}><Tick key={`${r.key}-${!!r.confirmed}`} on={!!r.confirmed} disabled={!editable || !r.line} label={`Confirmed: ${r.label}`} save={(v) => confirmNewAccount(fileId, r.key, v)} onError={setErr} /></td>
                </tr>
              ))}
              {newAccounts.length === 0 && <tr><td colSpan={4} className={`${td} text-ink-2`}>No new accounts this year.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Accounts not used this year" id="not-used">
        <h2 className="mb-2 text-[14px] font-semibold text-navy-900">Accounts not used this year <span className="ml-1 text-[12.5px] font-normal text-ink-3">A balance last year and none this year.</span></h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead className="bg-sand-50"><tr><th className={th}>Account</th><th className={th}>GIFI line</th><th className={`${th} text-right`}>Last year</th></tr></thead>
            <tbody className="divide-y divide-sand-100">
              {unused.map((r) => <tr key={r.key}><td className={td}>{r.label}</td><td className={td}>{r.line}</td><td className={`${td} text-right tabular-nums`}>{amt(r.amount, r.ledger)}</td></tr>)}
              {unused.length === 0 && <tr><td colSpan={3} className={`${td} text-ink-2`}>Every account used last year is used this year.</td></tr>}
            </tbody>
          </table>
        </div>
        {unused.length > 0 && <label className="mt-2 inline-flex items-center gap-2 text-[13px] text-ink-2">
          <Tick key={`seen-${seen}`} on={seen} disabled={!editable} label="Seen" save={(v) => seenUnused(fileId, v)} onError={setErr} data="seen" />Seen</label>}
      </section>

      <section aria-label="What changed this year" id="year-changes">
        <h2 className="mb-2 text-[14px] font-semibold text-navy-900">What changed this year</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px]">
            <thead className="bg-sand-50"><tr><th className={th}>Question</th><th className={`${th} w-32`}>Answer</th><th className={th}>Note</th></tr></thead>
            <tbody className="divide-y divide-sand-100">
              {YEAR_QUESTIONS.map(([q, text]) => <QuestionRow key={q} fileId={fileId} q={q} text={text} saved={answers[q]} editable={editable} onError={setErr} />)}
            </tbody>
          </table>
        </div>
      </section>

      {canSign && (
        <form action={signStep} className="flex justify-end">
          <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="step" value="compare" /><input type="hidden" name="role" value="prepared" />
          <input type="hidden" name="back" value={back} />
          <button className="btn-secondary h-9 px-4 text-[13px]" data-sign-step6>Sign off step 6</button>
        </form>
      )}
    </div>
  );
}

// A tick that shows its new state at once and saves it; a refusal puts it back and says why.
function Tick({ on, disabled, label, save, onError, data }: { on: boolean; disabled: boolean; label: string; save: (v: boolean) => Promise<string | null>; onError: (e: string) => void; data?: string }) {
  const [v, setV] = useState(on);
  const [pending, start] = useTransition();
  return <input type="checkbox" checked={v} disabled={disabled || pending} aria-label={label} data-seen={data === "seen" ? "" : undefined} className="h-4 w-4 accent-navy-700"
    onChange={(e) => { const next = e.target.checked; setV(next); start(async () => { const err = await save(next); if (err) setV(!next); onError(err ?? ""); }); }} />;
}

// A flagged change: its reason and note save together, once both are there (the reason list is the lead sheets').
function FlagRow({ fileId, r, editable, amt, onError }: { fileId: string; r: FlagRowView; editable: boolean; amt: (v: string, href: string) => React.ReactNode; onError: (e: string) => void }) {
  const [reason, setReason] = useState(r.note?.reason ?? "");
  const [note, setNote] = useState(r.note?.note ?? "");
  const [pending, start] = useTransition();
  const save = (rs: string, nt: string) => {
    if (!rs || nt.trim().length < 3 || (rs === r.note?.reason && nt.trim() === r.note?.note)) return;
    start(async () => onError((await explainFlagInline(fileId, r.id, rs, nt)) ?? ""));
  };
  return (
    <tr data-flag-row={r.label}>
      <td className={td}>{r.label}</td>
      <td className={`${td} text-right tabular-nums`}>{amt(r.last, r.ledger)}</td><td className={`${td} text-right tabular-nums`}>{amt(r.final, r.ledger)}</td>
      <td className={`${td} text-right tabular-nums`}>{r.change}</td><td className={`${td} text-right tabular-nums`}>{r.pct}</td>
      <td className={td}><select value={reason} disabled={!editable || pending} aria-label={`Reason: ${r.label}`} className="input h-9 w-40 py-1 text-[13px]"
        onChange={(e) => { setReason(e.target.value); save(e.target.value, note); }}>
        <option value="">Choose a reason</option>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
      <td className={td}><input value={note} disabled={!editable || pending} maxLength={500} placeholder="Short note" aria-label={`Note: ${r.label}`} className="input h-9 w-56 py-1 text-[13px]"
        onChange={(e) => setNote(e.target.value)} onBlur={() => save(reason, note)} />
        {!r.note && <span className="block text-[12px] text-danger">Explain this change.</span>}</td>
    </tr>
  );
}

// A question: Yes or No. A "yes" saves once its short note is there.
function QuestionRow({ fileId, q, text, saved, editable, onError }: { fileId: string; q: string; text: string; saved?: { answer: boolean; note: string }; editable: boolean; onError: (e: string) => void }) {
  const [answer, setAnswer] = useState<boolean | null>(saved ? saved.answer : null);
  const [note, setNote] = useState(saved?.note ?? "");
  const [pending, start] = useTransition();
  const save = (a: boolean, n: string) => {
    if (a && n.trim().length < 3) return;
    if (saved && saved.answer === a && (!a || saved.note === n.trim())) return;
    start(async () => onError((await answerYearChange(fileId, q, a, n)) ?? ""));
  };
  const btn = (v: boolean, label: string) => (
    <button type="button" disabled={!editable || pending} aria-pressed={answer === v} onClick={() => { setAnswer(v); save(v, note); }}
      className={`h-7 w-11 border border-sand-300 text-[12.5px] ${v ? "rounded-l" : "-ml-px rounded-r"} ${answer === v ? "bg-navy-900 font-semibold text-white" : "bg-white text-ink-2 hover:bg-sand-50"}`}>{label}</button>
  );
  return (
    <tr data-question={q}>
      <td className={td}>{text}</td>
      <td className={td}><span className="inline-flex">{btn(true, "Yes")}{btn(false, "No")}</span></td>
      <td className={td}>
        {answer === true && <input value={note} disabled={!editable || pending} maxLength={300} placeholder="Short note" aria-label={`Note: ${text}`} className="input h-9 w-64 py-1 text-[13px]"
          onChange={(e) => setNote(e.target.value)} onBlur={() => save(true, note)} />}
        {answer === null && <span className="text-[12px] text-danger">Answer this question.</span>}
        {answer === true && (!saved || !saved.answer) && note.trim().length < 3 && <span className="block text-[12px] text-danger">A &ldquo;yes&rdquo; needs a short note.</span>}
      </td>
    </tr>
  );
}

// Step 7 (piece 10): "New accounts this year and their GIFI lines", each marked reviewed by the reviewer.
export type NewReviewRow = { key: string; label: string; line: string; amount: string; ledger: string; confirmed: boolean; reviewed: string };
export function NewAccountsReview({ fileId, rows, editable, isOwner }: { fileId: string; rows: NewReviewRow[]; editable: boolean; isOwner: boolean }) {
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const left = rows.filter((r) => !r.reviewed).length;
  return (
    <section aria-label="New accounts this year and their GIFI lines" id="new-accounts-review" className="card grid gap-2">
      <h2 className="font-semibold">New accounts this year and their GIFI lines <span className="font-normal text-ink-3">(step 6, {left ? `${left} to mark reviewed` : "all reviewed"})</span></h2>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="overflow-x-auto rounded-lg border border-sand-200">
        <table className="w-full min-w-[680px]">
          <thead className="bg-sand-50"><tr><th className={th}>Account</th><th className={th}>GIFI line</th><th className={`${th} text-right`}>This year</th><th className={th}>Preparer</th><th className={th}>Reviewer</th></tr></thead>
          <tbody className="divide-y divide-sand-100">
            {rows.map((r) => (
              <tr key={r.key} data-new-review={r.label}>
                <td className={td}>{r.label}</td><td className={td}>{r.line}</td>
                <td className={`${td} text-right tabular-nums`}><Link href={r.ledger} className="text-navy-700 hover:underline">{r.amount}</Link></td>
                <td className={td}>{r.confirmed ? "Confirmed" : <span className="text-warning">Not confirmed in step 6</span>}</td>
                <td className={td}>{r.reviewed ? <span className="text-success">Reviewed · {r.reviewed}
                    {isOwner && editable && <button type="button" disabled={pending} onClick={() => start(async () => setErr((await reviewNewAccount(fileId, r.key, false)) ?? ""))} className="ml-2 text-[12px] text-navy-700 underline">Undo</button>}</span>
                  : isOwner && editable ? <button type="button" disabled={pending || !r.confirmed} onClick={() => start(async () => setErr((await reviewNewAccount(fileId, r.key, true)) ?? ""))}
                    className="btn-secondary btn-compact" data-mark-reviewed={r.label}>Mark reviewed</button> : <span className="text-ink-3">Reviewer</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Step 7 (piece 10): "Mark reviewed" on a "yes" answer of step 6.
export function MarkReviewed({ fileId, question }: { fileId: string; question: string }) {
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return <span className="inline-flex items-center gap-2">{err && <span className="text-xs text-danger">{err}</span>}
    <button type="button" disabled={pending} onClick={() => start(async () => setErr((await reviewYearChange(fileId, question, true)) ?? ""))} className="btn-secondary btn-compact" data-mark-yes={question}>Mark reviewed</button></span>;
}
