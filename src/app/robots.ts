// /robots.txt — what a crawler may look at.
//
// The public pages are open and everything else is not: this app is a workspace behind a sign-in,
// so an API route or a project page has no business in a search index (they answer "not found" to
// a stranger anyway). The list of open pages lives in src/lib/site.ts, beside the sitemap's.

import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, siteUrl } from "@/lib/site";

// READ THE ADDRESS PER REQUEST, not once at build time. `APP_BASE_URL` is a deployment setting, so
// a file baked during `npm run build` would ship the builder's own address — http://localhost:3000
// — into the live Sitemap: line.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Deliberately WITHOUT "/": anything not disallowed is allowed already, and a bare `Allow: /`
      // is the shortest possible rule — under a crawler that takes the first match rather than the
      // most specific one, it would wave everything below through.
      allow: PUBLIC_ROUTES.filter((route) => route !== "/"),
      // Everything a crawler could otherwise wander into. Each of these needs a session — except
      // the four emailed-link pages, which need no session and must never be fetched by anybody but
      // the person holding the link: /verify-email SPENDS its token on sight, and all four cost
      // rate-limit budget.
      disallow: [
        "/api/",
        "/dashboard",
        "/projects",
        "/tasks",
        "/discipline-tasks",
        "/my-tasks",
        "/admin",
        "/account",
        "/messages",
        "/notifications",
        "/search",
        "/forgot-password",
        "/reset-password",
        "/set-password",
        "/verify-email",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
