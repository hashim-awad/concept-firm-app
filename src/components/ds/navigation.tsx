import { Check } from "lucide-react";

export { Sidebar, type NavItem, type NavGroup } from "./sidebar";

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
