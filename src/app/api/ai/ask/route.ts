// POST /api/ai/ask: one question to Ask Tielora, one whole answer back. Nothing is streamed and
// nothing is saved: the question and the answer exist for the length of this request.
//
// Order is the law here (house rule 1, and THE EXTERNAL RULE):
//  1. signed in (401);
//  2. a contractor is "not found", HERE, before the body is even read (so a malformed body gets the
//     same 404 as a good one), the key check, the company switch, the rate limit or any load, so
//     they learn nothing about whether AI is even configured;
//  3. zod parse the body;
//  4. assertCan(ASK_ASSISTANT);
//  5. the rate limits (per person 5 a minute and 60 an hour; per company 300 a day) -> 429 with
//     Retry-After;
//  6. the service: configured, switched on, scoped facts, cap, call, spend + audit.

import { NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { byUser, limit } from "@/lib/rate-limit";
import { AskTieloraInput, toFieldErrors } from "@/lib/zod-schemas";
import { isExternal } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { fail, failFrom, failWithFields, ok } from "@/server/http";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";
import {
  AI_ASK_LIMITS,
  AI_ASK_MINUTE_MS,
  AI_ASK_SCOPE,
  AI_TOO_FAST,
  askLongerThrottle,
  askTielora,
} from "@/server/services/ai-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The question is at most 500 characters; nothing else is read, so a bigger body is not a question. */
const BODY_LIMIT = 4_000;
const BAD_BODY = "Type a question first.";

export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor) return fail(SIGNED_OUT_MESSAGE, 401);

  // THE EXTERNAL RULE: a contractor is "not found" before anything else is looked at.
  if (isExternal(actor)) {
    return failFrom(new NotFoundError("We could not find that."), { route: "POST /api/ai/ask" });
  }


  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > BODY_LIMIT) return fail("Keep your question to 500 characters or fewer.", 400);
    raw = JSON.parse(text);
  } catch {
    return fail(BAD_BODY, 400);
  }
  const parsed = AskTieloraInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return failWithFields(Object.values(fieldErrors)[0]?.[0] ?? BAD_BODY, fieldErrors, 400);
  }
  try {
    assertCan(actor, "ASK_ASSISTANT");
  } catch (error) {
    return failFrom(error, { route: "POST /api/ai/ask" });
  }

  const minute = limit(byUser(actor.userId, AI_ASK_SCOPE), AI_ASK_LIMITS.perMinute, AI_ASK_MINUTE_MS);
  const throttle = minute.ok ? askLongerThrottle(actor) : minute;
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: AI_TOO_FAST },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  try {
    return ok(await askTielora(actor, parsed.data));
  } catch (error) {
    return failFrom(error, { route: "POST /api/ai/ask" });
  }
}
