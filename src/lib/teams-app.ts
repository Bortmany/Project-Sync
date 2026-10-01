// The Tielora Teams app ("Your day" as a tab inside Microsoft Teams) — the rules of the road, with
// no database and no network. The tab is read-only; signing in to it reuses the Microsoft sign-in
// identity (src/lib/ms-id-token.ts) and never matches on email.
//
// THREE RULES:
//  1. **Dormant until configured** (house rule 11). "Configured" means ALL of: `TEAMS_APP_ID` is a
//     GUID, `APP_BASE_URL` is an https address, and the Azure registration (`MS_GRAPH_CLIENT_ID`
//     and `MS_GRAPH_CLIENT_SECRET`) exists. Anything missing is "dormant": no admin card, the
//     manifest and the tab page say "not found", the session routes say "not set up".
//  2. **The tab has its own cookie, boxed in.** `tielora_teams`: HttpOnly, Secure, SameSite=None,
//     Partitioned (CHIPS) and Path=/teams. Path=/teams means the browser never sends it to any
//     /api route, so no data-changing route can ever be reached with it; Partitioned means it only
//     travels when Tielora is framed inside a Teams page. `nexus_session` is never touched.
//  3. **Nothing here names a company.** The package is the same for everybody.

import { appBaseUrl, microsoftConfig } from "@/lib/ms-graph";
import { looksLikeGuid } from "@/lib/ms-id-token";

/** The tab's sign-in cookie. Read only by `getTeamsTabUser()` and only for /teams/tab. */
export const TEAMS_COOKIE = "tielora_teams";

/** Limits the cookie to the tab's pages: it is never sent to /api/... or anywhere else. */
export const TEAMS_COOKIE_PATH = "/teams";

/** What the Teams tab cookie looks like — one place, used by both tab routes. */
export function teamsCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    // SameSite=None is refused by browsers without Secure, so it is always on — Teams only ever
    // loads an https address anyway.
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    path: TEAMS_COOKIE_PATH,
    expires,
  };
}

/** The same cookie, emptied (an immediate expiry). Used for a clean-up, never on the browser cookie. */
export function teamsCookieClearOptions() {
  return { ...teamsCookieOptions(new Date(0)), maxAge: 0 };
}

export type TeamsAppConfig = {
  /** The Teams app's own GUID (`TEAMS_APP_ID`). Identifies the app in Teams; not a secret. */
  appId: string;
  /** `APP_BASE_URL` without a trailing slash; always https. */
  baseUrl: string;
  /** The deployment's host — the ONE entry in the manifest's `validDomains`. */
  host: string;
  /** The Azure app registration's client id (same one Sign in with Microsoft uses). */
  clientId: string;
  /** The `api://<host>/<client id>` address exposed in Azure ("Application ID URI"). */
  resource: string;
  /**
   * The ONE `aud` the Teams token must carry. A v2.0 token carries the client id (the default);
   * `TEAMS_SSO_AUDIENCE` exists so that, if a real token shows the registration issues the
   * `api://` address instead, the owner changes one setting rather than the code. Never both.
   */
  audience: string;
};

/** The configuration when the feature is fully set up, otherwise null (= dormant). */
export function teamsAppConfig(env: NodeJS.ProcessEnv = process.env): TeamsAppConfig | null {
  const appId = env.TEAMS_APP_ID?.trim() ?? "";
  if (!looksLikeGuid(appId)) return null;

  const base = appBaseUrl(env);
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const ms = microsoftConfig(env);
  if (!ms) return null;

  const resource = `api://${url.host}/${ms.clientId}`;
  const audience = env.TEAMS_SSO_AUDIENCE?.trim() || ms.clientId;

  return {
    appId: appId.toLowerCase(),
    baseUrl: base,
    host: url.host,
    clientId: ms.clientId,
    resource,
    audience,
  };
}

/** "configured" or "dormant" — the word /api/health shows, and nothing else. */
export function teamsAppStatus(env: NodeJS.ProcessEnv = process.env): "configured" | "dormant" {
  return teamsAppConfig(env) ? "configured" : "dormant";
}

export { TEAMS_AUTH_END_PATH, TEAMS_NOT_SET_UP, TEAMS_SIGN_IN_FAILED_MESSAGE } from "@/lib/teams-messages";

/** What `LOGIN.metadata.via` says about which Teams door was used. */
export type TeamsVia = "teams-sso" | "teams-popup" | "teams";
