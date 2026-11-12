"use client";
// Letter Builder, Client step (Hashim, Nov 12, 2026): confirm the client's legal name without leaving
// the letter, and pick up client changes made in another tab when this window comes back into focus.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StudioClientRow } from "@/lib/studio/controllers";
import { verifyClientName } from "@/app/(app)/clients/actions";

export function NameCheck({ client, enabled, person }: { client: StudioClientRow | null; enabled: boolean; person?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, router]);
  if (!enabled || !client?.url || client["Name verified"] === "__YES__") return null;
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-[#5C3D00]">
      <label className="flex items-start gap-2">
        <input type="checkbox" disabled={pending} onChange={(ev) => { if (!ev.target.checked) return; setError(""); start(async () => { const r = await verifyClientName(String(client.url)); if (r.ok) router.refresh(); else setError(r.error ?? "Could not save."); }); }} className="mt-0.5 h-4 w-4 accent-navy-700" />
        <span>{person ? "I checked this name against government ID or CRA records." : "I checked this legal name against the corporate registry."} {pending ? "Saving..." : "Saved on the client record with your name and today's date."}</span>
      </label>
      {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
    </div>
  );
}
