"use client";
// The content area beside the sidebar. Most pages: centred, up to 72rem wide. The letter and
// proposal screens: the full width and height, so the form and preview panes can fill it.
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export const WORKSPACE_PATHS = ["/documents/corporate-letter", "/documents/t1-letter", "/documents/proposal"];

export function MainArea({ children, workspace: force }: { children: ReactNode; workspace?: boolean }) {
  const path = usePathname();
  const workspace = force ?? WORKSPACE_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  if (workspace) {
    return <main className="min-w-0 flex-1 px-4 py-4 md:px-6 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">{children}</main>;
  }
  return (
    <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-9">
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}
