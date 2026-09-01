// The public top bar: the same 56px white header the signed-in Topbar is, so the brand does not
// jump when somebody signs in. Server-rendered — the phone menu beside it is the only client piece.

import Link from "next/link";
import { LinkButton } from "@/components/public/link-button";
import { PublicMobileNav } from "@/components/public/public-mobile-nav";

const LINK_CLASS =
  "text-sm font-medium text-[var(--brand-text)] transition-colors hover:text-[var(--brand-primary)]";

export function PublicNav() {
  return (
    <header className="border-b border-[var(--border)] bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight text-[var(--brand-ink)]">
          Tielora
        </Link>

        {/* Desktop: the five items in one row. On a phone they all move inside the menu. */}
        <nav aria-label="Main" className="ml-auto hidden items-center gap-6 md:flex">
          <Link href="/#features" className={LINK_CLASS}>
            Features
          </Link>
          <Link href="/pricing" className={LINK_CLASS}>
            Pricing
          </Link>
          <span aria-hidden="true" className="text-[var(--border)]">
            |
          </span>
          <Link href="/login" className={LINK_CLASS}>
            Sign in
          </Link>
          <LinkButton href="/signup">Get started</LinkButton>
        </nav>

        <div className="ml-auto md:hidden">
          <PublicMobileNav />
        </div>
      </div>
    </header>
  );
}
