import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

// Big friendly choice used on the start page.
export function RouteCard({ title, body, icon, href }: { title: string; body: string; icon: ReactNode; href: string }) {
  return (
    <a href={href} className="group flex items-center gap-4 rounded-2xl border border-sand-200 bg-surface p-5 shadow-[var(--shadow-card)] transition-all hover:border-navy-600 hover:shadow-[var(--shadow-raised)]">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700 [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
      <span className="flex-1">
        <span className="block text-[17px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{body}</span>
      </span>
      <span className="text-lime-600 transition-transform group-hover:translate-x-0.5" aria-hidden>
        <svg width="18" height="20" viewBox="741 535 578 774"><polygon points="932,535 1318,921 932,1308 741,1117 937,921 741,726" fill="currentColor" /></svg>
      </span>
    </a>
  );
}

// Progress bar for the screening questions.
export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs font-medium text-ink-3"><span>{label}</span><span className="tabular-nums">{Math.round(value * 100)}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sand-100" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-navy-700" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

// Reassurance row under key client actions.
export function TrustRow() {
  return (
    <p className="flex items-center justify-center gap-2 text-[13px] text-ink-3">
      <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
      Checked by our team before you sign.
    </p>
  );
}

// The quote/document page: paper look, optional DRAFT FOR REVIEW watermark.
export function DocumentSheet({ children, draft }: { children: ReactNode; draft?: boolean }) {
  return (
    <article className="relative overflow-hidden rounded-2xl border border-sand-200 bg-surface shadow-[var(--shadow-raised)]">
      {draft && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <span className="-rotate-[24deg] text-[44px] font-bold tracking-widest whitespace-nowrap text-danger/10 md:text-[64px]">DRAFT FOR REVIEW</span>
        </div>
      )}
      {draft && <p className="sr-only">Draft for review</p>}
      <div className="relative p-6 md:p-10">{children}</div>
    </article>
  );
}
