// "Sign in with Microsoft" on the login page: an ordinary link to here, which sends the browser to
// Microsoft with a fresh attempt (state, nonce, PKCE) sealed in a ten-minute httpOnly cookie.
//
// Dormant until the owner registers the Azure app: with MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
// unset this answers a plain "not set up" and redirects nowhere — and the login page shows no
// button in the first place.

import { NextResponse } from "next/server";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { byIp, limit } from "@/lib/rate-limit";
import { teamsAppConfig } from "@/lib/teams-app";
import { fail } from "@/server/http";
import { microsoftSignInAvailable, startMicrosoftSignIn } from "@/server/services/microsoft-signin";
import { setAttemptCookie } from "./attempt-cookie";

export const dynamic = "force-dynamic";

const START_LIMIT = 20;
const START_WINDOW_MS = 60_000;

export async function GET(request: Request) {
  if (!microsoftSignInAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const throttle = limit(byIp(request, "microsoft-signin-start"), START_LIMIT, START_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  // `?via=teams` is the Teams tab's sign-in window. It only changes how the callback ENDS (a one-time
  // hand-off code instead of a session); while the Teams app is dormant it is simply "not set up".
  const viaTeams = new URL(request.url).searchParams.get("via") === "teams";
  if (viaTeams && !teamsAppConfig()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  let started;
  try {
    started = startMicrosoftSignIn(viaTeams ? { via: "teams" } : {});
  } catch {
    // The registration is there but APP_BASE_URL is not, so there is no address for Microsoft to
    // send anybody back to. That is "not set up" too.
    return fail(MICROSOFT_NOT_CONFIGURED, 404);
  }

  await setAttemptCookie(started.cookieValue);
  return NextResponse.redirect(started.authorizeUrl, 302);
}
