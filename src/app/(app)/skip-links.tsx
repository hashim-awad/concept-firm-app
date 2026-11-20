"use client";
// UI1 keyboard fix: skip links, first in Tab order and shown only when focused. Inside a Closebook file there are
// two more: to the step list and to the working paper (ui-reviewer finding 2).
import { usePathname } from "next/navigation";

export function SkipLinks() {
  const inFile = /^\/closebook\/[0-9a-f-]{36}$/.test(usePathname());
  return (
    <div className="skips">
      <a href="#main">Skip to main content</a>
      {inFile && <><a href="#steps">Skip to steps</a><a href="#paper">Skip to working paper</a></>}
    </div>
  );
}
