// The public shell: one frame — top nav and footer — around every page a visitor can open before
// signing in (the landing page, pricing, the privacy notice and the terms of use).
//
// Route groups add nothing to a URL, so /privacy and /terms live here with their addresses
// unchanged. The signed-in half of the app has its own shell in src/app/(app)/layout.tsx and the
// two never meet: nothing under here reads a session, except the landing page's own redirect.

import { PublicFooter } from "@/components/public/public-footer";
import { PublicNav } from "@/components/public/public-nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicNav />
      <main className="min-w-0 flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
