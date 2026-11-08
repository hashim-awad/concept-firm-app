import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Notice({ msg, error }: { msg?: string | null; error?: string | null }) {
  if (error) {
    return <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  }
  if (msg) {
    return <p role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-4 py-3 text-sm text-ok">{msg}</p>;
  }
  return null;
}

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-medium text-muted">Concept Accounting &amp; Advisory</p>
        <div className="card">
          <h1 className="mb-4 text-xl font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}
