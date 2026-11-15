"use client";
// A labelled dropdown whose choices are links: choosing one opens the same list with that filter
// (round 19: the Quotes status filter, as Engagements › Letters' Type filter).
import { useRouter } from "next/navigation";

export function LinkSelect({ label, value, options }: { label: string; value: string; options: { value: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
      {label}
      <select value={value} onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) router.push(o.href); }}
        className="h-8 rounded-lg border border-sand-300 bg-surface px-2 text-[13px] text-ink">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
