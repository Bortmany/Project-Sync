// Where this copy of Tielora lives, and which pages a stranger may reach.
//
// Two small facts live here, and nowhere else:
//  - the site's own address, used by page metadata (`metadataBase`), `/robots.txt` and
//    `/sitemap.xml`, so a social preview and a search engine can never disagree about the domain;
//  - THE LIST OF PUBLIC ROUTES, which robots.ts and sitemap.ts both read, so the sitemap can never
//    quietly start naming a page behind the sign-in wall.
//
// Deliberately its own tiny file rather than reusing `appBaseUrl()` from the chat service: that one
// imports the database client, and the root layout, robots.txt and the sitemap have no business
// pulling Prisma in to answer "what is our address". The parsing rule is the same one.

/** What the address reads as while nobody has set `APP_BASE_URL` — a local `npm run dev`. */
export const DEV_SITE_URL = "http://localhost:3000";

/**
 * This deployment's address, with no trailing slash. Anything unusable — unset, blank, not a URL,
 * or not http(s) — reads as the development address, which is the safe direction: a wrong absolute
 * link in a preview card is a cosmetic problem, and throwing here would take every page down.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) return DEV_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEV_SITE_URL;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEV_SITE_URL;
  }
}

/**
 * Every page a visitor can open without signing in — the whole of what `/sitemap.xml` lists and the
 * only thing `/robots.txt` invites a crawler into. Everything else in this app needs a session, so
 * adding a route here is a deliberate act, not a side effect.
 */
export const PUBLIC_ROUTES = ["/", "/pricing", "/privacy", "/terms", "/login", "/signup"] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];
