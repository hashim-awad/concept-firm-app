"use client";
// Round 24 (rule 17): a change covered by a signed 3.2 or 3.3 asks first. The server answers the first call with
// { confirm: "This removes the sign-off on 3.3. Continue?" }; the person says yes, and the call goes again with
// confirm. A reviewer's sign-off the preparer cannot remove: that comes back as a plain refusal.
import { confirmAction } from "@/components/save-state";

export type Lock = { label: string; canRemove: boolean } | null;
export const lockMessage = (l: NonNullable<Lock>) => (l.canRemove ? `This removes the sign-off on ${l.label}. Continue?` : `Ask the reviewer to remove the ${l.label} sign-off.`);

export async function guarded<R extends { ok: boolean }>(run: (confirm: boolean) => Promise<R>): Promise<R | null> {
  const r = await run(false);
  const ask = !r.ok && "confirm" in r && typeof (r as { confirm?: unknown }).confirm === "string" ? (r as unknown as { confirm: string }).confirm : null;
  if (!ask) return r;
  if (!(await confirmAction({ title: ask, confirm: "Continue" }))) return null;
  return run(true);
}
