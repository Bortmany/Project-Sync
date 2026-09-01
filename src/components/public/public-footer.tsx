// The public footer: three calm groups, the same weight as the signed-in app's own footer.
// No newsletter box, no social icons, no logos — nothing that does not exist yet.

import Link from "next/link";

const LINK_CLASS = "text-sm text-[var(--brand-text)] underline-offset-2 hover:underline";

export function PublicFooter() {
  return (
    <footer className="border-t border-[var(--brand-stone)] bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-[var(--brand-ink)]">Tielora</p>
          <p className="mt-1 text-xs text-[var(--brand-gray)]">
            Made for multidisciplinary engineering teams.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap items-center gap-4">
          <Link href="/pricing" className={LINK_CLASS}>
            Pricing
          </Link>
          <Link href="/privacy" className={LINK_CLASS}>
            Privacy notice
          </Link>
          <Link href="/terms" className={LINK_CLASS}>
            Terms of use
          </Link>
          <Link href="/login" className={LINK_CLASS}>
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
