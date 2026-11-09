"use client";
// The Settings menu: grouped links with a search box. Owner-only pages show a lock. On a phone the
// menu folds into "All settings" above the page; the Settings home page lists every item instead.
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock, Search } from "lucide-react";
import type { SettingsGroup, SettingsItem } from "./settings-menu";

// A lock with its reason (hover to read it; screen readers read it out).
export function LockIcon({ title }: { title?: string }) {
  if (!title) return null;
  return <span title={title} className="inline-flex shrink-0 text-ink-3"><Lock className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">{title}</span></span>;
}

export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const home = path === "/admin/settings";
  const isActive = (i: SettingsItem) => !!i.href && [i.href, ...(i.also ?? [])].some((h) => path === h || path.startsWith(h + "/"));
  const words = q.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, items: words ? g.items.filter((i) => `${g.label} ${i.label}`.toLowerCase().includes(words)) : g.items })).filter((g) => g.items.length);
  const first = shown.flatMap((g) => g.items).find((i) => !i.soon);

  const menu = (
    <nav aria-label="Settings" className="grid gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings"
          onKeyDown={(e) => { if (e.key === "Enter" && first) { e.preventDefault(); setQ(""); router.push(first.href); } }}
          style={{ paddingLeft: "2rem" }} className="input h-9 text-sm" />
      </div>
      {shown.length === 0 && <p className="px-2 text-sm text-muted">No setting matches.</p>}
      {shown.map((g) => (
        <div key={g.label}>
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{g.label}</p>
          <ul className="grid gap-px">
            {g.items.map((i) => (
              <li key={i.label}>
                {i.soon ? (
                  <span aria-disabled="true" title="Not built yet" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-3">
                    <span className="flex-1">{i.label}</span><LockIcon title={i.lock} />
                    <span className="rounded border border-sand-300 px-1 text-[10px] leading-4 font-semibold">Soon</span>
                  </span>
                ) : (
                  <a href={i.href} aria-current={isActive(i) ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive(i) ? "bg-navy-50 font-medium text-navy-800 shadow-[inset_3px_0_0_var(--color-lime-500)]" : "text-ink-2 hover:bg-sand-100 hover:text-ink"}`}>
                    <span className="flex-1">{i.label}</span><LockIcon title={i.lock} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <aside className="hidden w-56 shrink-0 md:sticky md:top-8 md:block md:max-h-[calc(100vh-4rem)] md:overflow-y-auto md:pb-4">
        <p className="mb-3 px-2 text-lg font-semibold">Settings</p>
        {menu}
      </aside>
      {!home && (
        <details className="card mb-4 p-3 md:hidden">
          <summary className="cursor-pointer text-sm font-medium">All settings</summary>
          <div className="mt-3">{menu}</div>
        </details>
      )}
    </>
  );
}
