// Sessions and passwords: argon2 hashing, a random cookie token, and only the token's hash in the database.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import argon2 from "argon2";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { RoleValue } from "@/lib/permissions";

export const SESSION_COOKIE = "nexus_session";
const SESSION_DAYS = 7;
const MIN_SECRET_LENGTH = 32;

const secret = process.env.SESSION_SECRET ?? "";
if (process.env.NODE_ENV === "production" && secret.length < MIN_SECRET_LENGTH) {
  throw new Error(
    "SESSION_SECRET is missing or too short. Generate at least 32 random bytes before starting in production.",
  );
}

/** Hashes the raw cookie token for storage — HMAC when a secret exists, plain SHA-256 in local development. */
function hashToken(rawToken: string): string {
  return secret
    ? createHmac("sha256", secret).update(rawToken).digest("hex")
    : createHash("sha256").update(rawToken).digest("hex");
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: RoleValue;
  disciplineId: string | null;
  jobTitle: string | null;
};

/** Hashes a password for storage. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/** Checks a password against its stored hash. Never throws on a malformed hash. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch (error) {
    logger.warn("Password verification failed", { error });
    return false;
  }
}

export type MintedSession = { rawToken: string; tokenHash: string; expiresAt: Date };

/** Mints a fresh session token. The hash goes to the database; the raw token only ever to the cookie. */
export function mintSession(): MintedSession {
  const rawToken = randomBytes(32).toString("hex");
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  };
}

/** Puts the raw session token in the httpOnly cookie. Call only after the session row is committed. */
export async function setSessionCookie(rawToken: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Best-effort sweep of expired session rows — cheap thanks to the expiresAt index. */
export async function pruneExpiredSessions(): Promise<void> {
  try {
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    logger.warn("Expired-session sweep failed", { error });
  }
}

/** Creates a session row and puts the raw token in an httpOnly cookie. The raw token is never stored. */
export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<void> {
  const minted = mintSession();
  await prisma.session.create({
    data: {
      tokenHash: minted.tokenHash,
      userId,
      expiresAt: minted.expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  await setSessionCookie(minted.rawToken, minted.expiresAt);
}

/**
 * A fixed argon2 hash of a random throwaway value, verified on the unknown-email
 * path so failures cost the same time whether or not the account exists.
 */
const DUMMY_HASH_PROMISE: Promise<string> = argon2.hash(randomBytes(16).toString("hex"), {
  type: argon2.argon2id,
});

export async function burnPasswordCheck(): Promise<void> {
  try {
    await argon2.verify(await DUMMY_HASH_PROMISE, "not-the-password");
  } catch {
    // Timing equalisation only — the result is irrelevant.
  }
}

/** Reads the cookie and returns the signed-in person, or null. Safe to call from any server component or route. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  if (!session.user.isActive) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    disciplineId: session.user.disciplineId,
    jobTitle: session.user.jobTitle,
  };
}

/** Same as getSessionUser but sends anyone signed out to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Deletes the current session row and clears the cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Loads the project memberships needed to build a permissions Actor. */
export async function loadActor(user: SessionUser) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id },
    select: { projectId: true, projectRole: true, disciplineId: true },
  });
  return { userId: user.id, role: user.role, memberships };
}

/** Constant-time string compare, for anywhere a token is compared outside the database. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
