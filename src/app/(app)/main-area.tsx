"use client";
// The content area beside the sidebar: every page uses the full width beside the sidebar (Hashim,
// 2026-11-08). The letter and proposal screens also use the full height, so the form and preview
// panes can fill it.
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export const WORKSPACE_PATHS = ["/engagement-letters/new", "/quotes/proposal", "/documents/corporate-letter", "/documents/t1-letter", "/documents/proposal"];

export function MainArea({ children, workspace: force }: { children: ReactNode; workspace?: boolean }) {
  const path = usePathname();
  const workspace = force ?? (WORKSPACE_PATHS.some((p) => path === p || path.startsWith(p + "/")));
  if (workspace) {
    return <main className="min-w-0 flex-1 px-4 py-4 md:px-6 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">{children}</main>;
  }
  return (
    <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
  );
}
