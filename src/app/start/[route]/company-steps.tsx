"use client";
// The company form (Phase 2 batch, section 10), as steps. Questions exactly as written there; the
// [bracketed] staff and pricing notes never show. "Your details" is saved first, so a lead who stops
// partway is still captured.
import { useState, useTransition } from "react";
import { ProgressBar } from "@/components/ds/client";
import { PROVINCES } from "@/lib/leads/provinces";
import { BOOKS, COUNTS, FLAGS, MONTHS, NEED, PEOPLE, REVENUE, UPTODATE, type Books, type CorpAnswers } from "@/lib/corporate/quote";
import { finishCompany, startCompany } from "../actions";

type Step = "details" | "need" | "books" | "company" | "apply" | "size";
const box = "rounded-xl border px-4 py-3 text-left text-sm transition-colors";
const on = "border-navy-700 bg-navy-50 ring-1 ring-navy-700";
const off = "border-sand-200 bg-surface hover:border-navy-300";

export function CompanySteps() {
  const [t] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>("details");
  const [problem, setProblem] = useState("");
  const [lead, setLead] = useState<{ leadId: string; token: string } | null>(null);
  const [contact, setContact] = useState({ first_name: "", last_name: "", email: "", province: "" });
  const [need, setNeed] = useState<CorpAnswers["need"] | "">("");
  const [extras, setExtras] = useState({ gst: false, slips: false });
  const [books, setBooks] = useState<Books | "">("");
  const [counts, setCounts] = useState<Record<string, string>>({ bank: "", cc: "", loc: "", loan: "", car: "" });
  const [ye, setYe] = useState({ month: "", day: "", unsure: false });
  const [business, setBusiness] = useState("");
  const [flags, setFlags] = useState({ behind: false, multi: false, property: false, cra: false });
  const [size, setSize] = useState<{ revenue: string; people: string; uptodate: string }>({ revenue: "", people: "", uptodate: "" });

  const steps: Step[] = ["details", "need", "books", "company", "apply", ...(need === "monthly" ? ["size" as const] : [])];
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;

  const answers = (): CorpAnswers => ({
    form: "corporate-v1", need: need as CorpAnswers["need"], extras, books: books as Books,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])) as CorpAnswers["counts"],
    ye: ye.unsure ? null : { month: Number(ye.month), day: Number(ye.day) }, business, flags,
    ...(need === "monthly" ? { monthly: size as NonNullable<CorpAnswers["monthly"]> } : {}),
  });

  function check(): string {
    if (step === "need" && !need) return "Choose what you need.";
    if (step === "books") {
      if (!books) return "Tell us how your company's books are kept today.";
      if (books === "statements" && COUNTS.some(([k]) => !/^\d{1,2}$/.test(counts[k]))) return "Enter how many of each the company has. Enter 0 if none.";
    }
    if (step === "company") {
      if (!ye.unsure && (!ye.month || !ye.day)) return "Choose the month and day your company's year ends, or tick I'm not sure.";
      if (!business.trim()) return "Tell us what your company does.";
    }
    if (step === "size" && (!size.revenue || !size.people || !size.uptodate)) return "Answer the three questions.";
    return "";
  }

  const next = () => {
    setProblem("");
    if (step === "details") {
      const fd = new FormData();
      Object.entries(contact).forEach(([k, v]) => fd.set(k, v));
      fd.set("t", String(t)); fd.set("website", "");
      start(async () => {
        // Saved once; going back and forward does not create a second lead.
        if (lead) { setStep("need"); return; }
        const r = await startCompany(fd);
        if ("error" in r) setProblem(r.error); else { setLead(r); setStep("need"); }
      });
      return;
    }
    const p = check();
    if (p) { setProblem(p); return; }
    if (!last) { setStep(steps[index + 1]); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    start(async () => {
      const r = await finishCompany(lead!.leadId, lead!.token, JSON.stringify(answers()));
      if (r?.error) setProblem(r.error);
    });
  };

  const radio = <T extends string>(name: string, value: T | "", set: (v: T) => void, options: [T, string][]) => (
    <div className="grid gap-2" role="radiogroup">
      {options.map(([v, label]) => (
        <label key={v} className={`${box} flex items-start gap-3 ${value === v ? on : off}`}>
          <input type="radio" name={name} checked={value === v} onChange={() => set(v)} className="mt-0.5 h-4 w-4 accent-accent" /><span>{label}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <ProgressBar value={(index + 1) / steps.length} label={`Step ${index + 1} of ${steps.length}`} />

      {step === "details" && (
        <div className="grid gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Your details</h1>
          <div className="card grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="first_name" className="label">First name *</label><input id="first_name" autoComplete="given-name" value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} className="input" /></div>
              <div><label htmlFor="last_name" className="label">Last name *</label><input id="last_name" autoComplete="family-name" value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} className="input" /></div>
            </div>
            <div><label htmlFor="email" className="label">Email *</label><input id="email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className="input" /></div>
            <div><label htmlFor="province" className="label">Province *</label>
              <select id="province" value={contact.province} onChange={(e) => setContact({ ...contact, province: e.target.value })} className="input">
                <option value="" disabled>Choose one</option>{PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select></div>
          </div>
        </div>
      )}

      {step === "need" && (
        <div className="grid gap-6">
          <div className="grid gap-3"><h1 className="text-2xl font-semibold tracking-tight">1. What do you need? *</h1>
            {radio("need", need, setNeed, [["year_end", NEED.year_end], ["monthly", NEED.monthly]])}</div>
          <div className="grid gap-3"><h2 className="text-lg font-semibold">2. Do you also need any of these?</h2><p className="text-sm text-ink-2">Check any that apply.</p>
            {([["gst", "GST/HST return"], ["slips", "Tax slips for people the company paid (employees, contractors or yourself)"]] as const).map(([k, label]) => (
              <label key={k} className={`${box} flex items-start gap-3 ${extras[k] ? on : off}`}>
                <input type="checkbox" checked={extras[k]} onChange={() => setExtras({ ...extras, [k]: !extras[k] })} className="mt-0.5 h-4 w-4 accent-accent" /><span>{label}</span>
              </label>
            ))}</div>
        </div>
      )}

      {step === "books" && (
        <div className="grid gap-6">
          <div className="grid gap-3"><h1 className="text-2xl font-semibold tracking-tight">3. How are your company&rsquo;s books kept today? *</h1>
            {radio("books", books, setBooks, Object.entries(BOOKS) as [Books, string][])}</div>
          {books === "statements" && (
            <div className="card grid gap-3"><h2 className="font-semibold">4. How many of these does the company have?</h2>
              {COUNTS.map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-3 text-sm"><span>{label}</span>
                  <input inputMode="numeric" value={counts[k]} onChange={(e) => setCounts({ ...counts, [k]: e.target.value.replace(/\D/g, "").slice(0, 2) })} aria-label={label} className="input w-20 text-right" /></label>
              ))}</div>
          )}
        </div>
      )}

      {step === "company" && (
        <div className="grid gap-6">
          <div className="grid gap-3"><h1 className="text-2xl font-semibold tracking-tight">5. When does your company&rsquo;s year end?</h1>
            <div className="flex flex-wrap gap-3">
              <select aria-label="Month" value={ye.month} disabled={ye.unsure} onChange={(e) => setYe({ ...ye, month: e.target.value })} className="input w-auto">
                <option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
              <select aria-label="Day" value={ye.day} disabled={ye.unsure} onChange={(e) => setYe({ ...ye, day: e.target.value })} className="input w-auto">
                <option value="">Day</option>{[...Array(31).keys()].map((d) => <option key={d} value={d + 1}>{d + 1}</option>)}</select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ye.unsure} onChange={() => setYe({ month: "", day: "", unsure: !ye.unsure })} className="h-4 w-4 accent-accent" />I&rsquo;m not sure</label></div>
          <div className="grid gap-2"><label htmlFor="business" className="text-lg font-semibold">6. What does your company do? *</label>
            <input id="business" value={business} maxLength={200} onChange={(e) => setBusiness(e.target.value)} placeholder="for example: real estate, dental office, IT consulting" className="input" /></div>
        </div>
      )}

      {step === "apply" && (
        <div className="grid gap-3"><h1 className="text-2xl font-semibold tracking-tight">7. Do any of these apply?</h1><p className="text-sm text-ink-2">Check any that apply.</p>
          {FLAGS.map(([k, label]) => (
            <label key={k} className={`${box} flex items-start gap-3 ${flags[k] ? on : off}`}>
              <input type="checkbox" checked={flags[k]} onChange={() => setFlags({ ...flags, [k]: !flags[k] })} className="mt-0.5 h-4 w-4 accent-accent" /><span>{label}</span>
            </label>
          ))}</div>
      )}

      {step === "size" && (
        <div className="grid gap-6">
          <div className="grid gap-3"><h1 className="text-2xl font-semibold tracking-tight">A. Roughly how much does the company earn in a year, before expenses?</h1>
            {radio("revenue", size.revenue, (v) => setSize({ ...size, revenue: v }), Object.entries(REVENUE) as [string, string][])}</div>
          <div className="grid gap-3"><h2 className="text-lg font-semibold">B. How many people does the company pay?</h2>
            {radio("people", size.people, (v) => setSize({ ...size, people: v }), Object.entries(PEOPLE) as [string, string][])}</div>
          <div className="grid gap-3"><h2 className="text-lg font-semibold">C. Are your books up to date today?</h2>
            {radio("uptodate", size.uptodate, (v) => setSize({ ...size, uptodate: v }), Object.entries(UPTODATE) as [string, string][])}</div>
        </div>
      )}

      {problem && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{problem}</p>}
      <div className="flex items-center justify-between gap-3">
        {index > 0 ? <button type="button" onClick={() => { setProblem(""); setStep(steps[index - 1]); }} className="btn-secondary">Back</button> : <span />}
        <button type="button" onClick={next} disabled={pending} className="btn">{pending ? "Sending..." : last ? "Get my quote" : "Next"}</button>
      </div>
    </div>
  );
}
