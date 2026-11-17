"use client";
// The 6-digit code screen. The code is sent by a POST when the page opens (never on a plain GET, so link scanners send nothing).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { checkCode, sendCode } from "./actions";

export function CodeScreen({ token, masked }: { token: string; masked: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  async function send(again: boolean) {
    setBusy(true);
    const r = await sendCode(token);
    setBusy(false);
    setMsg(r.ok ? (again ? { tone: "info", text: `We sent a new code to ${masked}.` } : null) : { tone: "error", text: r.error });
  }
  useEffect(() => { if (!asked.current) { asked.current = true; void send(false); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/\D/g, "").length !== 6) { setMsg({ tone: "error", text: "Enter the 6 digits from the email." }); return; }
    setBusy(true);
    const r = await checkCode(token, code);
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "error", text: r.error }); setCode(""); return; }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md" data-cq-code>
      <div className="rounded-2xl border border-sand-200 bg-surface p-6 shadow-[var(--shadow-card)] md:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-navy-50 text-navy-700"><ShieldCheck className="h-6 w-6" aria-hidden /></span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Questions about your transactions</h1>
        <p className="mt-2 text-ink-2">We sent a 6-digit code to <b className="text-ink">{masked}</b>. Enter it to see your questions.</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="block text-sm font-medium text-ink-2" htmlFor="cq-code">Code</label>
          <input id="cq-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
            className="block w-full rounded-xl border border-sand-300 bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.4em] tabular-nums outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-100" />
          {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={`text-sm ${msg.tone === "error" ? "text-danger" : "text-success"}`}>{msg.text}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-navy-700 px-4 py-3 font-semibold text-white hover:bg-navy-800 disabled:opacity-60">Continue</button>
        </form>
        <p className="mt-4 text-sm text-ink-2">The code works for 10 minutes. Did not get it? <button type="button" disabled={busy} onClick={() => send(true)} className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-800">Send a new code</button></p>
      </div>
    </div>
  );
}
