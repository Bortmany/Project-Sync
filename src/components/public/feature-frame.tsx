// The shared frame every feature vignette sits in, and the alternating section that holds one.
//
// A vignette is DECORATIVE MARKUP — no props, no state, no data, never a screenshot. The frame
// gives all five the same outline (a card with a thin ink strip down the left standing in for the
// app's sidebar) so the five sections read as one family rather than five illustrations.

import type { ReactNode } from "react";

export function FeatureFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex aspect-[4/3] w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white">
      {/* The stand-in sidebar: just enough to read as "this is a screen". */}
      <div
        aria-hidden="true"
        className="flex w-7 shrink-0 flex-col items-center gap-2 bg-[var(--brand-ink)] pt-3"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 p-4">{children}</div>
    </div>
  );
}

/**
 * One feature: an eyebrow, a claim, two or three lines of body copy, and the vignette beside it.
 * The sections alternate sides down the page — `reverse` puts the picture on the left.
 */
export function FeatureSection({
  id,
  eyebrow,
  heading,
  body,
  reverse = false,
  children,
}: {
  id?: string;
  eyebrow: string;
  heading: string;
  body: string;
  reverse?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className="bg-white py-12 md:py-16">
      <div
        className={`mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 md:gap-12 ${
          reverse ? "md:flex-row-reverse" : "md:flex-row"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--brand-accent)]">
            {eyebrow}
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-[var(--brand-ink)] md:text-3xl">
            {heading}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--brand-text)]">{body}</p>
        </div>
        <div className="w-full max-w-md flex-1">{children}</div>
      </div>
    </section>
  );
}
