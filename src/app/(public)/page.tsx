// The front door.
//
// SIGNED-IN VISITORS ARE STILL REDIRECTED, exactly as the old src/app/page.tsx did: there is no
// point showing an engineer who already uses Tielora the pitch for it, so getSessionUser() runs
// before a single word of this page is rendered and sends them to their own home page. What
// changed is only the other half — somebody with no session used to be pushed at the sign-in wall,
// and now gets the landing page.
//
// Everything below the redirect is static server-rendered copy: no data fetch, no per-user
// content, so there is no loading, error or empty state to design for — and NOT ONE LINE OF CLIENT
// JAVASCRIPT, the phone menu in the shell excepted.
//
// THE HERO PHOTOGRAPH IS DECIDED HERE, ON THE SERVER, by asking the file system whether it exists.
// That is the honest question: "is there a picture?" is a fact about the disk, not something to
// discover in a browser. Rendering an <Image> for a file that is not there makes every visitor
// fetch it, take a 400 back from the image optimiser and log two errors in the console for a
// picture nobody was promised. So the ink gradient is the hero, always, and the photograph is laid
// on top only when `public/landing-hero.webp` is really there.
//
// EVERY PLAN NUMBER ON THIS PAGE IS READ FROM src/lib/plan-limits.ts. Nothing here is typed out.

import { existsSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { homePathFor } from "@/components/shell/nav-items";
import { PRO_PRICE } from "@/lib/plan-limits";
import { FeatureSection } from "@/components/public/feature-frame";
import {
  ContractorScopeVignette,
  DailyBriefVignette,
  DerivedStatusVignette,
  DocumentHistoryVignette,
  TemplatesVignette,
} from "@/components/public/feature-vignettes";
import { LinkButton } from "@/components/public/link-button";

export const metadata: Metadata = {
  title: "Tielora — multi-company engineering project coordination",
  description:
    "Coordinate engineering projects across every company involved — stage-gated tasks, contractors walled to their own work, documents that are never overwritten, and a daily brief that reaches wherever your team already talks.",
  openGraph: {
    title: "Tielora — multi-company engineering project coordination",
    description:
      "Every department’s work, however your team is organised — from first task to final sign-off, contractors included.",
    images: ["/og.png"],
  },
};

/** The hero's two lines. Written once, so the phone band and the desktop block cannot disagree. */
const HEADLINE = ["One project. Every company.", "One source of truth."];

const SUBLINE =
  "Every department’s work, however your team is organised — from first task to final sign-off, contractors included.";

/** The AuthSplit panel's gradient — the hero's floor, and its whole appearance without the photo. */
const INK_GRADIENT = "linear-gradient(150deg, var(--brand-ink) 0%, var(--brand-mid) 100%)";

/** The optional hero photograph. Not in the repository — the owner drops it in. */
const HERO_IMAGE = "/landing-hero.webp";

/**
 * Is the picture actually on disk? Asked once per render rather than once per process: a `stat` is
 * nothing next to a page render, and it means the photograph appears the moment the file is added
 * without anybody having to remember to restart the server.
 */
function heroImageExists(): boolean {
  return existsSync(path.join(process.cwd(), "public", HERO_IMAGE.slice(1)));
}

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section
        className="relative flex min-h-48 flex-col justify-end overflow-hidden md:min-h-[560px] md:justify-center"
        style={{ background: INK_GRADIENT }}
      >
        {/* Only when the file is really there — see the note at the top of this file. `priority`
            is safe here for the same reason: nothing is preloaded that does not exist. */}
        {heroImageExists() ? (
          <Image
            src={HERO_IMAGE}
            alt=""
            fill
            priority
            sizes="100vw"
            // Left of centre: the picture's dark side stays under the headline as the window narrows.
            className="pointer-events-none object-cover object-left"
          />
        ) : null}
        {/* The safety net: bottom-heavy on a phone, left-to-right on a wide screen, so the words
            stay readable however the picture is cropped or recompressed. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--brand-ink)]/80 via-[var(--brand-ink)]/30 to-transparent md:bg-gradient-to-r md:from-[var(--brand-ink)]/70 md:via-[var(--brand-ink)]/20 md:to-transparent"
        />

        <div className="relative mx-auto w-full max-w-6xl px-6 py-6 md:py-16">
          <div className="max-w-xl">
            <h1 className="text-2xl font-semibold tracking-tight text-white md:text-5xl">
              {HEADLINE[0]}
              <span className="block">{HEADLINE[1]}</span>
            </h1>

            {/* Wide screens: the subline and both calls to action sit on the picture. */}
            <div className="hidden md:block">
              <p className="mt-4 text-lg text-white/85">{SUBLINE}</p>
              <div className="mt-6 flex items-center gap-6">
                <LinkButton href="/signup">Get started</LinkButton>
                <Link
                  href="/login"
                  className="text-sm font-medium text-white underline-offset-2 hover:underline"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* On a phone the picture is a short band and the words live below it, on plain background —
          the same answer AuthSplit already gives to "photo panel plus text". */}
      <div className="bg-[var(--surface)] px-6 py-6 md:hidden">
        <p className="text-base text-[var(--brand-text)]">{SUBLINE}</p>
        <div className="mt-5 flex flex-col items-center gap-3">
          <LinkButton href="/signup" full>
            Get started
          </LinkButton>
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Features — five jobs, one each, all of them true of the app today */}
      {/* ---------------------------------------------------------------- */}
      <FeatureSection
        id="features"
        eyebrow="Derived, not typed in"
        heading="A task can never say done unless its work is done."
        body="A main task’s status isn’t something anybody sets by hand — it’s worked out, live, from the discipline tasks underneath it. Miss a mandatory document, leave one discipline blocked, and the parent task simply can’t complete. No status to forget to update. No parent that quietly drifts out of sync with reality."
      >
        <DerivedStatusVignette />
      </FeatureSection>

      <FeatureSection
        reverse
        eyebrow="Outside help, safely scoped"
        heading="Bring in a contractor without opening up the whole project."
        body="An external contractor sees exactly the tasks assigned to them and nothing else — not the team list, not another company’s work, not a project they hold nothing on. Their finished work lands in a sign-off queue for your own team to confirm or send back, so nothing outside your company closes itself out."
      >
        <ContractorScopeVignette />
      </FeatureSection>

      <FeatureSection
        eyebrow="Nothing gets overwritten"
        heading="Upload a correction. The old version never disappears."
        body="Every document revision stays on record, and every action on a project — who did what, and when — is written to a permanent audit trail. Nobody, including an administrator, can edit or delete that history. It’s the record your project actually needs to stand behind its decisions later."
      >
        <DocumentHistoryVignette />
      </FeatureSection>

      <FeatureSection
        reverse
        eyebrow="One page, every morning"
        heading="Everyone’s day, in one glance — and copied to the channel they already watch."
        body="Due today, overdue, newly unblocked, anything you were mentioned in — one short brief instead of hunting through a dashboard. Turn it on and the same headlines post to Slack, Microsoft Teams, or wherever your company already lives, in Admin → Integrations."
      >
        <DailyBriefVignette />
      </FeatureSection>

      <FeatureSection
        eyebrow="Self-serve, from the first minute"
        heading="Sign up, pick your industry, and your departments are already there."
        body="No setup call, no blank workspace to configure by hand. Choose a template at signup and your disciplines and project stages are seeded for you — start from oil & gas, construction, or a plain general template and adjust from there."
      >
        <TemplatesVignette />
      </FeatureSection>

      {/* ---------------------------------------------------------------- */}
      {/* The honesty band — three facts. No logos, no testimonials, no      */}
      {/* star ratings: Tielora has no customers to name yet, and this page  */}
      {/* says nothing that is not true. The day there is one, this band is  */}
      {/* the natural place for it, which is why it stands on its own.       */}
      {/* ---------------------------------------------------------------- */}
      <section className="bg-[var(--page-bg)] py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 sm:flex-row sm:justify-between">
          {[
            "Every change is written to a permanent audit trail.",
            "Document revisions are never overwritten — the old one always stays.",
            "Each company’s workspace is sealed off from every other.",
          ].map((fact) => (
            <p
              key={fact}
              className="flex items-start gap-2 text-sm font-medium text-[var(--brand-ink)]"
            >
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-accent)]" />
              {fact}
            </p>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Pricing teaser — a glance, then the real page                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="bg-white py-12 md:py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-2xl font-semibold text-[var(--brand-ink)] md:text-3xl">
            Simple pricing, two plans.
          </h2>
          <p className="mt-2 text-base text-[var(--brand-text)]">
            Free to start. Upgrade to Pro when your team outgrows it.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] p-6">
              <p className="text-sm font-semibold text-[var(--brand-ink)]">Free</p>
              <p className="text-3xl font-semibold text-[var(--brand-ink)]">$0</p>
              <LinkButton href="/pricing" variant="secondary">
                Compare plans
              </LinkButton>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] p-6">
              <p className="text-sm font-semibold text-[var(--brand-ink)]">Pro</p>
              <p className="text-3xl font-semibold text-[var(--brand-ink)]">{PRO_PRICE}</p>
              <LinkButton href="/pricing">See Pro</LinkButton>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
