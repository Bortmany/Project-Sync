import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * The Sentry ingest origin, when a DSN is configured. Without it the browser could never reach
 * Sentry even if browser reporting were switched on later. Parsed here rather than imported from
 * src/lib so next.config stays free of app imports.
 */
function sentryOrigin(): string | null {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

/**
 * Who may put a page inside a frame. Everywhere it is nobody (`'none'`). The ONE exception is the
 * Teams tab, `/teams/tab`, which Microsoft Teams loads in an iframe: it answers with `'self'` plus
 * an explicit list of Microsoft's Teams hosts. Never a bare `*`, never `https:`. The list is the
 * working starting list from the Teams research note; confirm it on Microsoft Learn when the owner
 * tests in a real Teams tenant (docs/GO-LIVE.md, "Teams app — publishing").
 */
const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
  "https://*.office.com",
  "https://*.microsoft365.com",
  "https://outlook.office.com",
  "https://*.cloud.microsoft",
];

type Framing = "none" | "teams";

/** The path that is allowed to be framed — and the only one. */
const TEAMS_TAB_PATH = "/teams/tab";

/**
 * Content-Security-Policy.
 *
 * The app is fully self-contained: no CDN, no external fonts, no analytics, no map tiles. So
 * everything is 'self', with three deliberate exceptions:
 *  - script-src 'unsafe-inline': Next.js streams the page's data through inline <script> tags
 *    (self.__next_f.push) and there is no middleware in this repo to mint a per-request nonce.
 *  - script-src 'unsafe-eval' in development only: the dev bundler and React Fast Refresh need it,
 *    and without it local preview silently breaks. It is NOT sent in production.
 *  - style-src 'unsafe-inline': React writes inline style attributes (the global error screen is
 *    styled that way on purpose, so it works even when the stylesheet failed to load).
 */
function contentSecurityPolicy(framing: Framing): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"])];
  const connectSrc = ["'self'", ...(sentryOrigin() ? [sentryOrigin() as string] : [])];

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    // Uploaded files are streamed from our own route as downloads (Content-Disposition:
    // attachment). Nothing in this app builds a blob: URL, so blob: is not allowed anywhere.
    `media-src 'self'`,
    `connect-src ${connectSrc.join(" ")}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    // The ONLY directive that differs between the two header rules below, from this one function,
    // so the rest of the policy can never drift apart.
    `frame-ancestors ${framing === "teams" ? TEAMS_FRAME_ANCESTORS.join(" ") : "'none'"}`,
    `form-action 'self'`,
    // Deliberately no `upgrade-insecure-requests`: Railway terminates HTTPS and
    // Strict-Transport-Security already forces it on the real domain, while the directive would
    // rewrite asset URLs during a local `npm run build && npm start` preview on http://localhost.
  ];

  return directives.join("; ");
}

function securityHeaders(framing: Framing) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(framing) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The old way of saying the same thing. Sent everywhere EXCEPT the Teams tab: X-Frame-Options has
    // no "allow these hosts" form, and a DENY would override the tab's frame-ancestors list.
    ...(framing === "none" ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    // HTTPS-only, and only in production — sending it from http://localhost would lock the browser
    // out of local development.
    ...(isProduction
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
      : []),
  ];
}

const nextConfig: NextConfig = {
  // pg reads certificates from disk at runtime; bundling it under webpack in `next dev`
  // breaks on the fs require, so it must stay an external server package.
  serverExternalPackages: ["pg", "pdfkit", "pptxgenjs"],

  async headers() {
    return [
      // Every page and every API route EXCEPT the Teams tab: nobody may frame it. The negative
      // look-ahead names the one exclusion exactly (`/teams/tab`, not `/teams/tabs` or below it).
      { source: "/((?!teams/tab$).*)", headers: securityHeaders("none") },
      // The Teams tab alone: framable by Microsoft Teams hosts, and by nobody else.
      { source: TEAMS_TAB_PATH, headers: securityHeaders("teams") },
    ];
  },
};

export default nextConfig;
