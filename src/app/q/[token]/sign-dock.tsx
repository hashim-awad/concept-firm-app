"use client";
// Where the client signs (Hashim, Nov 11, 2026; the DocuSign pattern):
// - computer and tablet: a panel beside the letter that stays in view while they scroll;
// - phone: a slim bar fixed to the bottom; tapping it slides the same panel up from the bottom.
// The panel is rendered once, so there is one sign form on the page.
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function SignDock({ children, barText, barButton, barLinks }: {
  children: ReactNode; barText: string;
  barButton?: string; // opens the panel on a phone
  barLinks?: { href: string; label: string; primary?: boolean }[]; // shown right in the bar (after signing)
}) {
  const [open, setOpen] = useState(false);
  // Keep the phone sheet from scrolling the page behind it.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-navy-950/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        aria-label="Sign"
        className={`fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sand-200 bg-white p-5 shadow-2xl transition-transform duration-200 ${open ? "translate-y-0" : "translate-y-full"}
          lg:sticky lg:top-6 lg:z-auto lg:max-h-[calc(100vh-3rem)] lg:translate-y-0 lg:rounded-lg lg:p-6 lg:shadow-sm`}>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute top-3 right-3 rounded-md p-1.5 text-ink-2 hover:bg-sand-100 lg:hidden"><X className="h-5 w-5" /></button>
        {children}
      </aside>
      {/* Phone: the slim bar. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-sand-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] lg:hidden">
        <p className="min-w-0 truncate text-sm font-medium">{barText}</p>
        <div className="flex shrink-0 gap-2">
          {barLinks?.map((l) => <a key={l.href} href={l.href} className={l.primary ? "btn h-10 px-4" : "btn-secondary h-10 px-4"}>{l.label}</a>)}
          {barButton && <button type="button" onClick={() => setOpen(true)} className="btn h-10 px-5">{barButton}</button>}
        </div>
      </div>
    </>
  );
}
