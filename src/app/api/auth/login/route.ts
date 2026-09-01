// Sign in: rate limited by IP and by account, validated with zod, and deliberately vague about which half was wrong.
//
// An account with two-factor sign-in switched on stops here with a five-minute pending token and
// NOTHING else — no session row, no cookie, no LOGIN audit row and no lastLoginAt. The second step
// is POST /api/auth/two-factor. An account without it behaves exactly as it always has.

import { NextResponse } from "next/server";
import {
  burnPasswordCheck,
  mintSession,
  pruneExpiredSessions,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { isAccessExpired } from "@/lib/access-expiry";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { byIp, checkOnly, clearFailures, clientIp, limit, recordFailure } from "@/lib/rate-limit";
import { LoginInput } from "@/lib/zod-schemas";
import { EMAIL_TOKEN_TTL_MS, issueEmailToken } from "@/server/services/email-tokens";
import { readableTotpSecret } from "@/server/services/two-factor";

const GENERIC_FAILURE = "Incorrect email or password.";

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "login"), 10, 60_000);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was not readable." }, { status: 400 });
  }

  const parsed = LoginInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 400 });
  }

  const { email, password } = parsed.data;

  // Second limiter keyed on the account, counting FAILURES only — five bad guesses from
  // an attacker must not lock the real owner's next correct sign-in out for the window,
  // and a success forgives the count. Rotating the forwarded IP still buys nothing.
  const accountKey = `login-account:${email}`;
  const accountThrottle = checkOnly(accountKey, 5);
  if (!accountThrottle.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(accountThrottle.retryAfterSec) } },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // A contractor whose access has run out is turned away exactly like a deactivated account: the
  // same wording, the same status, the same time cost. Nobody outside is ever told which it was.
  const accessExpired = user ? isAccessExpired(user) : false;

  if (!user || !user.isActive || accessExpired) {
    // Same time cost as a real account, and no address in the log — people mistype passwords into email boxes.
    await burnPasswordCheck();
    recordFailure(accountKey, 15 * 60_000);
    logger.warn("Sign-in refused", {
      reason: !user ? "unknown-email" : user.isActive ? "access-expired" : "inactive",
      userId: user?.id,
    });
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 401 });
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    recordFailure(accountKey, 15 * 60_000);
    logger.warn("Sign-in refused", { reason: "wrong-password", userId: user.id });
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 401 });
  }
  clearFailures(accountKey);

  // THE PASSWORD IS ONLY HALF OF IT for anybody who has switched two-factor on. They get a
  // single-use, five-minute ticket to the second screen and nothing else — no session row, no
  // cookie, no audit row, no lastLoginAt. A ticket alone can never sign anybody in.
  if (user.totpEnabledAt) {
    const secret = await readableTotpSecret(user);
    if (secret) {
      const issued = await issueEmailToken(
        user.id,
        "TWOFA_PENDING",
        EMAIL_TOKEN_TTL_MS.TWOFA_PENDING,
      );
      logger.info("Sign-in is waiting for a second factor", { userId: user.id });
      return NextResponse.json({
        ok: true,
        data: {
          status: "TWO_FACTOR_REQUIRED",
          pendingToken: issued.rawToken,
          expiresAt: issued.expiresAt,
        },
      });
    }
    // The saved secret could not be read — a rotated SESSION_SECRET looks exactly like this. It has
    // just been switched off for them and they have been told so in the app; asking for a code no
    // app can produce would lock them out of their own account instead. Carry on with the password.
  }

  const ip = clientIp(request);
  const minted = mintSession();

  // Session row, lastLoginAt and the audit row commit or fail together; the cookie is only set after commit.
  await prisma.$transaction([
    prisma.session.create({
      data: {
        tokenHash: minted.tokenHash,
        userId: user.id,
        expiresAt: minted.expiresAt,
        ip: ip ?? undefined,
        userAgent: request.headers.get("user-agent")?.slice(0, 300),
      },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.activityLog.create({
      data: {
        actorId: user.id,
        entityType: "User",
        entityId: user.id,
        action: "LOGIN",
        summary: `${user.name} signed in`,
        // reportedIp comes from the client's proxy chain and is not verified. `twoFactor: false`
        // says this sign-in was the password alone — the second-factor route writes the same row
        // with true, so the trail always says which door somebody came through.
        metadata: { reportedIp: ip ?? null, twoFactor: false },
      },
    }),
  ]);
  await setSessionCookie(minted.rawToken, minted.expiresAt);

  void pruneExpiredSessions();

  logger.info("Sign-in succeeded", { userId: user.id });
  return NextResponse.json({ ok: true, data: { id: user.id, name: user.name, role: user.role } });
}
