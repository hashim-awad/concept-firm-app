"use client";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ds/primitives";
import { PROVINCES } from "@/lib/leads/provinces";
import { submitStart, type StartState } from "../actions";

// "About you" (batch section 4, questions 1 and 2; section 10, your details). The rest of the questions
// arrive with Phase 2 steps 6 (personal) and 9 (company).
export function StartForm({ route }: { route: "personal" | "company" }) {
  const [state, action, pending] = useActionState<StartState, FormData>(submitStart, null);
  const [t] = useState(() => Date.now());
  const personal = route === "personal";
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="route" value={route} />
      <input type="hidden" name="t" value={t} />
      {/* Spam trap: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="first_name" className="label">First name</label><input id="first_name" name="first_name" required autoComplete="given-name" className="input" /></div>
        <div><label htmlFor="last_name" className="label">Last name</label><input id="last_name" name="last_name" required autoComplete="family-name" className="input" /></div>
      </div>
      <div><label htmlFor="email" className="label">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
      {personal && <div><label htmlFor="phone" className="label">Phone</label><input id="phone" name="phone" type="tel" required autoComplete="tel" className="input" /></div>}
      <div>
        <label htmlFor="province" className="label">{personal ? "Province or territory you lived in on December 31" : "Province"}</label>
        <select id="province" name="province" required defaultValue="" className="input">
          <option value="" disabled>Choose one</option>
          {PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn mt-2 w-full sm:w-auto">{pending ? "Sending…" : "Continue"}</button>
    </form>
  );
}
