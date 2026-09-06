// Sign a new company up. The only public write in the app: rate limited by IP, validated with zod,
// gated by the deployment's sign-up mode (open / invite-only / closed — src/lib/signup-mode.ts),
// and it ends exactly where sign-in ends — a session cookie and the same small "who you are" body.

import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { byIp, checkOnly, clientIp, limit, recordFailure } from "@/lib/rate-limit";
import { SIGNUP_CLOSED_MESSAGE, signupMode, signupRefusal } from "@/lib/signup-mode";
import { SignupInput, toFieldErrors } from "@/lib/zod-schemas";
import { statusFor, toFailure } from "@/server/errors";
import { signUpOrganization } from "@/server/services/signup";

/** New companies per IP address per hour. Generous for a person, useless for a script. */
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

/** Wrong invite codes per IP address per 15 minutes — failures only, the way wrong passwords are counted. */
const INVITE_FAILURE_LIMIT = 10;
const INVITE_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "signup"), SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-ups from here. Please wait a while and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  // Closed is closed: nothing is read, nothing is parsed, nobody learns anything else.
  if (signupMode() === "closed") {
    return NextResponse.json({ ok: false, error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
  }

  // Guessing invite codes is counted on its own, failures only, so a person who mistypes twice is
  // not locked out of a real sign-up, and a script rotating guesses runs out of tries.
  const inviteKey = byIp(request, "signup-invite");
  const inviteThrottle = checkOnly(inviteKey, INVITE_FAILURE_LIMIT);
  if (!inviteThrottle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many invite code attempts. Please wait a while and try again." },
      { status: 429, headers: { "Retry-After": String(inviteThrottle.retryAfterSec) } },
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

  // The door itself. A wrong or missing code is refused before anything touches the database, and
  // the refusal names the field so the form can go back to it. The code is never logged: it is a
  // bearer secret, and a near-miss in a log line is most of a secret.
  const refusal = signupRefusal(parsed.data.inviteCode);
  if (refusal) {
    recordFailure(inviteKey, INVITE_FAILURE_WINDOW_MS);
    logger.warn("Sign-up refused", { reason: "invite-code" });
    return NextResponse.json(
      { ok: false, error: refusal, fieldErrors: { inviteCode: [refusal] } },
      { status: 403 },
    );
  }

  try {
    // The service gets the company and the person, and not the code — it has done its job.
    const { organizationName, industryTemplate, name, email, password } = parsed.data;
    const { result, session } = await signUpOrganization(
      { organizationName, industryTemplate, name, email, password },
      {
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
      },
    );

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
