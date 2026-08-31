// The shared frame for the two public screens (sign in, create a workspace): the ink hero panel on
// the left with the Tielora wordmark over it, the form on the right. Server-rendered — only the
// photograph itself is a client component, because it has to disappear if the file cannot be loaded.

import type { ReactNode } from "react";
import Link from "next/link";
import { LoginHero } from "./login/login-hero";

export function AuthSplit({
  children,
  /** A little more room, for the signup screen's template cards. */
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      <section
        className="relative flex min-h-48 flex-col justify-end overflow-hidden p-8 md:min-h-screen md:w-[45%]"
        style={{
          background: "linear-gradient(150deg, var(--brand-ink) 0%, var(--brand-mid) 100%)",
        }}
      >
        <LoginHero />
        <div className="relative">
          <h1 className="text-4xl font-semibold tracking-tight text-white">Tielora</h1>
          <p className="mt-3 max-w-sm text-sm text-white/80">
            Multidisciplinary coordination for engineering teams
          </p>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center p-8">
        <div className={`w-full ${wide ? "max-w-md" : "max-w-sm"}`}>{children}</div>
      </section>
    </main>
  );
}

/** The privacy and terms line both public screens carry under their form. */
export function AuthLegalLinks() {
  return (
    <p className="mt-6 text-xs text-[var(--brand-gray)]">
      <Link href="/privacy" className="underline-offset-2 hover:underline">
        Privacy notice
      </Link>{" "}
      &middot;{" "}
      <Link href="/terms" className="underline-offset-2 hover:underline">
        Terms of use
      </Link>
    </p>
  );
}
