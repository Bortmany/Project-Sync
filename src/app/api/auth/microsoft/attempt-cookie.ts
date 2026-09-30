// The Microsoft sign-in attempt cookie and the redirects every Microsoft route answers with.
// Shared by the start, enable and callback routes so the cookie's shape is written down once:
// httpOnly, SameSite=Lax (Microsoft's return is a top-level navigation, which Lax allows), only ever
// sent to /api/auth/microsoft/..., ten minutes, and deleted on the way back.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/ms-graph";
import {
  ATTEMPT_COOKIE,
  ATTEMPT_COOKIE_PATH,
  ATTEMPT_MAX_AGE_SEC,
} from "@/server/services/microsoft-signin";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: ATTEMPT_COOKIE_PATH,
    maxAge,
  };
}

export async function setAttemptCookie(value: string): Promise<void> {
  const jar = await cookies();
  jar.set(ATTEMPT_COOKIE, value, cookieOptions(ATTEMPT_MAX_AGE_SEC));
}

/** Reads the attempt and deletes it in the same breath: one attempt, one return trip. */
export async function takeAttemptCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(ATTEMPT_COOKIE)?.value;
  // Deleting a path-limited cookie needs the same path, so it is overwritten with an expired blank.
  jar.set(ATTEMPT_COOKIE, "", cookieOptions(0));
  return value || undefined;
}

/**
 * A redirect inside this app. Built on APP_BASE_URL when it is set — behind a proxy the request's
 * own address can be the internal one — and on the request's address otherwise.
 */
export function redirectTo(request: Request, pathWithQueryOrHash: string): NextResponse {
  const base = appBaseUrl() ?? request.url;
  return NextResponse.redirect(new URL(pathWithQueryOrHash, base), 302);
}

/** Where every refused Microsoft sign-in lands: the login page, which shows the one sentence. */
export const SIGN_IN_FAILED_PATH = "/login?microsoft=failed";

/** The URL-fragment key the login page reads the two-factor ticket from (`/login#mstf=<ticket>`). */
export const TWO_FACTOR_FRAGMENT_KEY = "mstf";
