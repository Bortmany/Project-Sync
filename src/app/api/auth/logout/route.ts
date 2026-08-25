// Sign out: deletes the session row and clears the cookie. Rate limited like every auth route.

import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { byIp, limit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "logout"), 30, 60_000);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  await destroySession();
  return NextResponse.json({ ok: true, data: { signedOut: true } });
}
