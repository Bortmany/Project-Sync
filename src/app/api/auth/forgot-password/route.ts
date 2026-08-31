// "I forgot my password": the one public route in the app that deliberately tells you nothing.
//
// Whatever address arrives here — one with an account, one with a deactivated account, a
// contractor's whose access ran out last week, or one that has never existed — the answer is the
// same body, the same status, the same bytes. The decision about whether an email actually goes out
// is taken inside the service, where nobody outside can watch it.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { byIp, limit } from "@/lib/rate-limit";
import { ForgotPasswordInput } from "@/lib/zod-schemas";
import { EMAIL_DORMANT_MESSAGE, requestPasswordReset } from "@/server/services/account";
import { emailAvailable } from "@/server/services/email";

/** Reset requests per IP address per hour, and separately per address asked about. */
const REQUEST_LIMIT = 3;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;

/** The one answer. Built fresh each time so nothing can accidentally vary between them. */
const identicalAnswer = () => NextResponse.json({ ok: true, data: { sent: true } });

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Too many attempts. Please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "forgot-password"), REQUEST_LIMIT, REQUEST_WINDOW_MS);
  if (!throttle.ok) return tooMany(throttle.retryAfterSec);

  // No mail provider: the page already says so, and this says the same thing rather than
  // pretending a link is on its way.
  if (!emailAvailable()) {
    return NextResponse.json({ ok: false, error: EMAIL_DORMANT_MESSAGE }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was not readable." }, { status: 400 });
  }

  const parsed = ForgotPasswordInput.safeParse(body);
  // Something that is not an address at all is not a question about any account, so saying so
  // gives nothing away — and it saves somebody who mistyped from waiting for an email forever.
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Use an email address like name@company.com.",
        fieldErrors: { email: ["Use an email address like name@company.com."] },
      },
      { status: 400 },
    );
  }

  // A second ceiling on the address itself, so rotating the forwarded IP buys nothing. It counts
  // every request for that address by anybody, which is why it can never hint at whether the
  // address is real.
  const perAddress = limit(
    `email:forgot-password:${parsed.data.email}`,
    REQUEST_LIMIT,
    REQUEST_WINDOW_MS,
  );
  if (!perAddress.ok) return tooMany(perAddress.retryAfterSec);

  // NOT AWAITED, on purpose — this is the last thing standing between this page and an account
  // oracle. The bytes coming back are already identical, but the WAIT is not: a real account means
  // a whole transaction (retire the old links, write the new one, append the audit row) while a
  // missing address means one lookup and nothing else, and a stopwatch reads that difference all
  // day. So the work goes off the same road `deliverToOrgWebhooks()` takes — started, never waited
  // on — and the answer below leaves at the same moment for everybody. The audit row is still
  // written inside that transaction; nothing about the record of intent changes.
  void requestPasswordReset(parsed.data.email).catch((error: unknown) => {
    // The failure line carries a category and nothing else. Never the raw error: a Prisma failure
    // on a lookup keyed by email renders the address into its own message, which is exactly the
    // thing this whole route exists not to say.
    logger.error("Could not deal with a password reset request", {
      reason: error instanceof Error ? error.name : "unknown",
    });
  });

  return identicalAnswer();
}
