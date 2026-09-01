// The second half of signing in: the six digits from an authenticator app, or one recovery code.
//
// Four rules govern this route:
//  1. **The pending token alone is never a way in.** It only says a password was accepted less than
//     five minutes ago; a session exists only once the second factor has been proved as well.
//  2. **A miss never says why.** A wrong code, a wrong recovery code, an expired ticket, a spent
//     ticket and one that never existed all answer the same sentence with the same status.
//  3. **Everything lands together.** Spending the ticket, spending a recovery code, creating the
//     session, stamping lastLoginAt and appending the LOGIN row are one transaction; the cookie is
//     only set after it commits.
//  4. **These limiters are their own.** Wrong codes count against this ticket and this account's
//     second step — never against the password limiter, which would let somebody guessing codes
//     lock the real owner out of the sign-in form.

import { NextResponse } from "next/server";
import { mintSession, pruneExpiredSessions, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { byIp, checkOnly, clearFailures, clientIp, limit, recordFailure } from "@/lib/rate-limit";
import { TwoFactorChallengeInput } from "@/lib/zod-schemas";
import {
  consumeEmailToken,
  hashEmailToken,
  previewEmailToken,
} from "@/server/services/email-tokens";
import {
  TWO_FACTOR_ACCOUNT_TRIES,
  TWO_FACTOR_ACCOUNT_WINDOW_MS,
  TWO_FACTOR_FAILED_MESSAGE,
  TWO_FACTOR_USER_SELECT,
  checkSecondFactor,
  readableTotpSecret,
  twoFactorAccountKey,
} from "@/server/services/two-factor";

/** Wrong tries allowed against ONE ticket before it is thrown away and the password is asked for again. */
const TRIES_PER_TOKEN = 5;

/** Thrown inside the transaction so a failed attempt rolls the whole thing back, ticket included. */
class SecondFactorMiss extends Error {}

function failed(): NextResponse {
  return NextResponse.json({ ok: false, error: TWO_FACTOR_FAILED_MESSAGE }, { status: 401 });
}

function tooMany(message: string, retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function POST(request: Request) {
  const throttle = limit(byIp(request, "two-factor"), 20, 60_000);
  if (!throttle.ok) {
    return tooMany(
      "Too many attempts. Please wait a minute and try again.",
      throttle.retryAfterSec,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was not readable." }, { status: 400 });
  }

  const parsed = TwoFactorChallengeInput.safeParse(body);
  if (!parsed.success) return failed();
  const { pendingToken, code, recoveryCode } = parsed.data;

  // The ticket's own budget is asked FIRST, before a single row is read: the key is the hash of
  // what arrived, which needs no database at all, and a ticket that has already been guessed at
  // five times must not buy another lookup. It is keyed by the hash and never the ticket itself, so
  // nothing in the limiter could ever be replayed.
  const tokenKey = `twofa-token:${hashEmailToken(pendingToken)}`;
  const tokenThrottle = checkOnly(tokenKey, TRIES_PER_TOKEN);
  if (!tokenThrottle.ok) {
    // This ticket is finished with: it is marked used, so the only way on is the password again.
    await consumeEmailToken(pendingToken, "TWOFA_PENDING");
    return tooMany("Too many attempts. Please sign in again to start over.", tokenThrottle.retryAfterSec);
  }

  // Looking at the ticket never spends it — the same discretion every emailed link gets.
  const holder = await previewEmailToken(pendingToken, "TWOFA_PENDING");
  if (!holder) return failed();

  // The same budget the account page spends when somebody proves the second factor there — one
  // ceiling per account, wherever the guessing happens.
  const accountKey = twoFactorAccountKey(holder.id);
  const accountThrottle = checkOnly(accountKey, TWO_FACTOR_ACCOUNT_TRIES);
  if (!accountThrottle.ok) {
    return tooMany(
      "Too many attempts. Please wait a few minutes and try again.",
      accountThrottle.retryAfterSec,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: holder.id },
    select: { ...TWO_FACTOR_USER_SELECT, role: true },
  });
  if (!user) return failed();

  // Two-factor may have been switched off since the password was accepted — an administrator's
  // reset, or a SESSION_SECRET rotation that makes the saved secret unreadable (which switches it
  // off here, records it and tells the person). Either way this ticket is a proved password from a
  // minute ago, so the sign-in simply finishes without a second factor rather than dead-ending.
  const secret = user.totpEnabledAt ? await readableTotpSecret(user) : null;
  const secondFactorStillApplies = secret !== null;

  const ip = clientIp(request);
  const minted = mintSession();

  let recoveryCodesLeft: number | null = null;

  try {
    recoveryCodesLeft = await prisma.$transaction(async (tx) => {
      let step: number | null = null;
      let codesLeft: number | null = null;

      if (secondFactorStillApplies && secret) {
        const outcome = await checkSecondFactor(tx, user, secret, { code, recoveryCode });
        if (outcome.kind === "miss") throw new SecondFactorMiss();
        if (outcome.kind === "code") step = outcome.step;
        if (outcome.kind === "recovery") codesLeft = outcome.codesLeft;
      }

      // THE REPLAY GUARD IS THIS WRITE, not the read that chose the step. Two requests carrying the
      // same six digits on two different tickets can both pass the check in the same millisecond;
      // only one of them can be the conditional update that moves the step forward, and the loser
      // matches no row, rolls everything back and is answered like any other miss.
      if (step !== null) {
        const claimed = await tx.user.updateMany({
          where: {
            id: user.id,
            OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
          },
          data: { totpLastUsedStep: step },
        });
        if (claimed.count === 0) throw new SecondFactorMiss();
      }

      // The ticket is spent LAST of the checks and inside the same transaction: a wrong code rolls
      // this back, so the person keeps their remaining tries, and two browsers racing one ticket
      // can only ever have one winner.
      const spent = await consumeEmailToken(pendingToken, "TWOFA_PENDING", tx);
      if (!spent) throw new SecondFactorMiss();

      await tx.session.create({
        data: {
          tokenHash: minted.tokenHash,
          userId: user.id,
          expiresAt: minted.expiresAt,
          ip: ip ?? undefined,
          userAgent: request.headers.get("user-agent")?.slice(0, 300),
        },
      });

      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      await tx.activityLog.create({
        data: {
          actorId: user.id,
          entityType: "User",
          entityId: user.id,
          action: "LOGIN",
          summary: `${user.name} signed in`,
          metadata: {
            reportedIp: ip ?? null,
            twoFactor: secondFactorStillApplies,
            recoveryCode: codesLeft !== null,
          },
        },
      });

      return codesLeft;
    });
  } catch (error) {
    if (!(error instanceof SecondFactorMiss)) throw error;

    recordFailure(tokenKey, TWO_FACTOR_ACCOUNT_WINDOW_MS);
    recordFailure(accountKey, TWO_FACTOR_ACCOUNT_WINDOW_MS);

    // The try that used the last one kills the ticket as well, rather than leaving a spent-out
    // ticket lying around until it expires.
    if (!checkOnly(tokenKey, TRIES_PER_TOKEN).ok) {
      await consumeEmailToken(pendingToken, "TWOFA_PENDING");
    }

    logger.warn("Second factor refused", { userId: user.id });
    return failed();
  }

  await setSessionCookie(minted.rawToken, minted.expiresAt);
  clearFailures(tokenKey);
  clearFailures(accountKey);

  void pruneExpiredSessions();

  logger.info("Sign-in succeeded", { userId: user.id, twoFactor: secondFactorStillApplies });
  return NextResponse.json({
    ok: true,
    data: { id: user.id, name: user.name, role: user.role, recoveryCodesLeft },
  });
}
