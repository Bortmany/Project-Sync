// /sitemap.xml — the six pages a stranger can open, and nothing else.
//
// The list is PUBLIC_ROUTES in src/lib/site.ts, shared with robots.ts, so a page behind the
// sign-in wall can never quietly appear here.

import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, siteUrl } from "@/lib/site";

// Read the address per request, for the same reason robots.ts does: `APP_BASE_URL` belongs to the
// deployment, and a sitemap baked at build time would list the builder's own address instead.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_ROUTES.map((route) => ({
    url: route === "/" ? `${base}/` : `${base}${route}`,
    // The landing page leads; the rest are equal. No lastModified: nothing here is generated from
    // data, so a date would be invented rather than known.
    priority: route === "/" ? 1 : 0.7,
  }));
}
