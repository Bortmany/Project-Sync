// A call to action that is a link, not a button.
//
// Every CTA on the public pages goes somewhere — /signup, /login, /pricing — so it is an anchor
// with a button's clothes rather than a <button> with an onClick. That keeps these pages entirely
// server-rendered: `Button` in src/components/ui/primitives.tsx is a client module, and importing
// it here would ship JavaScript to a page that has nothing to do.
//
// The three treatments below are the same tokens `Button`'s primary / secondary / ghost styles use,
// so a CTA out here and a button inside the app can never look like different products.

import Link from "next/link";
import type { ReactNode } from "react";

export type LinkButtonVariant = "primary" | "secondary" | "ghost";

const STYLES: Record<LinkButtonVariant, string> = {
  primary: "bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-mid)]",
  secondary:
    "bg-white text-[var(--brand-primary)] border border-[var(--brand-primary)] hover:bg-[var(--page-bg)]",
  ghost: "bg-transparent text-[var(--brand-text)] hover:bg-[var(--page-bg)]",
};

export function LinkButton({
  href,
  variant = "primary",
  full = false,
  children,
  className = "",
}: {
  href: string;
  variant?: LinkButtonVariant;
  /** Full width and thumb-sized — how every CTA is drawn on a phone. */
  full?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2 text-sm font-semibold transition-colors ${
        full ? "w-full" : ""
      } ${STYLES[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
