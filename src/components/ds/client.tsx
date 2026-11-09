import type { ReactNode } from "react";
import { Lock, Mail, Phone, ShieldCheck } from "lucide-react";
import { Logo, FIRM } from "./brand";

// Frame for every client-facing page: calm, centred, phone-first.
export function ClientShell({ children, step }: { children: ReactNode; step?: string }) {
  return (
    <div className="ds flex min-h-full flex-col bg-paper">
      <header className="border-b border-sand-200 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Logo height={32} priority />
          {step && <span className="text-xs font-medium text-ink-3">{step}</span>}
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8 md:py-12">{children}</main>
      <footer className="border-t border-sand-200 bg-surface">
        <div className="mx-auto max-w-2xl space-y-2 px-5 py-6 text-[13px] text-ink-3">
          <p className="font-medium text-ink-2">{FIRM.legalName}</p>
          <p>{FIRM.address}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={`tel:${FIRM.phone}`} className="inline-flex items-center gap-1.5 hover:text-ink"><Phone className="h-3.5 w-3.5" aria-hidden />{FIRM.phone}</a>
            <a href={`mailto:${FIRM.email}`} className="inline-flex items-center gap-1.5 hover:text-ink"><Mail className="h-3.5 w-3.5" aria-hidden />{FIRM.email}</a>
          </p>
          <p className="flex items-center gap-1.5 pt-1"><Lock className="h-3.5 w-3.5" aria-hidden />Your information is stored securely in Canada.</p>
        </div>
      </footer>
    </div>
  );
}

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
