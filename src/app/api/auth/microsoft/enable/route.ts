// "Switch on" in the Microsoft 365 card's "Sign in with Microsoft" part. An administrator who may
// manage integrations is sent to Microsoft to sign in AS THEMSELVES; the callback captures the
// company's tenant from that token (never typed) and re-checks that the session coming back is this
// same administrator of this same company.

import { NextResponse } from "next/server";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { ForbiddenError } from "@/lib/permissions";
import { byUser, limit } from "@/lib/rate-limit";
import { fail, failFrom } from "@/server/http";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";
import {
  microsoftSignInAvailable,
  startMicrosoftSignInEnable,
} from "@/server/services/microsoft-signin";
import { redirectTo, setAttemptCookie } from "../attempt-cookie";

export const dynamic = "force-dynamic";

const ENABLE_ROUTE = "GET /api/auth/microsoft/enable";

/** Rare and admin-only, so the ceiling is deliberately low. */
const ENABLE_LIMIT = 5;
const ENABLE_WINDOW_MS = 60_000;

export async function GET(request: Request) {
  if (!microsoftSignInAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const actor = await currentActor();
  if (!actor) return fail(SIGNED_OUT_MESSAGE, 401);

  const throttle = limit(byUser(actor.userId, "microsoft-signin-enable"), ENABLE_LIMIT, ENABLE_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Please wait a moment before trying to switch this on again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let started;
  try {
    started = startMicrosoftSignInEnable(actor);
  } catch (error) {
    // Somebody who may not manage integrations is refused outright. Anything else is a setup
    // problem (APP_BASE_URL unset), which the card explains.
    if (error instanceof ForbiddenError) return failFrom(error, { route: ENABLE_ROUTE });
    return redirectTo(request, "/admin/integrations?microsoftSignIn=failed");
  }

  await setAttemptCookie(started.cookieValue);
  return NextResponse.redirect(started.authorizeUrl, 302);
}
