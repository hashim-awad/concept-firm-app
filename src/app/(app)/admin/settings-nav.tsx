"use client";
// Piece UI1 (Hashim, Nov 20, 2026; Q-build "Settings left menu"): every Settings page shows the gear's
// list on the left, with a box to search it. Same entries and the same rights as the gear menu (one source,
// GEAR); the database checks rights again on every read. Below 1024 px the list sits above the page.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import type { GearColumn } from "./settings-menu";

export function SettingsNav({ gear }: { gear: GearColumn[] }) {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  const [q, setQ] = useState("");
  // Below 1024 px the list folds behind one button, so the page itself comes first.
  const [shown, setShown] = useState(false);
  const words = q.trim().toLowerCase();
  const cols = gear.map((c) => ({ ...c, items: c.items.filter((i) => !words || i.label.toLowerCase().includes(words) || c.label.toLowerCase().includes(words)) })).filter((c) => c.items.length);
  // The item for this page: the same address, and for Templates the same tab.
  const on = (href: string) => {
    const u = new URL(href, "http://x");
    if (u.pathname !== path && !path.startsWith(u.pathname + "/")) return false;
    const t = u.searchParams.get("tab");
    return !t || t === (tab ?? "letters");
  };
  return (
    <nav aria-label="Settings" className="border-sand-200 bg-white px-3 py-4 max-lg:py-3 max-lg:border-b lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-60 lg:flex-none lg:overflow-y-auto lg:border-r">
      <p className="px-2 pb-2 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase max-lg:hidden">Settings</p>
      <button type="button" onClick={() => setShown(!shown)} aria-expanded={shown} className="flex w-full items-center justify-between px-2 text-[14px] font-semibold text-navy-800 lg:hidden">
        All settings<ChevronDown className={`h-4 w-4 transition-transform ${shown ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div className={shown ? "max-lg:mt-3" : "max-lg:hidden"}>
      <label className="mb-3 flex h-9 items-center gap-2 border border-sand-300 bg-white px-2.5 text-[13px] focus-within:border-navy-700">
        <Search className="h-4 w-4 flex-none text-ink-3" aria-hidden />
        <span className="sr-only">Search settings</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
      </label>
      {cols.length === 0 && <p className="px-2 text-[13px] text-ink-3">No settings match.</p>}
      {cols.map((c) => (
        <div key={c.label} className="mb-3">
          <p className="px-2 pb-1 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">{c.label}</p>
          {c.items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={on(i.href) ? "page" : undefined}
              className={`flex items-center gap-2 border-l-[3px] px-2 py-1.5 text-[13.5px] ${on(i.href) ? "border-navy-700 bg-navy-50 font-semibold text-navy-800" : "border-transparent text-ink hover:bg-sand-50"}`}>
              <span className="min-w-0 flex-1">{i.label}</span>
              {i.count ? <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-bold text-warning">{i.count}<span className="sr-only"> to approve</span></span> : null}
            </Link>
          ))}
        </div>
      ))}
      </div>
    </nav>
  );
}
