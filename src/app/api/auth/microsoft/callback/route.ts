// Where Microsoft sends the browser back after "Sign in with Microsoft" — and after an
// administrator's "Switch on". The attempt cookie says which of the two it was.
//
// Sign-in outcomes:
//  - in:            session cookie set after the commit, then 302 to the person's home page.
//  - two-factor on: 302 to `/login#mstf=<ticket>` — the ticket travels in the address FRAGMENT,
//                   which no browser ever sends to a server or puts in a Referer; the login page
//                   strips it at once. Never a query string, never a log line, never a cookie.
//  - anything else: 302 to `/login?microsoft=failed`, and the login page shows the password
//                   route's own sentence. One answer, whatever went wrong.
// Switch-on outcomes: 302 to `/admin/integrations?microsoftSignIn=<outcome>`.
//
// Neither the code, the ID token, nor anything Microsoft sent is ever echoed into an address or a
// log line.

import { NextResponse } from "next/server";
import { pruneExpiredSessions, setSessionCookie } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { byIp, checkOnly, clientIp, limit, recordFailure } from "@/lib/rate-limit";
import { homePathFor } from "@/components/shell/nav-items";
import { fail } from "@/server/http";
import { currentActor } from "@/server/session";
import {
  completeMicrosoftSignIn,
  completeMicrosoftSignInEnable,
  microsoftSignInAvailable,
  openAttempt,
} from "@/server/services/microsoft-signin";
import {
  SIGN_IN_FAILED_PATH,
  TWO_FACTOR_FRAGMENT_KEY,
  redirectTo,
  takeAttemptCookie,
} from "../attempt-cookie";

export const dynamic = "force-dynamic";

/** The password route's number. */
const CALLBACK_LIMIT = 10;
const CALLBACK_WINDOW_MS = 60_000;

/** Failures only, per address: ten refused Microsoft sign-ins in fifteen minutes and it pauses. */
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Too many sign-in attempts. Please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function GET(request: Request) {
  if (!microsoftSignInAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const throttle = limit(byIp(request, "microsoft-signin-callback"), CALLBACK_LIMIT, CALLBACK_WINDOW_MS);
  if (!throttle.ok) return tooMany(throttle.retryAfterSec);

  // Keyed on the address only — NEVER on `login-account:<email>`: a Microsoft attempt has no
  // password to guess and must not be able to lock the real owner out of the password form.
  const failureKey = byIp(request, "microsoft-signin-failures");
  const failures = checkOnly(failureKey, FAILURE_LIMIT);
  if (!failures.ok) return tooMany(failures.retryAfterSec);

  const attempt = openAttempt(await takeAttemptCookie());
  const params = new URL(request.url).searchParams;
  const input = {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
  };

  if (!attempt) {
    recordFailure(failureKey, FAILURE_WINDOW_MS);
    logger.warn("Microsoft sign-in refused", { reason: "attempt-missing-or-expired" });
    return redirectTo(request, SIGN_IN_FAILED_PATH);
  }

  try {
    if (attempt.purpose === "enable") {
      const actor = await currentActor();
      const outcome = await completeMicrosoftSignInEnable(actor, attempt, input);
      if (outcome !== "enabled") recordFailure(failureKey, FAILURE_WINDOW_MS);
      return redirectTo(request, `/admin/integrations?microsoftSignIn=${outcome}`);
    }

    const outcome = await completeMicrosoftSignIn(attempt, input, {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    if (outcome.kind === "refused") {
      recordFailure(failureKey, FAILURE_WINDOW_MS);
      return redirectTo(request, SIGN_IN_FAILED_PATH);
    }

    if (outcome.kind === "two-factor") {
      return redirectTo(request, `/login#${TWO_FACTOR_FRAGMENT_KEY}=${outcome.pendingToken}`);
    }

    await setSessionCookie(outcome.sessionToken, outcome.sessionExpiresAt);
    void pruneExpiredSessions();
    return redirectTo(request, homePathFor(outcome.role));
  } catch (error) {
    // Never the error itself — a Prisma message about a lookup can carry the value it looked up.
    recordFailure(failureKey, FAILURE_WINDOW_MS);
    logger.warn("Microsoft sign-in refused", {
      reason: "unexpected",
      category: error instanceof Error ? error.name : "unknown",
    });
    return attempt.purpose === "enable"
      ? redirectTo(request, "/admin/integrations?microsoftSignIn=failed")
      : redirectTo(request, SIGN_IN_FAILED_PATH);
  }
}
