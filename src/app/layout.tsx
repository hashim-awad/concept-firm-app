import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concept Firm App",
  description: "Concept Accounting & Advisory firm app",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-CA" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
