// Sign in: rate limited by IP, validated with zod, and deliberately vague about which half was wrong.

import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { byIp, clientIp, limit } from "@/lib/rate-limit";
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
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    logger.warn("Sign-in refused", { email, reason: user ? "inactive" : "unknown-email" });
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 401 });
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    logger.warn("Sign-in refused", { email, reason: "wrong-password" });
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 401 });
  }

  const ip = clientIp(request);
  await createSession(user.id, { ip, userAgent: request.headers.get("user-agent") ?? undefined });

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.activityLog.create({
      data: {
        actorId: user.id,
        entityType: "User",
        entityId: user.id,
        action: "LOGIN",
        summary: `${user.name} signed in`,
        metadata: { ip: ip ?? null },
      },
    }),
  ]);

  logger.info("Sign-in succeeded", { userId: user.id });
  return NextResponse.json({ ok: true, data: { id: user.id, name: user.name, role: user.role } });
}
