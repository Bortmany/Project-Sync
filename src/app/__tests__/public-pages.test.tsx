// The public face: what a stranger sees, and what a signed-in person is spared.
//
// These are render tests, not database tests — every page under src/app/(public) is static copy
// apart from the landing page's one session read, which is mocked here. They pin four promises:
//
//  1. The landing page answers a signed-out visitor with the real page, in the words it was
//     written with.
//  2. A SIGNED-IN visitor is still redirected to their own home page, exactly as the old
//     src/app/page.tsx did — internal roles to /dashboard, a contractor to My tasks. This is the
//     behaviour the landing page inherited and must not lose.
//  3. Every plan number on /pricing is a live read of PLANS. Changing a limit changes the page,
//     with no edit to it at all.
//  4. /privacy and /terms still render, at their unchanged addresses, and now point home rather
//     than at a sign-in wall.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { homePathFor } from "@/components/shell/nav-items";
import { PLANS, limitAmount } from "@/lib/plan-limits";
import type { RoleName } from "@/lib/zod-schemas";

/** The session the mocked getSessionUser() hands back — set by each test before it renders. */
const session: { user: { role: RoleName } | null } = { user: null };

vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => session.user,
}));

/** Whether the optional hero photograph is on disk, as the page's own existsSync would find it. */
const heroFile = { present: false };

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (target: Parameters<typeof actual.existsSync>[0]) =>
      String(target).endsWith("landing-hero.webp") ? heroFile.present : actual.existsSync(target),
  };
});

const { default: LandingPage } = await import("@/app/(public)/page");
const { default: PricingPage } = await import("@/app/(public)/pricing/page");
const { default: PrivacyPage } = await import("@/app/(public)/privacy/page");
const { default: TermsPage } = await import("@/app/(public)/terms/page");

async function landingHtml(): Promise<string> {
  return renderToStaticMarkup(await LandingPage());
}

/** Where a redirect() sent somebody: Next carries it on the thrown error's digest. */
async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    const path = digest.split(";")[2];
    if (digest.startsWith("NEXT_REDIRECT") && path) return path;
    throw error;
  }
  throw new Error("nothing was redirected — the page rendered instead");
}

beforeEach(() => {
  session.user = null;
  heroFile.present = false;
});

describe("the landing page, signed out", () => {
  it("shows the headline, the promise under it and both ways in", async () => {
    const html = await landingHtml();

    expect(html).toContain("One project. Every company.");
    expect(html).toContain("One source of truth.");
    expect(html).toContain("Every department’s work, however your team is organised");
    expect(html).toContain("Get started");
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
  });

  it("sells the five things the app actually does, and anchors the Features link", async () => {
    const html = await landingHtml();

    expect(html).toContain('id="features"');
    expect(html).toContain("A task can never say done unless its work is done.");
    expect(html).toContain("Bring in a contractor without opening up the whole project.");
    expect(html).toContain("Upload a correction. The old version never disappears.");
    expect(html).toContain("copied to the channel they already watch.");
    expect(html).toContain("Sign up, pick your industry, and your departments are already there.");
  });

  it("names the three honesty facts and no customer, logo or testimonial", async () => {
    const html = await landingHtml();

    expect(html).toContain("Every change is written to a permanent audit trail.");
    expect(html).toContain("Document revisions are never overwritten");
    expect(html).toContain("Each company’s workspace is sealed off from every other.");
    expect(html).not.toMatch(/trusted by/i);
    expect(html).not.toMatch(/testimonial/i);
  });

  it("teases the price from the one constant, and sends people to the pricing page", async () => {
    const { PRO_PRICE } = await import("@/lib/plan-limits");
    const html = await landingHtml();

    expect(html).toContain(PRO_PRICE);
    expect(html).toContain("Compare plans");
    expect(html).toContain('href="/pricing"');
  });

  it("asks for no photograph at all while the file is not there", async () => {
    // The hero is the ink gradient on its own. An <Image> for a file that does not exist would
    // still be fetched, still 400 at the image optimiser and still log errors in the console.
    const html = await landingHtml();

    expect(html).not.toContain("landing-hero");
    expect(html).not.toContain("<img");
    // The gradient — the hero's floor — is server-rendered and always present.
    expect(html).toContain("var(--brand-ink)");
  });

  it("lays the photograph on top the moment the file is really there", async () => {
    heroFile.present = true;
    const html = await landingHtml();

    expect(html).toContain("landing-hero.webp");
    expect(html).toContain("<img");
  });

  it("leaks nothing from inside the app", async () => {
    const html = `${await landingHtml()}${renderToStaticMarkup(PricingPage())}`;

    // Nothing a visitor cannot open is ever linked from a public page.
    expect(html).not.toContain('href="/dashboard"');
    expect(html).not.toContain('href="/admin');
    expect(html).not.toContain('href="/api/');
    // No internals, no demo data, no seeded names.
    expect(html).not.toMatch(/orgId|prisma|SUR-EXP|Legacy workspace|@tielora\./i);
  });
});

describe("the landing page, signed in", () => {
  it("still sends an internal person straight to their dashboard", async () => {
    session.user = { role: "ADMIN" };
    expect(await redirectedTo(() => LandingPage())).toBe("/dashboard");

    session.user = { role: "ENGINEER" };
    expect(await redirectedTo(() => LandingPage())).toBe("/dashboard");
  });

  it("still sends a contractor to their own home page, not a dashboard they have none of", async () => {
    session.user = { role: "EXTERNAL" };

    const path = await redirectedTo(() => LandingPage());
    expect(path).toBe("/my-tasks");
    expect(path).toBe(homePathFor("EXTERNAL"));
  });
});

describe("the pricing page", () => {
  const original = { ...PLANS.FREE };

  afterEach(() => {
    Object.assign(PLANS.FREE, original);
  });

  it("says what each plan includes, in the words plan-limits.ts writes", () => {
    const html = renderToStaticMarkup(PricingPage());

    expect(html).toContain("1 project");
    expect(html).toContain("Up to 10 people");
    expect(html).toContain("500 MB of documents");
    expect(html).toContain("Unlimited projects");
    expect(html).toContain("Unlimited people");
    expect(html).toContain("10 GB of documents");
    expect(html).toContain("Nothing is ever locked behind a higher plan.");
  });

  it("DERIVES every number: change a limit and the page changes with it", () => {
    PLANS.FREE.projects = 7;
    PLANS.FREE.documentBytes = 2 * 1024 ** 3;

    const html = renderToStaticMarkup(PricingPage());

    expect(html).toContain(limitAmount("projects", 7));
    expect(html).toContain("7 projects");
    expect(html).toContain("2 GB of documents");
    // The old numbers are gone — which is only possible if nothing was typed out.
    expect(html).not.toContain("1 project");
    expect(html).not.toContain("500 MB");
  });

  it("shows the price from the shared constant and never starts a checkout", async () => {
    const { PRO_PRICE } = await import("@/lib/plan-limits");
    const html = renderToStaticMarkup(PricingPage());

    expect(html).toContain(PRO_PRICE);
    // Both CTAs go to signup: this page has no session and cannot upgrade anybody's company.
    expect(html).toContain("Get started free");
    expect(html).toContain("Upgrade to Pro");
    expect(html.match(/href="\/signup"/g) ?? []).toHaveLength(2);
  });
});

describe("the legal pages", () => {
  it("still render, with their content untouched", () => {
    const privacy = renderToStaticMarkup(PrivacyPage());
    const terms = renderToStaticMarkup(TermsPage());

    expect(privacy).toContain("Privacy notice");
    expect(privacy).toContain("Last updated 31 Aug 2026");
    expect(privacy).toContain("What is stored");
    expect(terms).toContain("Terms of use");
    expect(terms).toContain("How access works");
  });

  it("point home at the landing page now, never at a sign-in wall", () => {
    for (const html of [renderToStaticMarkup(PrivacyPage()), renderToStaticMarkup(TermsPage())]) {
      expect(html).toContain("Back to Tielora");
      expect(html).toContain('href="/"');
      expect(html).not.toContain('href="/dashboard"');
    }
  });
});
