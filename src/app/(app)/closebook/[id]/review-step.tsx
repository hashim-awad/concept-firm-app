// Step 6, Review (round 8, Hashim, Nov 24, 2026): everything waiting for the reviewer in one list, each
// item linked to where it is decided, and the open review notes. Review by exception (round 8b), as in
// CaseWare Working Papers: the preparer signs the steps; what waits for the reviewer collects here; the
// reviewer signs step 6 when every step is reviewed, no note is open and nothing waits. The completion
// checklist (CSRS 4200) belongs to step 10: the statements, the MAL and the report come after step 6.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { saveChecklist } from "../actions";

export type ReviewItem = { href: string; label: string; detail: string; amount?: string };
export type ReviewGroup = { key: string; title: string; step: string; items: ReviewItem[] };
export type ChecklistRow = { key: string; text: string; answer: "" | "yes" | "no" | "na"; note: string };

export function ReviewStep({ groups, notes }: { groups: ReviewGroup[]; notes: ReviewItem[] }) {
  const waiting = groups.reduce((n, g) => n + g.items.length, 0);
  const tile = (n: number | string, label: string, tone: string) => (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}><p className="text-2xl font-semibold tabular-nums">{n}</p><p className="text-sm">{label}</p></div>
  );
  return (
    <div className="grid gap-4">
      <section aria-label="Counts" className="grid gap-3 sm:grid-cols-2">
        {tile(waiting, waiting === 1 ? "item waiting for the reviewer" : "items waiting for the reviewer", waiting ? "border-warning/40 bg-warning-soft/40" : "border-sand-200 bg-surface")}
        {tile(notes.length, notes.length === 1 ? "review note open" : "review notes open", notes.length ? "border-danger/40 bg-danger/5 text-danger" : "border-sand-200 bg-surface")}
      </section>

      <section aria-label="Waiting for the reviewer" className="card grid gap-3">
        <h2 className="font-semibold">Waiting for the reviewer</h2>
        {waiting === 0 && <p className="text-sm text-ink-2">Nothing waits for the reviewer.</p>}
        {groups.filter((g) => g.items.length).map((g) => (
          <div key={g.key}>
            <h3 className="mb-1 text-sm font-semibold">{g.title} <span className="font-normal text-ink-3">({g.step}, {g.items.length})</span></h3>
            <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200">
              {g.items.map((it) => (
                <li key={it.href + it.label} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0"><Link href={it.href} className="font-medium text-navy-700 underline">{it.label}</Link>
                    {it.detail && <span className="block text-xs text-ink-2">{it.detail}</span>}</span>
                  {it.amount && <span className="tabular-nums">{it.amount}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {notes.length > 0 && (
        <section aria-label="Open review notes" className="card grid gap-2">
          <h2 className="flex items-center gap-2 font-semibold">Open review notes <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">{notes.length}</span></h2>
          <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200">
            {notes.map((n) => (
              <li key={n.href} className="px-3 py-2 text-sm"><Link href={n.href} className="font-medium text-navy-700 underline">{n.label}</Link>
                <span className="block text-xs text-ink-2">{n.detail}</span></li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}

// The completion checklist (CSRS 4200, compilation engagements): step 10's, before the file is locked and
// the compilation report is released (round 8b). 1, 10 and 11 must be Yes; only 8 and 9 (conditional)
// can be Not applicable. The database applies the same rules.
const MUST_YES = new Set([1, 10, 11]), MAY_NA = new Set([8, 9]);
export function Checklist({ fileId, checklist, problems, editable, back, trial }: {
  fileId: string; checklist: ChecklistRow[]; problems: string[]; editable: boolean; back: string; trial: boolean;
}) {
  return (
    <div className="grid gap-3">
      {problems.length > 0 && <p className="rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-2.5 text-sm">Before the file is locked: {problems.join(" ")}</p>}
      <section aria-label="Completion checklist" className="card">
        <h2 className="font-semibold">Completion checklist</h2>
        <p className="mb-3 text-sm text-ink-2">CSRS 4200, compilation engagements. Answer every question before the file is locked and the compilation report is released.
          Questions 1, 10 and 11 must be Yes. Only questions 8 and 9 can be Not applicable. A &ldquo;No&rdquo; needs a note: say why, and what was done.
          {trial && <span className="ml-1 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning">Questions are a draft: approve them on the Templates page</span>}</p>
        <form action={saveChecklist} className="grid gap-0">
          <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={back} />
          {checklist.map((c, i) => (
            <fieldset key={c.key} className="grid gap-2 border-t border-sand-100 py-2.5 md:grid-cols-[1fr_auto]">
              <input type="hidden" name="question" value={c.key} />
              <legend className="sr-only">Question {i + 1}</legend>
              <p className="text-sm"><span className="mr-1.5 tabular-nums text-ink-3">{i + 1}.</span>{c.text}
                {MUST_YES.has(i + 1) && <span className="ml-1.5 rounded bg-sand-100 px-1.5 py-0.5 text-xs text-ink-2">Must be Yes</span>}</p>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {(MAY_NA.has(i + 1) ? (["yes", "no", "na"] as const) : (["yes", "no"] as const)).map((a) => (
                  <label key={a} className="inline-flex items-center gap-1.5"><input type="radio" name={`a_${c.key}`} value={a} defaultChecked={c.answer === a} disabled={!editable} className="h-4 w-4" />
                    {a === "yes" ? "Yes" : a === "no" ? "No" : "Not applicable"}</label>
                ))}
              </div>
              <label className="md:col-span-2"><span className="sr-only">Note for question {i + 1}</span>
                <input name={`n_${c.key}`} defaultValue={c.note} maxLength={1000} disabled={!editable} className="input input-compact w-full" placeholder="Note (needed for a No)" /></label>
            </fieldset>
          ))}
          {editable && <div className="border-t border-sand-100 pt-3"><button type="submit" className="btn-secondary">Save the checklist</button></div>}
        </form>
      </section>
    </div>
  );
}

// File history (round 8 item 8): every sign-off, cleared sign-off, note, reply and checklist save, with
// who and when. Owners only; the database lets no one else read it.
export type HistoryRow = { at: string; who: string; action: string; step: string; detail: string };
const ACTION: Record<string, string> = {
  prepared: "Signed as preparer", reviewed: "Signed as reviewer", unsigned_prepared: "Took back the preparer sign-off", unsigned_reviewed: "Took back the reviewer sign-off",
  signoff_cleared: "Sign-offs cleared by a change", note_added: "Review note added", note_replied: "Replied to a note", note_fixed: "Marked a note fixed",
  note_cleared: "Cleared a note", note_reopened: "Reopened a note", checklist_saved: "Saved the completion checklist",
  revenue_accepted: "Accepted a revenue difference", gifi_exported: "Exported the GIFI file", t2_accepted: "Accepted a T2 tie-out difference",
};
export function HistoryView({ rows, stepName }: { rows: HistoryRow[]; stepName: (k: string) => string }) {
  return (
    <section className="card overflow-x-auto p-0">
      <h2 className="px-5 pt-4 pb-2 font-semibold">File history</h2>
      {!rows.length ? <p className="px-5 pb-4 text-sm text-ink-2">Nothing yet.</p> : (
        <table className="table table-compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Step</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td className="whitespace-nowrap">{formatDate(r.at)} {new Date(r.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}</td>
              <td>{r.who}</td><td>{ACTION[r.action] ?? r.action}</td><td className="whitespace-nowrap">{stepName(r.step)}</td><td className="text-ink-2">{r.detail}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
