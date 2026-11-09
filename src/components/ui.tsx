// Shared page parts for staff screens. Built on the design system (src/components/ds).
import type { ReactNode } from "react";
import { PageHeader as DsPageHeader, Alert } from "@/components/ds/primitives";
import { StudioLogo } from "@/components/ds/brand";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return <DsPageHeader title={title} description={description} actions={actions} eyebrow={eyebrow} />;
}

export function Notice({ msg, error }: { msg?: string | null; error?: string | null }) {
  if (error) return <div className="mb-5"><Alert tone="danger">{error}</Alert></div>;
  if (msg) return <div className="mb-5"><Alert tone="success">{msg}</Alert></div>;
  return null;
}

// Sign-in, password and no-access pages.
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><StudioLogo height={56} priority /></div>
        <div className="rounded-2xl border border-sand-200 bg-surface p-6 shadow-[var(--shadow-raised)] md:p-8">
          <h1 className="mb-5 text-xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-ink-3">Staff sign-in · Your information is stored securely in Canada.</p>
      </div>
    </main>
  );
}

export { formatDateTime } from "@/lib/dates";
