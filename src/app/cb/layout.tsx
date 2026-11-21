import "@fontsource/alexandria/latin-400.css";
import "@fontsource/alexandria/latin-500.css";
import "@fontsource/alexandria/latin-600.css";
import "@fontsource/alexandria/latin-700.css";
import type { ReactNode } from "react";
import { requireAccess } from "@/lib/access";
import { ToastProvider } from "@/components/ds/overlays";

// CB2-1: Closebook as its own app (QuickBooks Online's layout). Light only, like Studio.
export const metadata = {
  title: "Closebook",
  icons: { icon: [{ url: "/brand/closebook-icon.svg", type: "image/svg+xml" }, { url: "/brand/closebook-icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/brand/closebook-icon-192.png", sizes: "192x192", type: "image/png" }] },
};

export default async function CbLayout({ children }: { children: ReactNode }) {
  await requireAccess("closebook", "view");
  return <ToastProvider><div className="min-h-screen bg-paper text-ink">{children}</div></ToastProvider>;
}
