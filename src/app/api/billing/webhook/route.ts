// The payment provider's webhook. The only public write in this app besides signing up, and the
// only one nobody signs in for — which is why the signature check in the service is what stands in
// for authentication, and why this route does as little as it possibly can.
//
// It reads the RAW body and hands it, untouched, to processBillingWebhook(). Nothing here parses
// JSON: re-serialising the body would change the bytes the signature was computed over, and a
// verified-but-rewritten payload is exactly the thing that must not be possible.
//
// While the provider is not set up this answers 503 "not set up". The provider retries and
// eventually marks the delivery failed, which is the honest outcome: nothing is configured here.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { byIp, limit } from "@/lib/rate-limit";
import { processBillingWebhook } from "@/server/services/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generous on purpose. Webhooks arrive in bursts — a provider that has been queuing deliveries can
 * send dozens in a few seconds, and a 429 there costs us a retry cycle for no benefit. This is a
 * ceiling against a flood, not a throttle on normal traffic.
 */
const WEBHOOK_LIMIT = 600;
const WEBHOOK_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "billing-webhook"), WEBHOOK_LIMIT, WEBHOOK_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was not readable." }, { status: 400 });
  }

  try {
    const outcome = await processBillingWebhook(rawBody, request.headers.get("paddle-signature"));
    if (outcome.httpStatus === 200) {
      return NextResponse.json({ ok: true, data: { received: true } });
    }
    return NextResponse.json({ ok: false, error: outcome.message }, { status: outcome.httpStatus });
  } catch (error) {
    // A 500 is the right answer here: the provider retries, and a retry of an event we failed to
    // finish is exactly what the idempotency key is for.
    logger.error("A billing webhook could not be processed", { route: "POST /api/billing/webhook", error });
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our side." },
      { status: 500 },
    );
  }
}
