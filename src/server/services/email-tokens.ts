// The single-use links that go out by email: an invitation, a password reset, an email verification.
//
// Three rules govern this file:
//  1. **The raw token is minted once and never stored.** Only its SHA-256 hash reaches the database
//     — exactly what `Session.tokenHash` does — so a copy of the database hands nobody a working
//     link. The caller gets the raw token back once, puts it in the email, and forgets it.
//  2. **A link works exactly once.** Consuming one is a single conditional UPDATE on
//     (hash + purpose + not used + not expired); two browsers racing the same link can only ever
//     have one winner, because only one of them can be the update that flipped `usedAt`.
//  3. **A miss never says why.** Wrong, tampered with, expired, already used, or belonging to a
//     deactivated account all return the same `null`. The screens say "this link no longer works"
//     and nothing more — the same discretion the external rule's "not found" carries.
//
// Nothing here sends anything. Delivery lives in src/server/services/email.ts.

import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { EmailedPurposeName, EmailPurposeName } from "@/lib/zod-schemas";

/**
 * How long each kind of token lives. Short for a reset (it is a recovery moment, and the person is
 * at their keyboard), a day for a verification, a week for an invitation (a new colleague may be
 * away when it lands).
 *
 * EXPORT and TWOFA_PENDING are the two that are never emailed. EXPORT is the download bearer for a
 * finished workspace export, and a day is long enough to fetch a large file without leaving a way
 * into a company's whole record lying around all week. TWOFA_PENDING is the ticket between the
 * password step and the six-digit step of one sign-in: five minutes is long enough to find a phone
 * and short enough that a copied ticket is worth nothing by the time anybody could use it.
 */
export const EMAIL_TOKEN_TTL_MS: Record<EmailPurposeName, number> = {
  RESET: 60 * 60 * 1000, // 1 hour
  VERIFY: 24 * 60 * 60 * 1000, // 24 hours
  INVITE: 7 * 24 * 60 * 60 * 1000, // 7 days
  EXPORT: 24 * 60 * 60 * 1000, // 24 hours
  TWOFA_PENDING: 5 * 60 * 1000, // 5 minutes
};

/**
 * Plain English for how long a link lasts, for the email copy. Keyed by the purposes that are
 * really emailed, so there is nothing here for EXPORT to be written into.
 */
export const EMAIL_TOKEN_TTL_WORDS: Record<EmailedPurposeName, string> = {
  RESET: "1 hour",
  VERIFY: "24 hours",
  INVITE: "7 days",
};

/**
 * What the database stores. Plain SHA-256 rather than the HMAC `Session` uses: a session token
 * lives in a cookie for a week and is the whole of somebody's sign-in, while these are minutes-to-
 * days long, single use, and must stay verifiable if `SESSION_SECRET` is ever rotated in an
 * emergency — a rotation signs everyone out on purpose, but it should not also kill every
 * invitation in flight. The token is 32 random bytes either way, which is what actually stops it
 * being guessed.
 */
export function hashEmailToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Everything a screen or a flow needs about whoever a link belongs to. Never a password hash. */
export type EmailTokenUser = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
};

const USER_SELECT = {
  id: true,
  orgId: true,
  email: true,
  name: true,
  isActive: true,
  emailVerifiedAt: true,
} as const;

export type IssuedEmailToken = {
  /** The raw token. It leaves this function once, goes into the link, and is never seen again. */
  rawToken: string;
  expiresAt: Date;
};

/**
 * Mints a fresh link for somebody and stores only its hash.
 *
 * Issuing a new token of the same purpose **marks every earlier live one used**, so the newest link
 * in somebody's inbox is always the only one that works: pressing "resend" cannot leave two valid
 * reset links lying around, and a re-sent invitation retires the one that went out last week.
 *
 * Pass `tx` to run inside the caller's transaction — which is what a service does, so that the
 * token and the audit row about the email either both exist or neither does.
 */
export async function issueEmailToken(
  userId: string,
  purpose: EmailPurposeName,
  ttlMs: number = EMAIL_TOKEN_TTL_MS[purpose],
  tx: Prisma.TransactionClient = prisma,
): Promise<IssuedEmailToken> {
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMs);

  await tx.emailToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  await tx.emailToken.create({
    data: { userId, purpose, tokenHash: hashEmailToken(rawToken), expiresAt },
  });

  return { rawToken, expiresAt };
}

/**
 * Retires every sign-in ticket this person is holding: their unused `TWOFA_PENDING` rows are marked
 * used, so none of them can finish a sign-in any more.
 *
 * **The rule it keeps: any change to a credential or to the second factor retires outstanding
 * sign-in tickets.** A ticket says "this account's password was accepted a moment ago" — the moment
 * that password is replaced, or the second factor it was waiting for is taken off, that sentence is
 * no longer true, and a ticket left alive would be a five-minute window in which the OLD password's
 * proof still opened the door. Called inside the caller's transaction, so the ticket dies with the
 * change rather than after it.
 */
export async function retireSignInTickets(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.emailToken.updateMany({
    where: { userId, purpose: "TWOFA_PENDING", usedAt: null },
    data: { usedAt: new Date() },
  });
}

/**
 * Who a live link belongs to, WITHOUT using it up.
 *
 * This is what a page renders from: `/set-password` needs the address the invitation was sent to
 * before anybody has typed a password, and `/reset-password` needs to know whether to show a form
 * or "this link no longer works" — neither should burn the link just by being looked at. The link
 * is only spent when the form is submitted, through `consumeEmailToken`.
 */
export async function previewEmailToken(
  rawToken: string,
  purpose: EmailPurposeName,
): Promise<EmailTokenUser | null> {
  const row = await prisma.emailToken.findFirst({
    where: {
      tokenHash: hashEmailToken(rawToken),
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { user: { select: USER_SELECT } },
  });

  if (!row || !row.user.isActive) return null;
  return row.user;
}

/**
 * Spends a link and returns whoever it belongs to, or `null`.
 *
 * The update is the lock: `usedAt: null` in the WHERE clause means the second attempt matches
 * nothing, however close together the two arrive. Wrong token, wrong purpose (a reset link pasted
 * into the invitation page), expired, already used and deactivated account all answer `null` with
 * nothing to tell them apart.
 */
export async function consumeEmailToken(
  rawToken: string,
  purpose: EmailPurposeName,
  tx: Prisma.TransactionClient = prisma,
): Promise<EmailTokenUser | null> {
  const tokenHash = hashEmailToken(rawToken);

  const spent = await tx.emailToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (spent.count === 0) return null;

  const row = await tx.emailToken.findUnique({
    where: { tokenHash },
    select: { user: { select: USER_SELECT } },
  });

  // A link belonging to a deactivated account is spent and then refused, exactly like one that had
  // already been used: the person on the other end learns nothing either way.
  if (!row || !row.user.isActive) return null;
  return row.user;
}
