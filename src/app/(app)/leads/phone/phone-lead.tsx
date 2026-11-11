"use client";
// New lead by phone (front office batch, section 2; mockup 1-Leads): who is calling, what they need,
// then the same screening the client sees online, with a live price panel for staff with Pricing.
// Staff tell the caller the one total, never line prices.
import { useRef, useState } from "react";
import type { FormQuestionnaire } from "@/components/screening-form";
import type { T1Rules } from "@/lib/screening/t1-v2";
import type { PhoneContact } from "@/lib/leads/phone";
import { T1Steps } from "../../../start/[route]/t1-steps";
import { CompanySteps } from "../../../start/[route]/company-steps";
import { finishPhoneCompany, finishPhonePersonal, phonePrice } from "./actions";

export type PickClient = { id: string; name: string; contact: PhoneContact };
const money = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: c % 100 ? 2 : 0 });

export function PhoneLead({ qn, rules, taxYear, clients, pricing }: { qn: FormQuestionnaire | null; rules: T1Rules; taxYear: number; clients: PickClient[]; pricing: boolean }) {
  const [form, setForm] = useState<"" | "personal" | "company">("");
  const [clientId, setClientId] = useState("");
  const picked = clients.find((c) => c.id === clientId) ?? null;
  const [price, setPrice] = useState<{ total_cents: number | null; note: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAnswers = (json: string) => {
    if (!pricing || !form) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { phonePrice(form, json).then(setPrice, () => setPrice({ total_cents: null, note: "The price could not be worked out right now." })); }, 400);
  };
  const box = "rounded-xl border px-4 py-3 text-left text-sm transition-colors";
  const on = "border-navy-700 bg-navy-50 ring-1 ring-navy-700", off = "border-sand-200 bg-surface hover:border-navy-300";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="grid gap-6">
        <section className="card grid gap-4">
          <h2 className="font-semibold">1. Who is calling</h2>
          <div>
            <label htmlFor="pick" className="label">An existing client? <span className="font-normal text-muted">(optional: fills in their details)</span></label>
            <select id="pick" value={clientId} onChange={(e) => setClientId(e.target.value)} className="input">
              <option value="">No, a new caller</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <h2 className="font-semibold">2. What they need</h2>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {([["personal", "My personal tax return"], ["company", "My company"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={form === k} onClick={() => { setForm(k); setPrice(null); }} className={`${box} ${form === k ? on : off}`}>{l}</button>
            ))}
          </div>
          <p className="text-xs text-muted">Next, the same questions the client sees online, in the same order. The name and contact details come first.</p>
        </section>
        {form === "personal" && (qn
          ? <T1Steps key={`p-${clientId}`} qn={qn} sources={[]} rules={rules} taxYear={taxYear} staff={{ action: finishPhonePersonal.bind(null, clientId || null), onAnswers, contact: picked?.contact ?? null }} />
          : <p className="card text-sm text-danger">The personal tax questions are not published. Tell Hashim.</p>)}
        {form === "company" && <CompanySteps key={`c-${clientId}`} staff={{ finish: finishPhoneCompany.bind(null, clientId || null), onAnswers, contact: picked?.contact ?? null }} />}
      </div>
      {pricing && (
        <aside className="card grid gap-2 lg:sticky lg:top-6" aria-live="polite">
          <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Price (staff only)</p>
          {!form ? <p className="text-sm text-ink-2">Choose what they need to see the price.</p>
            : price?.total_cents != null ? <p className="text-3xl font-semibold tabular-nums">{money(price.total_cents)} <span className="text-base font-normal text-ink-2">+ HST</span></p>
            : <p className="text-sm text-ink-2">{price?.note || "Answer the questions to see the price."}</p>}
          {price?.total_cents != null && price.note && <p className="text-xs text-warning">{price.note}</p>}
          <p className="text-xs text-muted">Tell the caller this one total. Never read out line prices. It comes from the live price book, the same as the online quote.</p>
        </aside>
      )}
    </div>
  );
}
