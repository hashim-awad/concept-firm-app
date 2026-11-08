import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- Type ---------- */
export const type = {
  display: "text-[32px] leading-10 font-semibold tracking-tight",
  h1: "text-[26px] leading-8 font-semibold tracking-tight",
  h2: "text-xl leading-7 font-semibold tracking-tight",
  h3: "text-base leading-6 font-semibold",
  body: "text-[15px] leading-6",
  small: "text-[13px] leading-5",
  caption: "text-xs leading-4 font-medium uppercase tracking-wider",
};

/* ---------- Buttons ---------- */
// primary = navy (main actions). accent = Concept green with navy text (one highlight action per screen).
type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";
const BTN_BASE = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-navy-700 text-white hover:bg-navy-800 shadow-[var(--shadow-card)]",
  accent: "bg-lime-500 text-navy-900 hover:bg-lime-400 shadow-[var(--shadow-card)]",
  secondary: "border border-sand-300 bg-surface text-ink hover:bg-sand-50",
  ghost: "text-ink-2 hover:bg-sand-100 hover:text-ink",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]", // client pages: large tap target
};
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], extra);
}
export function Button({ variant = "primary", size = "md", loading, className, children, ...rest }:
  ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Layout ---------- */
export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={cx("rounded-[var(--radius-ds)] border border-sand-200 bg-surface shadow-[var(--shadow-card)]", padded && "p-5 md:p-6", className)}>{children}</div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-sand-200 pb-5">
      <div className="min-w-0">
        {eyebrow && <p className={cx(type.caption, "mb-1.5 text-ink-3")}>{eyebrow}</p>}
        <h1 className={type.h1}>{title}</h1>
        {description && <p className={cx(type.small, "mt-1.5 max-w-2xl text-ink-2")}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-sand-100 text-ink-3">{icon ?? <Inbox className="h-5 w-5" aria-hidden />}</span>
      <p className="font-medium">{title}</p>
      {description && <p className={cx(type.small, "mt-1 max-w-sm text-ink-2")}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Status pills ---------- */
export type Status = "draft" | "sent" | "viewed" | "signed" | "expired" | "lost" | "withdrawn" | "out_of_scope" | "new" | "published" | "retired";
const STATUS: Record<Status, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-sand-100 text-ink-2 ring-sand-300" },
  new: { label: "New", cls: "bg-navy-50 text-navy-700 ring-navy-200" },
  sent: { label: "Sent", cls: "bg-navy-100 text-navy-800 ring-navy-200" },
  viewed: { label: "Viewed", cls: "bg-[#EEEAF8] text-[#4B3A8C] ring-[#D6CEF0]" },
  signed: { label: "Signed", cls: "bg-success-soft text-success ring-[#BFE0CC]" },
  expired: { label: "Expired", cls: "bg-warning-soft text-warning ring-[#EED9A8]" },
  lost: { label: "Lost", cls: "bg-danger-soft text-danger ring-[#F3C4BE]" },
  withdrawn: { label: "Withdrawn", cls: "bg-sand-100 text-ink-3 ring-sand-300 line-through decoration-ink-3/50" },
  out_of_scope: { label: "Out of scope", cls: "bg-[#F6E9F1] text-[#8A2E62] ring-[#EBCADD]" },
  published: { label: "Live", cls: "bg-success-soft text-success ring-[#BFE0CC]" },
  retired: { label: "Retired", cls: "bg-sand-100 text-ink-3 ring-sand-300" },
};
export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {s.label}
    </span>
  );
}
export const ALL_STATUSES = Object.keys(STATUS) as Status[];

/* ---------- Forms ---------- */
export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}{optional && <span className="font-normal text-ink-3"> (optional)</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="-mt-0.5 mb-2 text-[13px] leading-5 text-ink-3">{hint}</p>}
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1.5 text-[13px] text-danger" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

const INPUT = "w-full rounded-lg border bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3 transition-colors focus:outline-none focus:ring-4";
export function inputClass(error?: boolean, size: "md" | "lg" = "md") {
  return cx(INPUT, size === "lg" ? "h-12" : "h-10",
    error ? "border-danger focus:border-danger focus:ring-danger/15" : "border-sand-300 hover:border-ink-3 focus:border-navy-600 focus:ring-navy-600/15");
}
export function Input({ invalid, size = "md", className, ...rest }: Omit<ComponentProps<"input">, "size"> & { invalid?: boolean; size?: "md" | "lg" }) {
  return <input {...rest} aria-invalid={invalid || undefined} className={cx(inputClass(invalid, size), className)} />;
}
export function Select({ invalid, className, children, ...rest }: ComponentProps<"select"> & { invalid?: boolean }) {
  return <select {...rest} aria-invalid={invalid || undefined} className={cx(inputClass(invalid), "appearance-auto pr-8", className)}>{children}</select>;
}
export function Textarea({ invalid, className, ...rest }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea {...rest} aria-invalid={invalid || undefined} className={cx(INPUT, "min-h-24 py-2.5", invalid ? "border-danger" : "border-sand-300 focus:border-navy-600 focus:ring-navy-600/15", className)} />;
}

// Large, tappable choice cards for client pages.
export function ChoiceCards({ name, options, value, error, onChange }: {
  name: string; options: { value: string; label: string; hint?: string }[]; value?: string; error?: boolean; onChange?: (v: string) => void;
}) {
  return (
    <div className="grid gap-2.5" role="radiogroup">
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <label key={o.value} className={cx(
            "flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border bg-surface px-4 py-3 transition-colors",
            checked ? "border-navy-600 bg-navy-50 ring-1 ring-navy-600" : error ? "border-danger" : "border-sand-300 hover:border-ink-3",
          )}>
            <input type="radio" name={name} value={o.value} checked={onChange ? checked : undefined} defaultChecked={onChange ? undefined : checked}
              onChange={onChange ? () => onChange(o.value) : undefined} className="mt-1 h-4 w-4 accent-navy-700" />
            <span>
              <span className="block text-[15px] font-medium leading-6">{o.label}</span>
              {o.hint && <span className="block text-[13px] leading-5 text-ink-2">{o.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function Checkbox({ id, label, hint, ...rest }: ComponentProps<"input"> & { id: string; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" {...rest} className="mt-0.5 h-4 w-4 rounded accent-navy-700" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

/* ---------- Alerts ---------- */
export function Alert({ tone = "info", title, children }: { tone?: "info" | "success" | "warning" | "danger"; title?: string; children: ReactNode }) {
  const cls = {
    info: "border-navy-200 bg-navy-50 text-navy-900",
    success: "border-[#BFE0CC] bg-success-soft text-[#14532F]",
    warning: "border-[#EED9A8] bg-warning-soft text-[#5C3D00]",
    danger: "border-[#F3C4BE] bg-danger-soft text-[#7A1A12]",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", cls)}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

/* ---------- Key/value rows ---------- */
export function Meta({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">{i.label}</dt>
          <dd className="mt-0.5 text-sm">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}
