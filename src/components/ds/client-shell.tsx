import type { ReactNode } from "react";
import { Lock, Mail, Phone } from "lucide-react";
import { Logo, FIRM } from "./brand";
import { loadFirmContact } from "@/lib/firm-contact";

// Server only (reads Settings), so it lives apart from the client-safe parts in ./client.
// Frame for every client-facing page: calm, centred, phone-first.
// wide: the quote and engagement letter page (the letter beside the sign panel); every other client
// page keeps the narrow column.
// Round 33: the footer's address, phone and email come from Settings › Firm details › Contact.
export async function ClientShell({ children, step, wide }: { children: ReactNode; step?: string; wide?: boolean }) {
  const w = wide ? "max-w-6xl" : "max-w-2xl";
  const c = await loadFirmContact();
  return (
    <div className="ds flex min-h-full flex-col bg-paper">
      <header className="border-b border-sand-200 bg-surface/90 backdrop-blur">
        <div className={`mx-auto flex h-16 ${w} items-center justify-between px-5`}>
          <Logo height={32} priority />
          {step && <span className="text-xs font-medium text-ink-3">{step}</span>}
        </div>
      </header>
      <main className={`mx-auto w-full ${w} flex-1 px-5 py-8 md:py-12`}>{children}</main>
      <footer className="border-t border-sand-200 bg-surface">
        <div className={`mx-auto ${w} space-y-2 px-5 py-6 text-[13px] text-ink-3`}>
          <p className="font-medium text-ink-2">{FIRM.legalName}</p>
          {c.address && <p data-firm-address>{c.address}</p>}
          {(c.phone || c.email) && <p className="flex flex-wrap gap-x-4 gap-y-1">
            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex min-h-11 items-center gap-1.5 hover:text-ink" data-firm-phone><Phone className="h-3.5 w-3.5" aria-hidden />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center gap-1.5 hover:text-ink" data-firm-email><Mail className="h-3.5 w-3.5" aria-hidden />{c.email}</a>}
          </p>}
          <p className="flex items-center gap-1.5 pt-1"><Lock className="h-3.5 w-3.5" aria-hidden />Your information is stored securely in Canada.</p>
        </div>
      </footer>
    </div>
  );
}
