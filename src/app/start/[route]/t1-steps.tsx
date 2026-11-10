"use client";
// The public personal tax form as steps (Hashim, Nov 10; layout only). How the steps map onto the
// published questions' answer keys: src/lib/screening/t1-steps.ts.
import { startTransition, useActionState, useMemo, useState } from "react";
import { ProgressBar } from "@/components/ds/client";
import { Field, type FormQuestionnaire } from "@/components/screening-form";
import { QUICK, TILES, buildT1Answers, type Who } from "@/lib/screening/t1-steps";
import { earlyOutOfScope, evaluate, isVisible, type Answer, type Answers, type Question } from "@/lib/screening/engine";
import { fillRuleValues, type T1Rules } from "@/lib/screening/t1-v2";
import { PROVINCES } from "@/lib/leads/provinces";
import { submitPersonal } from "../actions";

type StepId = "about" | "who" | "quick" | "happened" | "details" | "last";
const PERSON = ["You", "Your spouse or partner"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function T1Steps({ qn, sources, rules, taxYear }: { qn: FormQuestionnaire; sources: string[]; rules: T1Rules; taxYear: number }) {
  const byKey = useMemo(() => new Map(qn.questions.map((q) => [q.key, q])), [qn.questions]);
  const [result, formAction, pending] = useActionState(submitPersonal, null);
  const [t] = useState(() => Date.now());
  const [step, setStep] = useState<StepId>("about");
  const [contact, setContact] = useState({ first_name: "", last_name: "", email: "", phone: "", province: "" });
  const [filing, setFiling] = useState<"" | "single" | "couple">("");
  const [spouse, setSpouse] = useState({ spouse_first_name: "", spouse_last_name: "", spouse_email: "" });
  const [quick, setQuick] = useState<Set<string> | "none" | null>(null);
  const [tiles, setTiles] = useState<Map<string, Who | "yes"> | "none" | null>(null);
  const [details, setDetails] = useState<Record<string, Answer>>({});
  const [personDetails, setPersonDetails] = useState<Record<string, Answer>[]>([{}, {}]);
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const couple = filing === "couple";
  const count = couple ? 2 : 1;
  const perPerson = (key: string) => byKey.get(key)?.per_person ?? false;
  const ticked = tiles instanceof Map ? tiles : new Map<string, Who | "yes">();

  // The answers in the published questions' own keys.
  const answers: Answers = useMemo(() => buildT1Answers({ filing, spouse, quick, tiles, details, personDetails, note }, perPerson),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filing, spouse, quick, tiles, details, personDetails, note]);

  const followUps = TILES.filter((tile) => ticked.has(tile.key)).flatMap((tile) => tile.follow.map((k) => byKey.get(k)).filter(Boolean) as Question[]);
  const visibleFollowUps = followUps.filter((q) => q.per_person ? answers.people.some((p) => isVisible(q, { ...answers.household, ...p })) : isVisible(q, answers.household));
  // A few details is counted until the tiles show it is not needed, so the total does not jump up.
  const steps: StepId[] = ["about", "who", "quick", "happened", ...(tiles === null || followUps.length > 0 ? ["details" as const] : []), "last"];
  const index = steps.indexOf(step);
  const oos = earlyOutOfScope(qn, answers);

  // Errors the engine finds for the questions on this step (same checks as the server).
  const engineErrors = (keys: string[]) => {
    const r = evaluate({ ...qn, rules: qn.rules.filter((x) => x.kind !== "add_item") }, answers, []);
    return r.errors.filter((e) => keys.includes(e.key));
  };
  const detailErrors = step === "details" ? engineErrors(followUps.map((q) => q.key)) : [];
  const errorFor = (key: string, person: number | null) => showErrors ? detailErrors.find((e) => e.key === key && e.person === person)?.message : undefined;

  function check(): string {
    if (step === "about") {
      if (!contact.first_name.trim() || !contact.last_name.trim()) return "Enter your first and last name.";
      if (!EMAIL.test(contact.email.trim())) return "Enter a valid email address.";
      if (!/^[0-9 ()+.-]{7,25}$/.test(contact.phone.trim())) return "Enter your phone number, for example 226-789-9591.";
      if (!contact.province) return "Choose your province or territory.";
    }
    if (step === "who") {
      if (!filing) return "Choose who is filing.";
      if (couple && (!spouse.spouse_first_name.trim() || !spouse.spouse_last_name.trim())) return "Enter your spouse or partner's first and last name.";
      if (couple && !EMAIL.test(spouse.spouse_email.trim())) return "Enter your spouse or partner's email.";
    }
    if (step === "quick" && (quick === null || (quick !== "none" && quick.size === 0))) return "Tick what applies, or None of these.";
    if (step === "happened") {
      if (tiles === null || (tiles !== "none" && tiles.size === 0)) return "Tick everything that applies, or None of these.";
      if (couple && [...ticked].some(([k, v]) => perPerson(k) && v === "yes")) return "For each ticked item, choose Me, Spouse or Both.";
    }
    if (step === "details" && detailErrors.length > 0) return "Please answer the questions marked in red.";
    if (step === "last" && !source) return "Tell us how you heard about us.";
    return "";
  }
  const go = (d: 1 | -1) => {
    if (d === 1) { const p = check(); setShowErrors(!!p); setProblem(p); if (p) return; }
    setProblem(""); setShowErrors(false);
    setStep(steps[Math.max(0, Math.min(steps.length - 1, index + d))]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const send = () => {
    if (!oos.length) { const p = check(); setProblem(p); setShowErrors(!!p); if (p) return; }
    const fd = new FormData();
    Object.entries(contact).forEach(([k, v]) => fd.set(k, v));
    fd.set("answers", JSON.stringify(answers)); fd.set("source", source); fd.set("t", String(t)); fd.set("website", "");
    startTransition(() => formAction(fd));
  };
  // An out-of-scope answer on this step: stop here and offer to send the details (routes to Hashim).
  const stopHere = oos.length > 0 && (step === "quick" || step === "details");

  const set = (key: string, v: Answer) => setDetails((d) => ({ ...d, [key]: v }));
  const setP = (i: number, key: string, v: Answer) => setPersonDetails((ps) => ps.map((p, j) => (j === i ? { ...p, [key]: v } : p)));
  const toggleQuick = (key: string) => setQuick((q) => { const s = new Set(q instanceof Set ? q : []); if (s.has(key)) s.delete(key); else s.add(key); return s; });
  const toggleTile = (key: string) => setTiles((m) => { const n = new Map(m instanceof Map ? m : []); if (n.has(key)) n.delete(key); else n.set(key, couple && perPerson(key) ? "yes" : "me"); return n; });
  const whoTile = (key: string, v: Who) => setTiles((m) => new Map(m instanceof Map ? m : []).set(key, v));

  const titles: Record<StepId, string> = { about: "About you", who: "Who's filing", quick: "Quick check", happened: `What happened in ${taxYear}`, details: "A few details", last: "Last" };
  const box = "rounded-xl border px-4 py-3 text-left text-sm transition-colors";
  const on = "border-navy-700 bg-navy-50 ring-1 ring-navy-700";
  const off = "border-sand-200 bg-surface hover:border-navy-300";

  return (
    <div className="space-y-6">
      <ProgressBar value={(index + 1) / steps.length} label={`Step ${index + 1} of ${steps.length}`} />
      <h1 className="text-2xl font-semibold tracking-tight">{titles[step]}</h1>

      {step === "about" && (
        <div className="card grid gap-4">
          <p className="text-sm text-ink-2">{qn.intro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="first_name" className="label">First name</label><input id="first_name" autoComplete="given-name" value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} className="input" /></div>
            <div><label htmlFor="last_name" className="label">Last name</label><input id="last_name" autoComplete="family-name" value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} className="input" /></div>
          </div>
          <div><label htmlFor="email" className="label">Email</label><input id="email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className="input" /></div>
          <div><label htmlFor="phone" className="label">Phone</label><input id="phone" type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} className="input" /></div>
          <div>
            <label htmlFor="province" className="label">Province or territory you lived in on December 31</label>
            <span className="mb-2 block text-xs text-muted">This sets the GST/HST on your quote.</span>
            <select id="province" value={contact.province} onChange={(e) => setContact({ ...contact, province: e.target.value })} className="input">
              <option value="" disabled>Choose one</option>
              {PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </div>
        </div>
      )}

      {step === "who" && (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Who is filing?">
            {(byKey.get("filing_type")?.options ?? []).map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={filing === o.value} onClick={() => setFiling(o.value as "single" | "couple")}
                className={`${box} min-h-24 px-5 py-5 text-base font-medium ${filing === o.value ? on : off}`}>{o.label}</button>
            ))}
          </div>
          {couple && (
            <div className="card grid gap-4">
              {(["spouse_first_name", "spouse_last_name", "spouse_email"] as const).map((k) => {
                const q = byKey.get(k);
                return (
                  <div key={k}>
                    <label htmlFor={k} className="label">{q?.prompt ?? k}</label>
                    {q?.help_text && <span className="mb-2 block text-xs text-muted">{q.help_text}</span>}
                    <input id={k} type={k === "spouse_email" ? "email" : "text"} value={spouse[k]} onChange={(e) => setSpouse({ ...spouse, [k]: e.target.value })} className="input" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === "quick" && (
        <div className="card grid gap-3">
          <p className="font-medium">Do any of these apply{couple ? " to you or your spouse or partner" : " to you"}?</p>
          {QUICK.map((q) => (
            <label key={q.key} className={`${box} flex items-start gap-3 ${quick instanceof Set && quick.has(q.key) ? on : off}`}>
              <input type="checkbox" checked={quick instanceof Set && quick.has(q.key)} onChange={() => toggleQuick(q.key)} className="mt-0.5 h-4 w-4 accent-accent" />
              <span>{q.label}</span>
            </label>
          ))}
          <label className={`${box} flex items-start gap-3 ${quick === "none" ? on : off}`}>
            <input type="checkbox" checked={quick === "none"} onChange={() => setQuick(quick === "none" ? null : "none")} className="mt-0.5 h-4 w-4 accent-accent" />
            <span className="font-medium">None of these</span>
          </label>
        </div>
      )}

      {step === "happened" && (
        <div className="grid gap-3">
          <p className="font-medium">Your base fee already covers employment (T4), pension and investment slips. Tick anything else that applies{couple ? " to you or your spouse or partner" : ""}.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TILES.map((tile) => {
              const v = ticked.get(tile.key);
              return (
                <div key={tile.key} className={`${box} ${v ? on : off}`}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={!!v} onChange={() => toggleTile(tile.key)} className="mt-0.5 h-4 w-4 accent-accent" />
                    <span className="font-medium">{fillRuleValues(tile.label, rules)}</span>
                  </label>
                  {v && couple && perPerson(tile.key) && (
                    <div className="mt-3 flex flex-wrap gap-2 pl-7" role="radiogroup" aria-label={`Who: ${tile.label}`}>
                      {(["me", "spouse", "both"] as Who[]).map((w) => (
                        <button key={w} type="button" role="radio" aria-checked={v === w} onClick={() => whoTile(tile.key, w)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${v === w ? "border-navy-700 bg-navy-700 text-white" : "border-sand-300 bg-surface text-ink-2"}`}>
                          {w === "me" ? "Me" : w === "spouse" ? "Spouse" : "Both"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <label className={`${box} flex items-start gap-3 ${tiles === "none" ? on : off}`}>
            <input type="checkbox" checked={tiles === "none"} onChange={() => setTiles(tiles === "none" ? null : "none")} className="mt-0.5 h-4 w-4 accent-accent" />
            <span className="font-medium">None of these</span>
          </label>
        </div>
      )}

      {step === "details" && (
        <div className="card grid gap-5">
          {visibleFollowUps.map((q) => q.per_person ? (
            <div key={q.key} className={count > 1 ? "grid gap-4 md:grid-cols-2" : ""}>
              {answers.people.map((p, i) => isVisible(q, { ...answers.household, ...p }) && (
                <Field key={i} q={q} idSuffix={`p${i}`} personLabel={count > 1 ? PERSON[i] : undefined} value={personDetails[i][q.key]}
                  error={errorFor(q.key, i)} onChange={(v) => setP(i, q.key, v)} />
              ))}
            </div>
          ) : (
            <Field key={q.key} q={q} idSuffix="h" value={details[q.key]} error={errorFor(q.key, null)} onChange={(v) => set(q.key, v)} />
          ))}
        </div>
      )}

      {step === "last" && (
        <div className="card grid gap-4">
          <div>
            <label htmlFor="source" className="label">How did you hear about us?</label>
            <select id="source" value={source} onChange={(e) => setSource(e.target.value)} className="input">
              <option value="">Choose one</option>
              {sources.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="anything_else" className="label">{byKey.get("anything_else")?.prompt ?? "Anything else we should know?"} <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="anything_else" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </div>
          <p className="text-xs text-muted">By clicking Get my quote, you agree that Concept Accounting can use your answers to prepare your quote.</p>
        </div>
      )}

      {stopHere && (
        <div role="status" className="card border-warning/40 bg-warning-soft text-sm">
          <p className="font-medium">Thank you. Your situation needs a closer look than our online quote can give.</p>
          <p className="mt-1">Send your details and a member of our team will review your answers and contact you.</p>
        </div>
      )}
      {(problem || result?.message || (result && result.errors.length > 0)) && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {problem || result?.message || "Some answers need another look. Go back and check each step."}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        {index > 0 ? <button type="button" onClick={() => go(-1)} className="btn-secondary">Back</button> : <span />}
        {stopHere ? <button type="button" onClick={send} disabled={pending} className="btn">{pending ? "Sending..." : "Send my details"}</button>
          : step === "last" ? <button type="button" onClick={send} disabled={pending} className="btn">{pending ? "Sending..." : "Get my quote"}</button>
          : <button type="button" onClick={() => go(1)} className="btn">Next</button>}
      </div>
    </div>
  );
}
