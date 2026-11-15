"use client";
// Round 18: the "New for this client" menu in the client page header (round 19: also New letter). Closes on a click outside or Escape.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { buttonClass } from "@/components/ds/primitives";

export function NewMenu({ items, label = "New for this client" }: { items: { label: string; href: string }[]; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (ev: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (ev instanceof KeyboardEvent ? ev.key === "Escape" : !el.contains(ev.target as Node)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, []);
  if (items.length === 0) return null;
  return (
    <details ref={ref} className="relative">
      <summary className={buttonClass("primary", "md", "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        {label}<ChevronDown className="h-4 w-4" aria-hidden />
      </summary>
      <ul className="absolute right-0 z-20 mt-1 grid min-w-52 gap-0.5 rounded-lg border border-sand-200 bg-surface p-1 shadow-[var(--shadow-card)]">
        {items.map((i) => (
          <li key={i.href}><Link href={i.href} className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-sand-50">{i.label}</Link></li>
        ))}
      </ul>
    </details>
  );
}
