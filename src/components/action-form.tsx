"use client";
// CloseBook2 CB2-0 step 3 (rule 14): a save that stays on the page and keeps what was typed. The server action returns
// { ok, message } instead of redirecting; the message shows under the form; the page data refreshes in place.
import { useActionState, type ReactNode } from "react";

export type ActionResult = { ok: boolean; message: string } | null;

export function ActionForm({ action, children, className }: { action: (prev: ActionResult, form: FormData) => Promise<ActionResult>; children: ReactNode; className?: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className} aria-busy={pending}>
      {children}
      {state && <p role={state.ok ? "status" : "alert"} className={`basis-full text-[12.5px] ${state.ok ? "text-success" : "text-danger"}`} data-action-result>{state.message}</p>}
    </form>
  );
}
