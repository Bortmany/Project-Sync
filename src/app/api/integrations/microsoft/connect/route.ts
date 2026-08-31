// "Connect" on the Microsoft 365 card: sends an administrator to Microsoft to sign in and approve.
//
// Dormant until the owner registers the Azure app: with no client id and secret this answers a
// plain "not set up" and nothing in the app offers the button in the first place.

import { NextResponse } from "next/server";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { ForbiddenError } from "@/lib/permissions";
import { byUser, limit } from "@/lib/rate-limit";
import { ServiceError } from "@/server/errors";
import { fail, failFrom } from "@/server/http";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";
import { microsoftAvailable, startMicrosoftConnect } from "@/server/services/microsoft";

export const dynamic = "force-dynamic";

const MICROSOFT_CONNECT_ROUTE = "GET /api/integrations/microsoft/connect";

/** Starting a connection is rare and admin-only, so the ceiling is deliberately low. */
const CONNECT_LIMIT = 10;
const CONNECT_WINDOW_MS = 60_000;

export async function GET(request: Request) {
  if (!microsoftAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const actor = await currentActor();
  if (!actor) return fail(SIGNED_OUT_MESSAGE, 401);

  const throttle = limit(byUser(actor.userId, "microsoft-connect"), CONNECT_LIMIT, CONNECT_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Please wait a moment before trying to connect again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  try {
    return NextResponse.redirect(await startMicrosoftConnect(actor), 302);
  } catch (error) {
    // Somebody who may not manage integrations is refused outright — never dressed up as a setup
    // problem. Only a real setup problem (APP_BASE_URL unset) goes back to the card, which explains
    // it in full.
    if (error instanceof ForbiddenError) return failFrom(error, { route: MICROSOFT_CONNECT_ROUTE });
    if (error instanceof ServiceError) {
      return NextResponse.redirect(new URL("/admin/integrations?microsoft=setup", request.url), 302);
    }
    return failFrom(error, { route: MICROSOFT_CONNECT_ROUTE });
  }
}
