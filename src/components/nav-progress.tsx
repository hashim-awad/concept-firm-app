"use client";
// A thin bar across the top while a page loads (Hashim, Nov 16, 2026: "when I click anywhere it's taking too
// long and not responsive"). Most pages are built on the server for each click; until now nothing showed that
// the click was received. The bar starts on any click on a link inside the app, or on a form sent, and stops
// when the address changes (or after 20 seconds, if nothing changes).
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search.toString()}`;
  const [busy, setBusy] = useState<{ from: string } | null>(null);

  useEffect(() => {
    const start = () => setBusy({ from: `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}` });
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // The same address (or only a #part of it) does not load anything.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (/\.(pdf|xlsx|csv|zip|docx)$/i.test(url.pathname) || /\/(statement-pdf|report-export|tax-workpaper|package)\b/.test(url.pathname)) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => { if (!e.defaultPrevented) start(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit); };
  }, []);

  // The page arrived: the address changed. A safety stop after 20 seconds.
  useEffect(() => {
    if (!busy) return;
    if (busy.from !== key) { const t = setTimeout(() => setBusy(null), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => setBusy(null), 20000);
    return () => clearTimeout(t);
  }, [busy, key]);

  return (
    <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden transition-opacity duration-200 ${busy ? "opacity-100" : "opacity-0"}`}>
      <div className="h-full w-1/3 animate-[navprogress_1.1s_ease-in-out_infinite] rounded-r bg-[#2f6fd6]" />
      <style>{"@keyframes navprogress{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}"}</style>
    </div>
  );
}
