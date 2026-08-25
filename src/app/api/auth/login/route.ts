// Sign in: rate limited by IP and by account, validated with zod, and deliberately vague about which half was wrong.

import { NextResponse } from "next/server";
import {
  burnPasswordCheck,
  mintSession,
  pruneExpiredSessions,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { byIp, checkOnly, clearFailures, clientIp, limit, recordFailure } from "@/lib/rate-limit";
import { LoginInput } from "@/lib/zod-schemas";

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

  if (!user || !user.isActive) {
    // Same time cost as a real account, and no address in the log — people mistype passwords into email boxes.
    await burnPasswordCheck();
    recordFailure(accountKey, 15 * 60_000);
    logger.warn("Sign-in refused", {
      reason: user ? "inactive" : "unknown-email",
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
        metadata: { reportedIp: ip ?? null }, // reported by the client's proxy chain, not verified
      },
    }),
  ]);
  await setSessionCookie(minted.rawToken, minted.expiresAt);

  void pruneExpiredSessions();

  logger.info("Sign-in succeeded", { userId: user.id });
  return NextResponse.json({ ok: true, data: { id: user.id, name: user.name, role: user.role } });
}
