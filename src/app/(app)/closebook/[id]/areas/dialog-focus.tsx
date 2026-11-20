"use client";
// Piece S1 (ui-reviewer): the entry window takes the keyboard when it opens. Focus moves into the window, Tab stays in
// the topmost open window (a schedule window over the form counts), Escape closes the topmost one: a schedule window by
// its own Close button, the entry window by its close link. Focus goes back to the link that opened it after a close.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DialogFocus({ closeHref }: { closeHref: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  useEffect(() => {
    const own = marker.current?.closest<HTMLElement>('[role="dialog"]');
    if (!own) return;
    const opener = document.activeElement instanceof HTMLElement && !own.contains(document.activeElement) ? document.activeElement : null;
    const topmost = () => { const all = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')); return all[all.length - 1] ?? own; };
    const start = () => { const top = topmost(); if (top.contains(document.activeElement)) return;
      const h = top.querySelector<HTMLElement>("h2"); if (h) { h.tabIndex = -1; h.style.outline = "none"; h.focus({ preventScroll: true }); } };
    // A schedule window that opens over the form mounts a moment later, or when its button is pressed: focus follows it.
    // Piece E1 (ui-reviewer): when a schedule window closes, focus goes back to the control that opened it.
    let count = document.querySelectorAll('[role="dialog"][aria-modal="true"]').length;
    const openers: (HTMLElement | null)[] = [];
    const watch = new MutationObserver(() => {
      const n = document.querySelectorAll('[role="dialog"][aria-modal="true"]').length;
      if (n > count) { openers.push(document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null); start(); }
      else if (n < count) {
        const back = openers.pop();
        const top = topmost();
        if (back?.isConnected && top.contains(back)) back.focus({ preventScroll: true });
        else { const h = top.querySelector<HTMLElement>("h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
      }
      count = n;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    start(); const t = window.setTimeout(start, 50);
    const onKey = (e: KeyboardEvent) => {
      const top = topmost();
      if (e.key === "Escape") {
        e.preventDefault();
        if (top !== own) top.querySelector<HTMLButtonElement>('button[aria-label="Close"], button[aria-label="Close the schedule"]')?.click();
        else router.push(closeHref, { scroll: false });
      } else if (e.key === "Tab") {
        const items = Array.from(top.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1], at = document.activeElement;
        if (!top.contains(at)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { watch.disconnect(); window.clearTimeout(t); document.removeEventListener("keydown", onKey); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [closeHref, router]);
  return <span ref={marker} hidden />;
}
