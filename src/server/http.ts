// Shared plumbing for the read routes: sign-in check, rate limit, and the standard success/failure envelopes.

import { NextResponse } from "next/server";
import { byUser, limit } from "@/lib/rate-limit";
import type { ActorContext } from "@/server/actor";
import { statusFor, toFailure } from "@/server/errors";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";

/** Reads per person per minute. Generous — these pages poll — but still a ceiling. */
const READ_LIMIT = 240;
const READ_WINDOW_MS = 60_000;

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data });
}

export function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** A failure that can point at the exact query or field that was wrong. */
export function failWithFields(
  message: string,
  fieldErrors: Record<string, string[]>,
  status = 400,
): NextResponse {
  return NextResponse.json({ ok: false, error: message, fieldErrors }, { status });
}

/** Turns a thrown service error into the right status and a plain-English message. */
export function failFrom(error: unknown, context: Record<string, unknown> = {}): NextResponse {
  const body = toFailure(error, context);
  return NextResponse.json(body, { status: statusFor(error) });
}

/**
 * The named query parameters as a plain object, with blanks left out so an optional field in a zod
 * schema stays absent rather than arriving as an empty string.
 */
export function queryRecord(request: Request, keys: string[]): Record<string, string> {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value.trim() !== "") raw[key] = value;
  }
  return raw;
}

/**
 * A tighter ceiling on top of guardRead, for the few routes where one request costs a call to
 * somebody else's service. Returns the 429 to hand back, or null to carry on.
 */
export function tighterLimit(
  actor: ActorContext,
  scope: string,
  max: number,
  windowMs = 60_000,
): NextResponse | null {
  const throttle = limit(byUser(actor.userId, scope), max, windowMs);
  if (throttle.ok) return null;
  return NextResponse.json(
    { ok: false, error: "That is a lot of requests at once. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
  );
}

type Guarded = { actor: ActorContext; response?: undefined } | { actor?: undefined; response: NextResponse };

/** Every read route starts here: signed in, and not hammering the endpoint. */
export async function guardRead(scope: string): Promise<Guarded> {
  const actor = await currentActor();
  if (!actor) return { response: fail(SIGNED_OUT_MESSAGE, 401) };

  const throttle = limit(byUser(actor.userId, scope), READ_LIMIT, READ_WINDOW_MS);
  if (!throttle.ok) {
    return {
      response: NextResponse.json(
        { ok: false, error: "That is a lot of requests at once. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
      ),
    };
  }

  return { actor };
}
