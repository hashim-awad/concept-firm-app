// Step 6, Review (round 8, Hashim, Nov 24, 2026): everything waiting for the reviewer in one list, each
// item linked to where it is decided, and the open review notes. Review by exception (round 8b), as in
// CaseWare Working Papers: the preparer signs the steps; what waits for the reviewer collects here; the
// reviewer signs step 6 when every step is reviewed, no note is open and nothing waits. The completion
// checklist (CSRS 4200) belongs to step 10: the statements, the MAL and the report come after step 6.
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { saveChecklist } from "../actions";
import { ChecklistAnswer } from "./checklist-answer";
import { InfoTip } from "@/components/ds/info-tip";
import { isNegativeText } from "@/lib/closebook/amount";
import { CHECKLIST_RULES } from "@/lib/closebook/client-wording";
import { ReviewChip } from "./review-chip";

export type ReviewItem = { href: string; label: string; detail: string; amount?: string; action?: React.ReactNode };   // piece 10: action, "Mark reviewed"
export type ReviewGroup = { key: string; title: string; step: string; items: ReviewItem[] };
export type ChecklistRow = { key: string; text: string; answer: "" | "yes" | "no" | "na"; note: string };

// Round 35: on a bank file the lines and accounts for the reviewer are a working list (list), counted live in the chip.
// Piece 8: extra, the shareholder loans panel (the reviewer answers them here).
export function ReviewStep({ groups, notes, list, listCount = 0, extra }: { groups: ReviewGroup[]; notes: ReviewItem[]; list?: React.ReactNode; listCount?: number; extra?: React.ReactNode }) {
  const waiting = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="grid gap-4">
      <section aria-label="Counts" className="flex flex-wrap gap-2 text-[12px] font-semibold">
        <ReviewChip other={list ? 0 : waiting} initial={listCount} />
        <span className={`px-2.5 py-0.5 ${notes.length ? "bg-danger-soft text-danger" : "bg-sand-100 text-ink-2"}`}>{notes.length} note{notes.length === 1 ? "" : "s"} open</span>
      </section>

      {list}
      {(!list || waiting > 0) && <section aria-label="Waiting for the reviewer" className="card grid gap-3">
        <h2 className="font-semibold">{list ? `Also waiting for the reviewer (${waiting})` : "Waiting for the reviewer"}</h2>
        {waiting === 0 && <p className="text-[12.5px] text-ink-3">Nothing.</p>}
        {groups.filter((g) => g.items.length).map((g) => (
          <div key={g.key}>
            <h3 className="mb-1 text-sm font-semibold">{g.title} <span className="font-normal text-ink-3">({g.step}, {g.items.length})</span></h3>
            <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200">
              {g.items.map((it) => (
                <li key={it.href + it.label} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0"><Link href={it.href} className="font-medium text-navy-700 underline">{it.label}</Link>
                    {it.detail && <span className="block text-xs text-ink-2">{it.detail}</span>}</span>
                  {it.amount && <span className={`tabular-nums ${isNegativeText(it.amount) ? "text-danger" : ""}`}>{it.amount}</span>}
                  {it.action}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>}

      {extra}

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
// auto (round 12): questions Closebook fills from the signing record (10 and 11): shown, read-only.
// Round 16: the 13 questions (v2), or the first 12 for a file answered on them (v1). The rules come with
// the set. The Draft banner shows to Admins only (R3a-1); question 9 offers Not applicable only when we are
// independent (step 1, acceptance question 5).
export function Checklist({ fileId, checklist, problems, editable, back, trial, version = "v2", admin = false, notIndependent = false }: {
  fileId: string; checklist: ChecklistRow[]; problems: string[]; editable: boolean; back: string; trial: boolean; auto?: number[];
  version?: "v1" | "v2"; admin?: boolean; notIndependent?: boolean;
}) {
  const rules = CHECKLIST_RULES[version];
  const MUST_YES = new Set(rules.mustYes), MAY_NA = new Set(rules.mayNa), auto = rules.auto;
  return (
    <div className="grid gap-3">
      {problems.length > 0 && <p className="text-[12.5px] text-danger">Not yet: {problems.join(" ")}</p>}
      <section aria-label="Completion checklist" className="card">
        <h2 className="font-semibold">Completion checklist</h2>
        {trial && admin && <p className="mb-2"><Link href="/admin/templates/cbchecklist" className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning underline">Draft questions: approve them in Templates</Link></p>}
        <form action={saveChecklist} className="grid gap-0">
          <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={back} />
          {checklist.map((c, i) => (
            <fieldset key={c.key} className="grid gap-2 border-t border-sand-100 py-2.5 md:grid-cols-[1fr_auto]">
              <input type="hidden" name="question" value={c.key} />
              <legend className="sr-only">Question {i + 1}</legend>
              <p className="text-sm"><span className="mr-1.5 tabular-nums text-ink-3">{i + 1}.</span>{c.text}
                {MUST_YES.has(i + 1) && <span className="ml-1.5 rounded bg-sand-100 px-1.5 py-0.5 text-xs text-ink-2">Must be Yes</span>}</p>
              {auto.includes(i + 1) ? (
                <p className="text-sm font-medium">{c.answer === "yes" ? "Yes" : c.answer === "no" ? "No" : "Not answered"} <span className="ml-1 inline-flex items-center rounded bg-navy-50 px-1.5 py-0.5 text-xs font-normal text-navy-700">Filled by Closebook{c.note && <InfoTip align="right">{c.note}</InfoTip>}</span></p>
              ) : <ChecklistAnswer qkey={c.key} n={i + 1} answer={c.answer} note={c.note} editable={editable}
                  options={MAY_NA.has(i + 1) && !(version === "v2" && i + 1 === 9 && notIndependent) ? (["yes", "no", "na"] as const) : (["yes", "no"] as const)} />}
            </fieldset>
          ))}
          {editable && <div className="border-t border-sand-100 pt-3"><button type="submit" className="btn-secondary">Save the checklist</button></div>}
        </form>
      </section>
    </div>
  );
}

// File history (round 8 item 8): every sign-off, cleared sign-off, note, reply and checklist save, with
// who and when. The Review right only (R3a-1); the database lets no one else read it.
export type { HistoryRow } from "@/lib/closebook/history";
import { actionLabel, type HistoryRow } from "@/lib/closebook/history";
// Round 24 (rule 20): when, who, what, the statement or line, the reason, old and new; filtered by step.
export function HistoryView({ rows, stepName, steps, current, base, exportBase }: { rows: HistoryRow[]; stepName: (k: string) => string; steps: { key: string; label: string }[];
  current: string | null; base: string; exportBase: string }) {
  const chip = (on: boolean, href: string, label: string) => <Link key={href} href={href} className={`border px-3 py-1 text-[12.5px] ${on ? "border-navy-700 bg-navy-700 font-semibold text-white" : "border-sand-300 text-ink-2 hover:bg-sand-50"}`}>{label}</Link>;
  return (
    <section className="card overflow-x-auto p-0">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-2">
        {chip(!current, base, "All steps")}
        {steps.map((s) => chip(current === s.key, `${base}&hstep=${s.key}`, s.label))}
        <span className="flex-1" />
        <a href={`${exportBase}&format=xlsx${current ? `&step=${current}` : ""}`} className="text-[12.5px] text-navy-700 underline">Excel</a>
        <a href={`${exportBase}&format=pdf${current ? `&step=${current}` : ""}`} className="text-[12.5px] text-navy-700 underline">PDF</a>
      </div>
      {!rows.length ? <p className="px-5 pb-4 text-sm text-ink-2">Nothing yet.</p> : (
        <table className="table table-compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Step</th><th>Statement or line</th><th>Detail</th><th>Reason</th><th>Old</th><th>New</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className={r.erased ? "text-ink-3" : ""}><td className="whitespace-nowrap">{formatDate(r.at)} {new Date(r.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}</td>
              <td>{r.who}</td><td>{actionLabel(r.action)}</td><td className="whitespace-nowrap">{stepName(r.step)}</td><td>{r.ref}</td><td className="text-ink-2">{r.detail}</td>
              <td>{r.reason}</td><td className="text-ink-2">{r.old}</td><td>{r.new}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
