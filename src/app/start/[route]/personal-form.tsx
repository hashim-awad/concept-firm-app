"use client";
// The public personal tax form (Phase 2 batch, section 4): your details, the screening questions,
// how you heard about us, and consent. No prices are shown and none are sent to the browser.
import { useState } from "react";
import { ScreeningForm, type FormQuestionnaire } from "@/components/screening-form";
import { PROVINCES } from "@/lib/leads/provinces";
import { submitPersonal } from "../actions";

export function PersonalForm({ qn, sources }: { qn: FormQuestionnaire; sources: string[] }) {
  const [t] = useState(() => Date.now());
  const before = (
    <fieldset className="card space-y-4">
      <legend className="px-1 font-semibold">About you</legend>
      <input type="hidden" name="t" value={t} />
      {/* Spam trap: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="first_name" className="label">First name</label><input id="first_name" name="first_name" required autoComplete="given-name" className="input" /></div>
        <div><label htmlFor="last_name" className="label">Last name</label><input id="last_name" name="last_name" required autoComplete="family-name" className="input" /></div>
      </div>
      <div><label htmlFor="email" className="label">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
      <div><label htmlFor="phone" className="label">Phone</label><input id="phone" name="phone" type="tel" required autoComplete="tel" className="input" /></div>
      <div>
        <label htmlFor="province" className="label">Province or territory you lived in on December 31</label>
        <span className="mb-2 block text-xs text-muted">This sets the GST/HST on your quote.</span>
        <select id="province" name="province" required defaultValue="" className="input">
          <option value="" disabled>Choose one</option>
          {PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
    </fieldset>
  );
  const after = (
    <fieldset className="card space-y-4">
      <legend className="px-1 font-semibold">Last</legend>
      <div>
        <label htmlFor="source" className="label">How did you hear about us?</label>
        <select id="source" name="source" required defaultValue="" className="input">
          <option value="" disabled>Choose one</option>
          {sources.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-accent" />
        <span>I agree that Concept Accounting can use my answers to prepare a quote.</span>
      </label>
    </fieldset>
  );
  return (
    <ScreeningForm qn={qn} action={submitPersonal} submitLabel="Send my answers" showPrices={false} before={before} after={after}
      stopOnOutOfScope={{
        submitLabel: "Send my details",
        message: <>
          <p className="font-medium">Thank you. Your situation needs a closer look than our online quote can give.</p>
          <p className="mt-1">Send your details and a member of our team will review your answers and contact you.</p>
        </>,
      }} />
  );
}
