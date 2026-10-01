// The Teams tab signing in. Public (there is no session yet), so it is the door that is boxed in:
//
//  - Dormant (no `TEAMS_APP_ID` set up): "not set up", 503, and nothing else happens.
//  - Body: exactly ONE of `{ ssoToken }` (Teams' single-sign-on token) or `{ handoffCode }` (the
//    Microsoft popup's one-time code). Never both, never neither.
//  - Success without two-factor: sets the tab's own cookie (`tielora_teams`: HttpOnly, Secure,
//    SameSite=None, Partitioned, Path=/teams — never sent to any /api route) and answers
//    `{ status: "SIGNED_IN" }`. The LOGIN row was written in the same transaction as the session.
//  - With two-factor: `{ status: "TWO_FACTOR_REQUIRED", pendingToken, expiresAt }` and NOTHING else
//    — no session, no cookie, no LOGIN row. The second step is `/api/teams/two-factor`.
//  - Any failure: 401 and the ONE sentence, whatever the reason (company not switched on, no
//    matching account, another company's token, deactivated, contractor access ended, bad token).
//
// Rate limits (house rule 10): `byIp` 20 a minute; and failures only, per address, ten in fifteen
// minutes (so a wrong hand-off code or a forged token cannot be ground at).

import { NextResponse } from "next/server";
import { checkOnly, byIp, clientIp, limit, recordFailure } from "@/lib/rate-limit";
import {
  TEAMS_COOKIE,
  TEAMS_NOT_SET_UP,
  TEAMS_SIGN_IN_FAILED_MESSAGE,
  teamsAppConfig,
  teamsCookieOptions,
} from "@/lib/teams-app";
import { TeamsSessionInput } from "@/lib/zod-schemas";
import { fail } from "@/server/http";
import { signInWithHandoff, signInWithTeamsToken } from "@/server/services/teams-signin";

export const dynamic = "force-dynamic";

const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

const NO_STORE = { "Cache-Control": "private, no-store" };

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Too many sign-in attempts. Please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec), ...NO_STORE } },
  );
}

function refusedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE },
    { status: 401, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!teamsAppConfig()) return fail(TEAMS_NOT_SET_UP, 503);

  const throttle = limit(byIp(request, "teams-session"), 20, 60_000);
  if (!throttle.ok) return tooMany(throttle.retryAfterSec);

  const failureKey = byIp(request, "teams-session-failures");
  const failures = checkOnly(failureKey, FAILURE_LIMIT);
  if (!failures.ok) return tooMany(failures.retryAfterSec);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    recordFailure(failureKey, FAILURE_WINDOW_MS);
    return refusedResponse();
  }
  const parsed = TeamsSessionInput.safeParse(body);
  if (!parsed.success) {
    recordFailure(failureKey, FAILURE_WINDOW_MS);
    return refusedResponse();
  }

  const meta = { ip: clientIp(request), userAgent: request.headers.get("user-agent") };
  const outcome = parsed.data.ssoToken
    ? await signInWithTeamsToken(parsed.data.ssoToken, meta)
    : await signInWithHandoff(parsed.data.handoffCode as string, meta);

  if (outcome.kind === "refused") {
    // Only a bad hand-off code or a forged/invalid token counts toward the lockout; an ordinary
    // "not linked yet" or "company has not switched Microsoft on" must not lock an office out.
    // The browser sees the same answer either way.
    if (outcome.countsAsFailure) recordFailure(failureKey, FAILURE_WINDOW_MS);
    return refusedResponse();
  }

  if (outcome.kind === "two-factor") {
    return NextResponse.json(
      {
        ok: true,
        data: {
          status: "TWO_FACTOR_REQUIRED",
          pendingToken: outcome.pendingToken,
          expiresAt: outcome.expiresAt.toISOString(),
        },
      },
      { headers: NO_STORE },
    );
  }

  const response = NextResponse.json({ ok: true, data: { status: "SIGNED_IN" } }, { headers: NO_STORE });
  response.cookies.set(TEAMS_COOKIE, outcome.sessionToken, teamsCookieOptions(outcome.sessionExpiresAt));
  return response;
}
