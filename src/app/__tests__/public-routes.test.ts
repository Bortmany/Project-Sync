// What a crawler is told, and where the public pages actually live.
//
// Two things are pinned here. First, /robots.txt and /sitemap.xml name the SIX public pages and
// nothing behind the sign-in wall — this app is a workspace, and a project page in a search index
// would be a promise it cannot keep. Second, the (public) route group really is invisible in the
// address: /privacy and /terms did not move when their files did.

import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DEV_SITE_URL, PUBLIC_ROUTES, siteUrl } from "@/lib/site";

const originalBaseUrl = process.env.APP_BASE_URL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
});

describe("the sitemap", () => {
  it("lists exactly the six public pages", () => {
    delete process.env.APP_BASE_URL;
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).toHaveLength(6);
    expect(urls).toEqual([
      `${DEV_SITE_URL}/`,
      `${DEV_SITE_URL}/pricing`,
      `${DEV_SITE_URL}/privacy`,
      `${DEV_SITE_URL}/terms`,
      `${DEV_SITE_URL}/login`,
      `${DEV_SITE_URL}/signup`,
    ]);
    expect(PUBLIC_ROUTES).toHaveLength(6);
  });

  it("names nothing that needs a session", () => {
    const urls = sitemap().map((entry) => entry.url);

    for (const behindTheWall of [
      "/dashboard",
      "/projects",
      "/my-tasks",
      "/admin",
      "/messages",
      "/account",
      "/api",
    ]) {
      expect(urls.some((url) => url.includes(behindTheWall))).toBe(false);
    }
  });

  it("uses this deployment's own address once APP_BASE_URL is set", () => {
    process.env.APP_BASE_URL = "https://tielora.example.com/";

    expect(siteUrl()).toBe("https://tielora.example.com");
    expect(sitemap()[0]?.url).toBe("https://tielora.example.com/");
  });

  it("falls back to the development address, never to a broken one", () => {
    process.env.APP_BASE_URL = "not a url";
    expect(siteUrl()).toBe(DEV_SITE_URL);

    process.env.APP_BASE_URL = "ftp://tielora.example.com";
    expect(siteUrl()).toBe(DEV_SITE_URL);
  });
});

describe("robots.txt", () => {
  it("invites crawlers into the public pages and nowhere else", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;

    // Every public page but "/" — a bare `Allow: /` is the shortest rule there is, and a crawler
    // that takes the first match rather than the most specific one would read it as "all of it".
    // Anything not disallowed is allowed anyway, so the home page loses nothing.
    expect(rule?.allow).toEqual(PUBLIC_ROUTES.filter((route) => route !== "/"));
    expect(rule?.allow).not.toContain("/");
    expect(rule?.disallow).toContain("/api/");
    expect(rule?.disallow).toContain("/admin");
    expect(rule?.disallow).toContain("/dashboard");
  });

  it("keeps crawlers off the four emailed-link pages", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;

    // /verify-email spends its token the moment it is opened, and all four cost rate-limit
    // budget: they belong to whoever is holding the link and to nobody else.
    for (const page of ["/forgot-password", "/reset-password", "/set-password", "/verify-email"]) {
      expect(rule?.disallow).toContain(page);
    }
  });

  it("points at the sitemap on the same address", () => {
    delete process.env.APP_BASE_URL;
    expect(robots().sitemap).toBe(`${DEV_SITE_URL}/sitemap.xml`);
  });
});

describe("the (public) route group", () => {
  it("does not change a single address: /privacy and /terms are where they always were", () => {
    // A route group's folder name is invisible in the URL, so these four files ARE /, /pricing,
    // /privacy and /terms. The old copies are gone, which is what stops two files claiming one
    // address.
    expect(existsSync("src/app/(public)/page.tsx")).toBe(true);
    expect(existsSync("src/app/(public)/pricing/page.tsx")).toBe(true);
    expect(existsSync("src/app/(public)/privacy/page.tsx")).toBe(true);
    expect(existsSync("src/app/(public)/terms/page.tsx")).toBe(true);

    expect(existsSync("src/app/page.tsx")).toBe(false);
    expect(existsSync("src/app/privacy/page.tsx")).toBe(false);
    expect(existsSync("src/app/terms/page.tsx")).toBe(false);
  });
});
