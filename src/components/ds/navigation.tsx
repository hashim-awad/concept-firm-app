import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Logo } from "./brand";

export type NavItem = { href: string; label: string; icon: ReactNode; active?: boolean; badge?: string };
export type NavGroup = { label: string; items: NavItem[] };

// Staff sidebar: navy, grouped sections, green active item (as in Concept Studio).
export function Sidebar({ groups, footer, user }: { groups: NavGroup[]; footer?: ReactNode; user?: { name: string; role: string } }) {
  return (
    <aside className="flex h-full w-64 flex-col bg-gradient-to-b from-navy-800 to-navy-950 text-white">
      <div className="px-5 pt-6 pb-5"><Logo tone="white" /></div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-white/45 uppercase">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((i) => (
                <li key={i.label}>
                  <a href={i.href} aria-current={i.active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${i.active ? "bg-lime-500 text-navy-900" : "text-white/85 hover:bg-white/10 hover:text-white"}`}>
                    <span className="h-4.5 w-4.5 shrink-0 [&>svg]:h-4.5 [&>svg]:w-4.5" aria-hidden>{i.icon}</span>
                    <span className="flex-1">{i.label}</span>
                    {i.badge && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/70">{i.badge}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {user && (
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-white/60">{user.role}</p>
        </div>
      )}
      {footer}
    </aside>
  );
}

// Step tracker, e.g. 1 Type, 2 Client, 3 Fees.
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-start" aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current, now = i === current;
        return (
          <li key={s} className="flex flex-1 flex-col items-center text-center" aria-current={now ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? "invisible" : done || now ? "bg-navy-700" : "bg-sand-200"}`} />
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
                done ? "bg-lime-500 text-navy-900" : now ? "border-2 border-navy-700 bg-surface text-navy-700" : "border border-sand-300 bg-sand-50 text-ink-3"}`}>
                {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              <span className={`h-0.5 flex-1 ${i === steps.length - 1 ? "invisible" : done ? "bg-navy-700" : "bg-sand-200"}`} />
            </div>
            <span className={`mt-1.5 text-xs ${now ? "font-semibold text-ink" : "text-ink-3"}`}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Banner header used on dashboards (navy gradient with a hint of Concept green).
export function HeroHeader({ eyebrow, title, description, stats }: { eyebrow: string; title: string; description: string; stats?: { label: string; value: string }[] }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-navy-800 px-6 py-7 text-white md:px-8 md:py-9">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgb(134_188_40/0.28),transparent_45%),linear-gradient(135deg,var(--color-navy-900),var(--color-navy-700))]" aria-hidden />
      <div className="relative">
        <p className="text-[13px] font-semibold text-lime-400">{eyebrow}</p>
        <h1 className="mt-1 text-[28px] leading-9 font-semibold tracking-tight md:text-[32px]">{title}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-white/80">{description}</p>
        {stats && (
          <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm sm:grid-cols-4">
            {stats.map((s, i) => (
              <div key={s.label} className={`px-4 py-3 ${i > 0 ? "border-l border-white/10" : ""}`}>
                <dt className="text-xs text-white/65">{s.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
