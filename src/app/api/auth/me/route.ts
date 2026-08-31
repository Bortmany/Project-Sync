// Who am I: the signed-in person, or a 401 when the session has gone.
//
// Rate limited like every other auth route (house rule 10), with the two keys the standard asks
// for: a high per-IP ceiling first, because anonymous traffic arrives before we know who it is, and
// then the ordinary per-person read budget once the session says who is asking. The IP ceiling is
// deliberately generous — a whole office can share one address — but it still bounds a flood.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { byIp, byUser, limit } from "@/lib/rate-limit";

/** Anonymous callers, keyed by address: ten a second is far above any real browser. */
const IP_LIMIT = 600;
/** Signed-in callers, keyed by person: the same ceiling every read route has. */
const USER_LIMIT = 240;
const WINDOW_MS = 60_000;

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function GET(request: Request) {
  const byAddress = limit(byIp(request, "auth-me"), IP_LIMIT, WINDOW_MS);
  if (!byAddress.ok) return tooMany(byAddress.retryAfterSec);

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "You are signed out." }, { status: 401 });
  }

  const byPerson = limit(byUser(user.id, "auth-me"), USER_LIMIT, WINDOW_MS);
  if (!byPerson.ok) return tooMany(byPerson.retryAfterSec);

  return NextResponse.json({ ok: true, data: user });
}
