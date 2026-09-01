// The public pricing page.
//
// EVERY NUMBER ON IT IS A LIVE READ OF `PLANS` through limitAmount / formatBytes — the same
// helpers Admin → Billing uses. Nothing here is typed out: change a limit in src/lib/plan-limits.ts
// and this page changes with it, which is that file's own law and what the import-level test in
// src/app/__tests__/public-pages.test.tsx pins.
//
// No session is read. An administrator comparing plans before upgrading is an ordinary visit, so
// unlike the landing page there is no redirect here — and there is nothing to fetch, so no
// loading, error or empty state either.

import type { Metadata } from "next";
import { LinkButton } from "@/components/public/link-button";
import { PLANS, PRO_PRICE, limitAmount, type LimitKind } from "@/lib/plan-limits";
import type { PlanName } from "@/lib/zod-schemas";

// Rendered per request, for one reason: this page's Open Graph image is an ABSOLUTE address, built
// from `metadataBase` and therefore from `APP_BASE_URL`. Prerendered, it would bake whatever
// address the BUILD ran with into every share card — http://localhost:3000/og.png on a build that
// had no variable set. The same reasoning behind robots.ts and sitemap.ts, and the cost on a page
// this small is nothing. (/privacy and /terms carry a title and nothing else, so they stay static.)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — Tielora",
  description: "Free or Pro — every feature is on both plans. See exactly what each one includes.",
  openGraph: {
    title: "Tielora pricing",
    description: "Two plans, every feature on both. The only difference is how much room you have.",
    images: ["/og.png"],
  },
};

/** "1 project" reads as "1 project" mid-sentence and "1 project" at the head of a line. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One plan's three ceilings, in the order the Billing meters run. */
function allowances(plan: PlanName): string[] {
  const kinds: LimitKind[] = ["projects", "users", "documentBytes"];
  return kinds.map((kind) => {
    const limit = PLANS[plan][kind];
    const amount = limitAmount(kind, limit);
    // A headcount reads better as a ceiling than a fact: "Up to 10 people", but plainly
    // "Unlimited people" when there is no ceiling to be up to.
    if (kind === "users" && limit !== null) return `Up to ${amount}`;
    return capitalised(amount);
  });
}

function Tick() {
  return (
    <span
      aria-hidden="true"
      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-accent)]"
    />
  );
}

function Allowance({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-[var(--brand-text)]">
      <Tick />
      {children}
    </li>
  );
}

export default function PricingPage() {
  const free = allowances("FREE");
  const pro = allowances("PRO");

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-3xl px-6 pt-12 pb-4 text-center md:pt-16">
        <h1 className="text-2xl font-semibold text-[var(--brand-ink)] md:text-4xl">
          Simple pricing, two plans.
        </h1>
        <p className="mt-3 text-base text-[var(--brand-text)]">
          Every feature is on both plans. The only difference is how much room you have.
        </p>
      </div>

      <div className="mx-auto grid max-w-4xl gap-4 px-6 sm:grid-cols-2 sm:gap-6">
        {/* Free */}
        <section className="flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-white p-6">
          <h2 className="text-base font-semibold text-[var(--brand-ink)]">Free</h2>
          <p className="mt-1 text-sm text-[var(--brand-text)]">
            For a first project, or trying Tielora out.
          </p>
          <p className="mt-6 flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-[var(--brand-ink)]">$0</span>
            <span className="text-sm text-[var(--brand-gray)]">/forever</span>
          </p>
          <div className="mt-6">
            <LinkButton href="/signup" variant="secondary" full>
              Get started free
            </LinkButton>
          </div>
          <ul className="mt-6 space-y-3">
            {free.map((line) => (
              <Allowance key={line}>{line}</Allowance>
            ))}
            <Allowance>
              Every feature — stage gates, external contractors, documents, the daily brief
            </Allowance>
          </ul>
        </section>

        {/* Pro — lifted by weight alone. No "most popular" badge: there is no usage data yet that
            could make that claim true. */}
        <section className="flex flex-col rounded-[var(--radius)] border-2 border-[var(--brand-accent)] bg-white p-6 shadow-md">
          <h2 className="text-base font-semibold text-[var(--brand-ink)]">Pro</h2>
          <p className="mt-1 text-sm text-[var(--brand-text)]">
            For teams running more than one project, or bigger ones.
          </p>
          <p className="mt-6 text-3xl font-semibold text-[var(--brand-ink)] md:text-4xl">
            {PRO_PRICE}
          </p>
          <div className="mt-6">
            <LinkButton href="/signup" full>
              Upgrade to Pro
            </LinkButton>
          </div>
          <p className="mt-6 text-sm font-semibold text-[var(--brand-ink)]">
            Everything in Free, plus:
          </p>
          <ul className="mt-3 space-y-3">
            {pro.map((line) => (
              <Allowance key={line}>{line}</Allowance>
            ))}
          </ul>
        </section>
      </div>

      {/* The honesty note, in the same calm treatment Admin → Billing uses. */}
      <div className="mx-auto mt-8 max-w-2xl px-6">
        <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-4 py-3 text-center text-sm text-[var(--brand-text)]">
          Both plans include every feature — stage-gated tasks, external contractors, permanent
          document history, the daily brief, chat and Microsoft 365 connections. Free and Pro only
          differ in how much room you have: projects, people, and storage. Nothing is ever locked
          behind a higher plan.
        </p>
      </div>

      <p className="mx-auto mt-6 max-w-2xl px-6 text-center text-sm text-[var(--brand-text)]">
        Already on Tielora? An administrator can upgrade any time from Admin → Billing — nothing
        you&rsquo;ve already built is affected either way.
      </p>
    </div>
  );
}
