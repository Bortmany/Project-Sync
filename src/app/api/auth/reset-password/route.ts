// Spending a reset link. Public, rate limited by IP, and it hands back no session on purpose:
// changing a password is not the same act as signing in, and a link that minted a session would be
// a way past every rule the sign-in route keeps — including the one that turns an EXTERNAL
// contractor away once their access has run out.

import { NextResponse } from "next/server";
import { byIp, limit } from "@/lib/rate-limit";
import { ResetPasswordInput, toFieldErrors } from "@/lib/zod-schemas";
import { statusFor, toFailure } from "@/server/errors";
import { resetPassword } from "@/server/services/account";

/** Attempts per IP address per hour. A person needs one; a script wants thousands. */
const RESET_LIMIT = 10;
const RESET_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "reset-password"), RESET_LIMIT, RESET_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was not readable." }, { status: 400 });
  }

  const parsed = ResetPasswordInput.safeParse(body);
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
    return NextResponse.json({ ok: true, data: await resetPassword(parsed.data) });
  } catch (error) {
    return NextResponse.json(toFailure(error, { route: "POST /api/auth/reset-password" }), {
      status: statusFor(error),
    });
  }
}
