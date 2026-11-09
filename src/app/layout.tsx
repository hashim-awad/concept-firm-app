import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concept Studio",
  description: "Concept Studio, the staff app of Concept Accounting & Advisory",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-CA" className="h-full antialiased">
      <body className="ds min-h-full">{children}</body>
    </html>
  );
}
