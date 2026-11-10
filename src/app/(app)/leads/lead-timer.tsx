"use client";
// "Waiting 25 min" on a lead still waiting for its quote (Phase 2 batch, section 3). Counts business
// minutes only (Settings, Business hours) and updates every 30 seconds. Amber from 30 minutes,
// red from 45, when the reminder email goes.
import { useEffect, useState } from "react";
import { businessMinutes, formatWaiting, isOpen, REMINDER_MINUTES, type BusinessHours } from "@/lib/business-hours";

export function LeadTimer({ since, hours }: { since: string; hours: BusinessHours | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null;
  const min = businessMinutes(since, now, hours);
  const tone = min >= REMINDER_MINUTES ? "text-danger" : min >= 30 ? "text-warning" : "text-ink-2";
  return (
    <span className={`whitespace-nowrap font-medium ${tone}`} title="Business minutes only, from Settings, Business hours">
      {formatWaiting(min)}{!isOpen(now, hours) && <span className="font-normal text-muted"> (paused, outside business hours)</span>}
    </span>
  );
}
