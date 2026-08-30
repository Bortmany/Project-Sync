// Sign a new company up. The only public write in the app: rate limited by IP, validated with zod,
// and it ends exactly where sign-in ends — a session cookie and the same small "who you are" body.

import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { byIp, clientIp, limit } from "@/lib/rate-limit";
import { SignupInput, toFieldErrors } from "@/lib/zod-schemas";
import { statusFor, toFailure } from "@/server/errors";
import { signUpOrganization } from "@/server/services/signup";

/** New companies per IP address per hour. Generous for a person, useless for a script. */
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "signup"), SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-ups from here. Please wait a while and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was not readable." }, { status: 400 });
  }

  const parsed = SignupInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Please check the highlighted fields.",
        fieldErrors: toFieldErrors(parsed.error),
      },
      { status: 400 },
    );
  }

  try {
    const { result, session } = await signUpOrganization(parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    // The cookie is only set once the whole company has been committed.
    await setSessionCookie(session.rawToken, session.expiresAt);

    logger.info("New organisation signed up", {
      organizationId: result.organizationId,
      industryTemplate: parsed.data.industryTemplate,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return NextResponse.json(toFailure(error, { route: "POST /api/auth/signup" }), {
      status: statusFor(error),
    });
  }
}
