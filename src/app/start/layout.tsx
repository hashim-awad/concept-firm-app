import type { Metadata } from "next";
import { ClientShell } from "@/components/ds/client";

// Client-facing pages use the firm's brand, never the tool's name (decision 31).
export const metadata: Metadata = { title: "Concept Accounting & Advisory", robots: { index: false, follow: false } };

export default function StartLayout({ children }: LayoutProps<"/start">) {
  return <ClientShell>{children}</ClientShell>;
}
