"use client";
// Round 16 (Hashim): step 1's acceptance and continuance record (CSRS 4200), as CaseWare Cloud's
// engagement acceptance form. Nine questions; the preparer answers, the reviewer signs it with step 1. It
// rolls forward each year: last year's answer shows under each question, and "Same as last year for all"
// confirms every answer at once. Each answer records who confirmed it and when.
import { useState } from "react";
import { InfoTip } from "@/components/ds/info-tip";
import Link from "next/link";
import { acceptanceConfirmClient, acceptanceSameAsLast, saveAcceptance } from "../round16-actions";

import { basisWords, emptyAcc, sameBasis, sameUsers, usersWords, type AccRow, type AccUser, type Statements } from "@/lib/closebook/acceptance";

const MUST = <span className="ml-1.5 rounded bg-sand-100 px-1.5 py-0.5 text-xs whitespace-nowrap text-ink-2">Must be Yes</span>;
const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" });

// One question row: number, question, answer, and an optional line under it (module level: not created during render).
const Q = ({ n, children, ans, extra }: { n: number; children: React.ReactNode; ans: React.ReactNode; extra?: React.ReactNode }) => (
  <div className="grid gap-x-4 gap-y-1.5 border-t border-sand-100 px-3.5 py-2.5 first:border-0 md:grid-cols-[1.75rem_minmax(0,1fr)_auto]">
    <span className="text-ink-3 tabular-nums">{n}.</span><div className="leading-snug">{children}</div><div className="text-[13px]">{ans}</div>
    {extra && <div className="md:col-start-2 md:col-end-4">{extra}</div>}
  </div>
);

export function AcceptanceForm({ fileId, clientId, back, row, last, lastYear, editable, locked, client, names, me }: {
  fileId: string; clientId: string; back: string; row: AccRow | null; last: AccRow | null; lastYear: string | null; editable: boolean; locked: boolean; client: Statements; names: Record<string, string>; me: string;
}) {
  const [a, setA] = useState<AccRow>(row ?? emptyAcc());
  const set = (patch: Partial<AccRow>) => setA({ ...a, ...patch });
  const setAgreed = (u: AccUser, agreed: AccUser["agreed"]) => set({ users: a.users.map((x) => (x.kind === u.kind && x.name === u.name ? { ...x, agreed } : x)) });
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
  // Round 18: questions 6 and 8 read the client record. The file keeps what was confirmed for this year
  // (read-only); a locked file shows only that record, never today's client. Round 18 fix (Hashim): one
  // status line on the face, next to the button; the record and the explanations sit behind the "i".
  const conf = row?.confirmed ?? null;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Toronto", ...(new Date(iso).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
  const who = conf ? (conf.by === me ? "you" : names[conf.by] ?? "someone") : "";
  // Each question compares its own part: question 6 the users, question 8 the basis. Confirm records both.
  const face = (same: boolean) => {
    const status = !conf ? <span className="text-warning">Not confirmed for this year</span>
      : same || locked ? <span className="text-success">Confirmed by {conf.by === me ? "you" : names[conf.by] ?? ""}, {short(conf.at)}</span>
      : <span className="text-warning">Changed since {who} confirmed it on {day(conf.at)}</span>;
    // A button of the acceptance form that posts to its own action (forms cannot nest).
    const btn = !locked && editable && !(conf && same) && (
      <button type="submit" formAction={acceptanceConfirmClient} formNoValidate className="btn btn-compact whitespace-nowrap">{conf ? "Confirm again" : "Confirm"}</button>
    );
    return <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-[12.5px]">{status}{btn}</span>;
  };
  const usersSame = sameUsers(conf, client), basisSame = sameBasis(conf, client);
  const tip = (label: string, now: string, then: string | null, lastValue: string, same: boolean) => (
    <InfoTip label="Details">
      {locked ? <>Confirmed for this year: <b>{then ?? "Not confirmed"}</b></> : <>From the client record: <b>{now}</b>{" "}
        {editable && <Link href={`/clients/${clientId}?edit=statements`} className="text-navy-700 underline">Change</Link>}</>}
      {!locked && conf && !same && then && <span className="mt-1 block">Confirmed before: {then}</span>}
      {!locked && <span className="mt-1 block">A change is made on the client record. {label}</span>}
      {last && lastYear && <span className="mt-1 block text-ink-3">{lastYear} file: {lastValue || "Not answered"}</span>}
    </InfoTip>
  );
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
        <Q n={6} ans={face(usersSame)}>
          Who will use the statements?{tip("Who and when go in the client's activity.", usersWords(client.users), conf ? usersWords(conf.users) : null, last?.confirmed ? usersWords(last.confirmed.users) : "", usersSame)}</Q>
        {/* Question 7, once per outside user confirmed for this year, with the user's name. */}
        {a.users.map((u) => (
          <Q key={`${u.kind}:${u.name}`} n={7} ans={<span className="flex gap-4">{radio(`q7_${u.kind}_${u.name}`, "yes", "Yes", u.agreed === "yes", () => setAgreed(u, "yes"))}{radio(`q7_${u.kind}_${u.name}`, "no", "No", u.agreed === "no", () => setAgreed(u, "no"))}</span>}>
            Management confirmed {u.name} agreed a compilation meets its needs.{MUST}</Q>
        ))}
        <Q n={8} ans={face(basisSame)}>
          The basis of accounting is the one on the client record, with management&rsquo;s acknowledgment recorded.{tip("The client's activity records the change.", basisWords(client), conf ? basisWords(conf) : null, last?.confirmed ? basisWords(last.confirmed) : "", basisSame)}</Q>
        <Q n={9} ans={yn("q9")}>The basis is acceptable to everyone who will use the statements.<InfoTip>If a third party needs ASPE, this basis cannot be used.</InfoTip>{MUST}{lastLine("q9", word(last?.q9 ?? ""))}</Q>
        {editable && <div className="border-t border-sand-200 px-3.5 py-2.5"><button type="submit" className="btn btn-compact">Save</button></div>}
      </form>
    </section>
  );
}
