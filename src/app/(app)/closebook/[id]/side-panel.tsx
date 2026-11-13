"use client";
// A panel that slides in from the right over the page (the same look as "Explain the change" on the
// lead sheets). Opened by a link that adds a URL parameter; closing goes back to the page without it.
// Escape and the shaded area close it; focus moves to its heading when it opens.
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

export function SidePanel({ title, closeHref, children, wide }: { title: string; closeHref: string; children: ReactNode; wide?: boolean }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") router.push(closeHref, { scroll: false }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="side-panel-title">
      <Link href={closeHref} scroll={false} aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-navy-950/30" />
      <aside className={`absolute inset-y-0 right-0 flex w-full ${wide ? "max-w-3xl" : "max-w-xl"} flex-col gap-5 overflow-y-auto bg-white p-6 shadow-2xl`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="side-panel-title" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{title}</h2>
          <Link href={closeHref} scroll={false} aria-label="Close" className="rounded p-1.5 hover:bg-sand-100"><X className="h-5 w-5" /></Link>
        </div>
        {children}
      </aside>
    </div>
  );
}
