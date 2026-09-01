// The frame the privacy notice and the terms of use share: the Tielora eyebrow, the heading, the
// "last updated" line, the not-yet-lawyered banner and the two links at the bottom.
//
// Both pages carried a copy of this markup each. It is written once here so the pair can never
// drift apart; every sentence of their actual CONTENT still lives on its own page, untouched.

import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({
  title,
  lastUpdated,
  notice,
  otherHref,
  otherLabel,
  children,
}: {
  title: string;
  lastUpdated: string;
  /** The template warning at the top — worded slightly differently on each page. */
  notice: string;
  /** The sibling legal page: privacy points at terms, terms points at privacy. */
  otherHref: string;
  otherLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--brand-accent)]">
        Tielora
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--brand-ink)]">{title}</h1>
      <p className="mt-1 text-sm text-[var(--brand-gray)]">Last updated {lastUpdated}</p>

      <div className="mt-6 rounded-[var(--radius)] border border-[var(--brand-stone)] bg-[var(--brand-stone)]/40 p-4 text-sm text-[var(--brand-text)]">
        {notice}
      </div>

      {children}

      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        <Link
          href={otherHref}
          className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          {otherLabel}
        </Link>
        {/* Home is the landing page now, not /dashboard — which sent a visitor with no account
            straight into a sign-in wall. */}
        <Link
          href="/"
          className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Back to Tielora
        </Link>
      </div>
    </div>
  );
}
