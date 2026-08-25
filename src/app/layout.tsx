// Root layout: brand font stack and the app's title.

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Nexus — Oman LNG",
  description: "Multidisciplinary coordination for engineering teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--page-bg)] text-[var(--olng-text)] antialiased">
        {children}
      </body>
    </html>
  );
}
