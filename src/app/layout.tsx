// Root layout: brand font stack and the app's title.

import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  // Every relative address in a page's metadata — the Open Graph image, above all — is resolved
  // against this. It comes from APP_BASE_URL when it is set, and from the local development
  // address when it is not, so a preview card never carries a half-written link.
  metadataBase: new URL(siteUrl()),
  title: "Tielora",
  description: "Multidisciplinary coordination for engineering teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--page-bg)] text-[var(--brand-text)] antialiased">
        {children}
      </body>
    </html>
  );
}
