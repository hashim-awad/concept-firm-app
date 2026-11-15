"use client";
// Round 16 (Hashim): step 1's acceptance and continuance record (CSRS 4200), as CaseWare Cloud's
// engagement acceptance form. Nine questions; the preparer answers, the reviewer signs it with step 1. It
// rolls forward each year: last year's answer shows under each question, and "Same as last year for all"
// confirms every answer at once. Each answer records who confirmed it and when.
import { useState } from "react";
import { InfoTip } from "@/components/ds/info-tip";
import { acceptanceSameAsLast, saveAcceptance } from "../round16-actions";

import { emptyAcc, type AccRow, type AccUser, type YN } from "@/lib/closebook/acceptance";

const MUST = <span className="ml-1.5 rounded bg-sand-100 px-1.5 py-0.5 text-xs whitespace-nowrap text-ink-2">Must be Yes</span>;
const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
const userWord = (u: AccUser) => `${u.kind === "lender" ? "A lender" : "Other"}: ${u.name}`;

// One question row: number, question, answer, and an optional line under it (module level: not created during render).
const Q = ({ n, children, ans, extra }: { n: number; children: React.ReactNode; ans: React.ReactNode; extra?: React.ReactNode }) => (
  <div className="grid gap-x-4 gap-y-1.5 border-t border-sand-100 px-3.5 py-2.5 first:border-0 md:grid-cols-[1.75rem_minmax(0,1fr)_auto]">
    <span className="text-ink-3 tabular-nums">{n}.</span><div className="leading-snug">{children}</div><div className="text-[13px]">{ans}</div>
    {extra && <div className="md:col-start-2 md:col-end-4">{extra}</div>}
  </div>
);

export function AcceptanceForm({ fileId, back, row, last, lastYear, editable, names }: {
  fileId: string; back: string; row: AccRow | null; last: AccRow | null; lastYear: string | null; editable: boolean; names: Record<string, string>;
}) {
  const [a, setA] = useState<AccRow>(row ?? emptyAcc());
  const set = (patch: Partial<AccRow>) => setA({ ...a, ...patch });
  const user = (kind: AccUser["kind"]) => a.users.find((u) => u.kind === kind);
  const setUser = (kind: AccUser["kind"], patch: Partial<AccUser> | null) => {
    const rest = a.users.filter((u) => u.kind !== kind);
    if (patch === null) return set({ users: rest });
    const cur = user(kind) ?? { kind, name: "", agreed: "" as YN };
    set({ users: [...rest, { ...cur, ...patch }].sort((x, y) => x.kind.localeCompare(y.kind)) });
  };
  const radio = (name: string, value: string, label: string, on: boolean, onPick: () => void) => (
    <label className="inline-flex items-center gap-1.5 whitespace-nowrap"><input type="radio" name={name} value={value} checked={on} onChange={onPick} disabled={!editable} className="h-4 w-4" />{label}</label>
  );
  const yn = (k: "q1" | "q2" | "q3" | "q4" | "q5" | "q9") => (
    <span className="flex gap-4">{radio(k, "yes", "Yes", a[k] === "yes", () => set({ [k]: "yes" }))}{radio(k, "no", "No", a[k] === "no", () => set({ [k]: "no" }))}</span>
  );
  // Last year's answer under the question, and who confirmed it this year.
  const lastLine = (k: string, value: string) => {
    const c = a.answered[k];
    if (!last && !c) return null;
    return (
      <p className="mt-0.5 text-[12px] text-ink-3">
        {last && lastYear && <>{lastYear} file: {value || "Not answered"}</>}
        {c?.same && row && <span className="text-success">{last ? " · " : ""}Confirmed by {names[c.by] ?? ""}, {short(c.at)}</span>}
      </p>
    );
  };
  const word = (v: string) => (v === "yes" ? "Yes" : v === "no" ? "No" : v === "confirmed" ? "Confirmed" : v === "different" ? "Different" : "");
  const note = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} disabled={!editable} maxLength={1000} placeholder={placeholder} className="input input-compact w-full" />
  );
  const lender = user("lender"), other = user("other");
  const confirmedAll = !!last && ["q1", "q2", "q3", "q4", "q5", "q6", "q8", "q9"].every((k) => a.answered[k]?.same);

  return (
    <section className="rounded-[10px] border border-sand-200 bg-white text-[13px]" aria-label="Acceptance and continuance">
      {last && lastYear && editable && !confirmedAll && (
        <form action={acceptanceSameAsLast} className="m-3 flex flex-wrap items-center gap-3 rounded-lg border border-navy-100 bg-navy-50/60 px-3 py-2 text-[12.5px]">
          <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={back} />
          <span className="flex-1">Rolled forward from the {lastYear} file. Confirm each answer.</span>
          <button type="submit" className="btn-secondary btn-compact">Same as last year for all</button>
        </form>
      )}
      <form action={saveAcceptance}>
        <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={back} />
        <input type="hidden" name="answers" value={JSON.stringify({ ...a, answered: undefined })} />
        <Q n={1} ans={yn("q1")}>The engagement letter on file covers this year-end.<InfoTip>A letter valid for future years counts. We do not ask for a new letter each year.</InfoTip>{MUST}{lastLine("q1", word(last?.q1 ?? ""))}</Q>
        <Q n={2} ans={yn("q2")}>Nothing has changed that needs new terms: same owners and management, same users, same basis of accounting, same services and fees.
          <InfoTip>A No means a new or amended engagement letter is needed before work continues.</InfoTip>{MUST}{lastLine("q2", word(last?.q2 ?? ""))}</Q>
        <Q n={3} ans={yn("q3")}>The engagement letter states management&rsquo;s responsibilities: for the financial information, its accuracy and completeness, and the basis of accounting.{MUST}{lastLine("q3", word(last?.q3 ?? ""))}</Q>
        <Q n={4} ans={yn("q4")}>We have met the ethical requirements of the CPA Ontario Code of Professional Conduct for this engagement.{MUST}{lastLine("q4", word(last?.q4 ?? ""))}</Q>
        <Q n={5} ans={yn("q5")} extra={a.q5 === "no" ? note(a.q5_note, (v) => set({ q5_note: v }), "What affects independence (for the file only)") : undefined}>
          Are we independent of the client?{lastLine("q5", word(last?.q5 ?? ""))}</Q>
        <Q n={6} ans={<span className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-1.5 text-ink-3"><input type="checkbox" checked disabled className="h-4 w-4" />Management</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!lender} disabled={!editable} onChange={(e) => setUser("lender", e.target.checked ? {} : null)} className="h-4 w-4" />A lender</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!other} disabled={!editable} onChange={(e) => setUser("other", e.target.checked ? {} : null)} className="h-4 w-4" />Other</label>
          </span>}
          extra={(lender || other) && <div className="grid gap-2 md:grid-cols-2">
            {lender && <label className="flex items-center gap-2 text-[12px] text-ink-3">Lender{note(lender.name, (v) => setUser("lender", { name: v }), "Name the lender")}</label>}
            {other && <label className="flex items-center gap-2 text-[12px] text-ink-3">Other{note(other.name, (v) => setUser("other", { name: v }), "Name the user")}</label>}
          </div>}>
          Who will use the statements?{lastLine("q6", last ? ["Management", ...last.users.map(userWord)].join("; ") : "")}</Q>
        {/* Question 7, once per outside user, with the user's name. */}
        {a.users.map((u) => (
          <Q key={u.kind} n={7} ans={<span className="flex gap-4">{radio(`q7_${u.kind}`, "yes", "Yes", u.agreed === "yes", () => setUser(u.kind, { agreed: "yes" }))}{radio(`q7_${u.kind}`, "no", "No", u.agreed === "no", () => setUser(u.kind, { agreed: "no" }))}</span>}>
            Management confirmed {u.name.trim() || (u.kind === "lender" ? "the lender" : "the user")} agreed a compilation meets its needs.{MUST}</Q>
        ))}
        <Q n={8} ans={<span className="flex gap-4">{radio("q8", "confirmed", "Confirmed", a.q8 === "confirmed", () => set({ q8: "confirmed" }))}{radio("q8", "different", "Different", a.q8 === "different", () => set({ q8: "different" }))}</span>}
          extra={a.q8 === "different" ? note(a.q8_note, (v) => set({ q8_note: v }), "How the basis differs") : undefined}>
          Basis of accounting: the Note 1 basis (historical cost with the listed accruals), with management&rsquo;s acknowledgment recorded.{lastLine("q8", word(last?.q8 ?? ""))}</Q>
        <Q n={9} ans={yn("q9")}>The basis is acceptable to everyone who will use the statements.<InfoTip>If a third party needs ASPE, this basis cannot be used.</InfoTip>{MUST}{lastLine("q9", word(last?.q9 ?? ""))}</Q>
        {editable && <div className="border-t border-sand-200 px-3.5 py-2.5"><button type="submit" className="btn btn-compact">Save</button></div>}
      </form>
    </section>
  );
}
