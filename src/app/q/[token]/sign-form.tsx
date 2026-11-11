"use client";
// Part C (Appendix A): type your full name, see it as a signature, read the agreement, Sign.
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signQuote, type SignState } from "./actions";

export function SignForm({ token, forOther, who, labels, option }: {
  token: string; forOther: boolean; who: string; option?: number | null;
  labels: { fullName: string; typed: string; agree: string; sign: string; title?: string };
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SignState, FormData>(signQuote.bind(null, token, forOther), null);
  const [name, setName] = useState("");
  useEffect(() => { if (state && "done" in state) router.refresh(); }, [state, router]);
  return (
    <form action={action} className="grid gap-4">
      {option !== undefined && <input type="hidden" name="option" value={option ?? ""} />}
      <div>
        <label htmlFor={`name-${forOther ? "o" : "m"}`} className="label">{labels.fullName}{forOther ? ` (${who})` : ""}</label>
        <input id={`name-${forOther ? "o" : "m"}`} name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </div>
      {labels.title && (
        <div>
          <label htmlFor="title" className="label">{labels.title}</label>
          <input id="title" name="title" required autoComplete="organization-title" className="input" />
        </div>
      )}
      <div>
        <p className="label">{labels.typed}</p>
        <p className="min-h-12 rounded-lg border border-sand-200 bg-white px-4 py-2 text-3xl text-navy-800" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive" }} aria-live="polite">{name}</p>
      </div>
      {/* No checkbox (Hashim, Nov 10): clicking Sign is the agreement, and the statement sits right above it. */}
      <p className="text-sm text-ink-2">{labels.agree}</p>
      {state && "error" in state && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn w-full sm:w-fit">{pending ? "Signing..." : labels.sign}</button>
    </form>
  );
}
