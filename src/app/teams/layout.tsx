// The Teams pages: no sidebar, no top bar, no footer — Teams supplies the frame. Light theme only
// (the brand has no dark colours). Everything under /teams is reached from inside Microsoft Teams;
// only /teams/tab may be framed (see next.config.ts), and none of it is worth a search engine.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tielora in Teams",
  robots: { index: false, follow: false },
};

export default function TeamsLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[var(--page-bg)] p-4 sm:p-6">{children}</main>;
}
