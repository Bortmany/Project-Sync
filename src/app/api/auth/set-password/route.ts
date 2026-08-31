// Accepting an invitation: the first password a new colleague ever chooses.
//
// The twin of the reset route, and it ends the same way — no session, no cookie. Signing in is the
// next, deliberate step, so an invitation link is never a way into somebody's account on its own.

import { NextResponse } from "next/server";
import { byIp, limit } from "@/lib/rate-limit";
import { SetPasswordInput, toFieldErrors } from "@/lib/zod-schemas";
import { statusFor, toFailure } from "@/server/errors";
import { acceptInvite } from "@/server/services/account";

const SET_LIMIT = 10;
const SET_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "set-password"), SET_LIMIT, SET_WINDOW_MS);
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

  const parsed = SetPasswordInput.safeParse(body);
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
    return NextResponse.json({ ok: true, data: await acceptInvite(parsed.data) });
  } catch (error) {
    return NextResponse.json(toFailure(error, { route: "POST /api/auth/set-password" }), {
      status: statusFor(error),
    });
  }
}
