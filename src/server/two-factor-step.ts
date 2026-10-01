// The second half of signing in, written ONCE for both doors: the browser's `/api/auth/two-factor`
// and the Teams tab's `/api/teams/two-factor`. The route decides which cookie gets set — never a
// field in the request body — and everything else (the three limiters, the replay guard, the
// single transaction, the one-sentence miss) is exactly the same code, so the tab is not a second,
// free place to guess codes.
//
// See src/app/api/auth/two-factor/route.ts for the four rules this implements.

import { NextResponse } from "next/server";
import { mintSession, pruneExpiredSessions, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { checkOnly, clearFailures, clientIp, recordFailure } from "@/lib/rate-limit";
import { readJsonLimited } from "@/lib/read-json";
import { TEAMS_COOKIE, teamsCookieOptions, type TeamsVia } from "@/lib/teams-app";
import { TwoFactorChallengeInput } from "@/lib/zod-schemas";
import {
  SIGN_IN_TICKET_PURPOSES,
  consumeEmailToken,
  hashEmailToken,
  previewSignInTicket,
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

/**
 * Throws a ticket away whichever kind it is — after a password or after a Microsoft sign-in. The
 * hash is unique, so at most one of the two updates ever matches anything.
 */
async function burnTicket(pendingToken: string): Promise<void> {
  for (const purpose of SIGN_IN_TICKET_PURPOSES) {
    await consumeEmailToken(pendingToken, purpose);
  }
}

function failed(): NextResponse {
  return NextResponse.json({ ok: false, error: TWO_FACTOR_FAILED_MESSAGE }, { status: 401 });
}

/** The 429 every two-factor door answers with: a plain sentence and `Retry-After`. */
export function tooMany(message: string, retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

/** Which cookie the finished sign-in sets. Chosen by the ROUTE, never by anything in the request. */
export type TwoFactorDoor = "browser" | "teams";

export async function runTwoFactorStep(request: Request, door: TwoFactorDoor): Promise<NextResponse> {
  const via: TeamsVia | null = door === "teams" ? "teams" : null;
  // The `byIp` limiter (20 a minute) is asked by each ROUTE before it calls in here, so the limit is
  // visible where the door is; everything after it — the ticket budget, the account budget, the
  // transaction — is this one shared implementation.
  let body: unknown;
  try {
    body = await readJsonLimited(request);
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
    await burnTicket(pendingToken);
    return tooMany("Too many attempts. Please sign in again to start over.", tokenThrottle.retryAfterSec);
  }

  // Looking at the ticket never spends it — the same discretion every emailed link gets. Both kinds
  // of ticket are accepted: one minted after a password, one after a Microsoft sign-in. Which kind
  // it is decides nothing but the `method` written in the LOGIN row.
  const ticket = await previewSignInTicket(pendingToken);
  if (!ticket) return failed();
  const holder = ticket.user;
  const method = ticket.purpose === "TWOFA_PENDING_MICROSOFT" ? "microsoft" : "password";

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
  // off here, records it and tells the person). Either way this ticket is a proved password (or a
  // proved, linked Microsoft sign-in) from a minute ago, so the sign-in simply finishes without a second factor rather than dead-ending.
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
      const spent = await consumeEmailToken(pendingToken, ticket.purpose, tx);
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
            method,
            // Only the Teams door adds this: the trail says which door the sign-in came through.
            ...(via ? { via } : {}),
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
      await consumeEmailToken(pendingToken, ticket.purpose);
    }

    logger.warn("Second factor refused", { userId: user.id });
    return failed();
  }

  clearFailures(tokenKey);
  clearFailures(accountKey);

  void pruneExpiredSessions();

  logger.info("Sign-in succeeded", { userId: user.id, twoFactor: secondFactorStillApplies, via });
  const response = NextResponse.json({
    ok: true,
    data: { id: user.id, name: user.name, role: user.role, recoveryCodesLeft },
  });
  if (door === "teams") {
    // The tab's own cookie: SameSite=None; Secure; Partitioned; HttpOnly; Path=/teams.
    response.cookies.set(TEAMS_COOKIE, minted.rawToken, teamsCookieOptions(minted.expiresAt));
  } else {
    await setSessionCookie(minted.rawToken, minted.expiresAt);
  }
  return response;
}
