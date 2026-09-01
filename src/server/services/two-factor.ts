// Two-factor sign-in: the authenticator app, the eight recovery codes, and the two ways it comes
// back off again.
//
// Five rules govern this file:
//  1. **The secret is never readable outside this module.** It is sealed with `src/lib/secret-box.ts`
//     under its own purpose and never appears in a DTO, an audit row, a log line or an export. The
//     only things that ever leave are the QR code and the manual key, once, at the moment somebody
//     is setting the app up.
//  2. **A half-finished enrolment gates nothing.** A secret with no `totpEnabledAt` beside it is
//     somebody who opened the dialog and closed it again; they sign in with their password exactly
//     as they did before, and starting again simply overwrites the secret.
//  3. **The same code never works twice.** A six-digit code is valid for a good ninety seconds, so
//     the step it belonged to is stored and only a HIGHER step is ever accepted afterwards.
//  4. **Turning it off needs the second factor, never the password alone.** Somebody who has walked
//     up to an unlocked laptop already has the password; a live code or an unused recovery code is
//     the only proof this file accepts. The one exception is an administrator of that company, whose
//     reset is audited and tells the person it happened.
//  5. **A rotated SESSION_SECRET must not lock anybody out.** If the sealed secret can no longer be
//     opened, two-factor is switched off for that account there and then, recorded, and the person
//     is told in the app so they can set it up again.

import { createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { checkOnly, clearFailures, recordFailure } from "@/lib/rate-limit";
import { SecretBoxUnavailableError, deriveKey, open, seal } from "@/lib/secret-box";
import {
  TOTP_WINDOW_STEPS,
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  verifyTotpCode,
} from "@/lib/totp";
import type {
  ConfirmTwoFactorInput,
  TwoFactorCodesDTO,
  TwoFactorEnrollmentDTO,
  TwoFactorProofInput,
  TwoFactorStatusDTO,
} from "@/lib/zod-schemas";
import {
  TwoFactorCodesDTO as TwoFactorCodesSchema,
  TwoFactorEnrollmentDTO as TwoFactorEnrollmentSchema,
  TwoFactorStatusDTO as TwoFactorStatusSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { retireSignInTickets } from "@/server/services/email-tokens";

/** The name the secret is sealed under. A value sealed for anything else will not open as this. */
export const TOTP_SECRET_PURPOSE = "twofactor.totp-secret";

/**
 * The name the recovery-code key is derived under. Codes are KEYED-hashed rather than plain-hashed
 * (see `hashRecoveryCode`), and the key comes from the same HKDF root the sealed secret uses.
 */
export const RECOVERY_CODE_PURPOSE = "twofactor.recovery-code";

/** What the authenticator app calls this account. */
const ISSUER = "Tielora";

/** How many recovery codes somebody is given, and how many are left before the screen worries. */
export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODES_LOW = 2;

/**
 * The alphabet recovery codes are drawn from: no I, O, 0 or 1, so nothing is ever mistyped off a
 * printout. Ten characters from 32 is 50 bits — far more than anybody will ever guess through a
 * limiter that stops at five wrong tries, and the stored form is keyed (below) so 50 bits is not
 * something an offline attacker with a copy of the database can chew through either.
 */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_LENGTH = 10;

/**
 * Said for every kind of miss on the second sign-in step, so a failure never says which half was
 * wrong. It carries the way out as well as the refusal: a five-minute ticket that has run out looks
 * exactly like a wrong code from here, and "try again" on its own would be a dead end.
 */
export const TWO_FACTOR_FAILED_MESSAGE =
  "That code was not right. Try again, or sign in again to start over.";

/**
 * Said when somebody inside the app offers the wrong proof — a wrong code, a recovery code that was
 * already spent, one that never existed. One sentence for all of them, so a refusal never says
 * which.
 */
export const TWO_FACTOR_PROOF_REQUIRED_MESSAGE = "That code was not right. Try again.";

/** Said once somebody has spent the account's budget of wrong guesses, wherever they spent it. */
export const TWO_FACTOR_TOO_MANY_MESSAGE =
  "Too many attempts. Please wait a few minutes and try again.";

/**
 * ONE failure budget per account for the second factor, and every door shares it: the sign-in route,
 * turning two-factor off, and replacing the recovery codes. Sharing is the point — a stolen session
 * grinding guesses at "turn it off" is the same attack as a stolen password grinding them at the
 * sign-in screen, and a budget that only covered one of them would just move the attack.
 *
 * It is deliberately separate from `login-account:<email>`: somebody guessing codes must never be
 * able to lock the real owner out of the password form.
 */
export const TWO_FACTOR_ACCOUNT_TRIES = 8;
export const TWO_FACTOR_ACCOUNT_WINDOW_MS = 15 * 60_000;

export function twoFactorAccountKey(userId: string): string {
  return `twofa-account:${userId}`;
}

/**
 * Runs a piece of work that has to prove the second factor, counting only the misses.
 *
 * A success forgives the count, exactly as a correct password forgives the sign-in count: somebody
 * who fat-fingers two codes and then gets one right is not carrying a penalty around for a quarter
 * of an hour. Only a wrong-proof refusal is counted — a plan limit, a database failure or a
 * "two-factor is not on" refusal are not guesses and must not spend anybody's budget.
 */
async function withAttemptBudget<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const key = twoFactorAccountKey(userId);
  if (!checkOnly(key, TWO_FACTOR_ACCOUNT_TRIES).ok) {
    throw new ServiceError(TWO_FACTOR_TOO_MANY_MESSAGE);
  }

  try {
    const result = await work();
    clearFailures(key);
    return result;
  } catch (error) {
    if (error instanceof ServiceError && error.message === TWO_FACTOR_PROOF_REQUIRED_MESSAGE) {
      recordFailure(key, TWO_FACTOR_ACCOUNT_WINDOW_MS);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whatever somebody typed, as the one form that is ever hashed: ten upper-case characters with no
 * hyphens and no spaces. `RecoveryCodeSchema` does the same thing on the way in, and this does it
 * again here — a service never assumes its caller parsed.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * What the database stores: an **HMAC-SHA256 under a key derived from `SESSION_SECRET`**, not a
 * plain hash.
 *
 * An emailed link is 32 random bytes and a plain SHA-256 of it is unguessable, which is why
 * `EmailToken.tokenHash` is one. A recovery code is ten readable characters — 50 bits — because a
 * person has to copy it off a printout, and 50 bits of plain SHA-256 is something somebody holding a
 * stolen database can grind through offline. Keying it means the database alone is not enough: an
 * attacker needs `SESSION_SECRET` as well, exactly as they do for the TOTP secret sitting beside it.
 *
 * The coupling this creates is already there and costs nothing new: rotating `SESSION_SECRET` makes
 * the sealed secret unreadable, which switches two-factor off for that account and DELETES its
 * recovery codes anyway (see `resetUnreadableSecret`). There is no state in which unreadable codes
 * outlive the secret they belong to.
 */
export function hashRecoveryCode(code: string): string {
  return createHmac("sha256", deriveKey(RECOVERY_CODE_PURPOSE))
    .update(normalizeRecoveryCode(code))
    .digest("hex");
}

/**
 * The stored form: ten characters, no separators, upper case — what `RecoveryCodeSchema` produces.
 *
 * The alphabet has exactly 32 characters and 256 is a multiple of 32, so taking each random byte
 * modulo the alphabet length is perfectly even — no rejection sampling and no bias to reason about.
 */
function randomRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return code;
}

/** The readable form, in three groups: `XXXX-XXXX-XX`. Hyphens are cosmetic and are never stored. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/**
 * Replaces every recovery code this person holds with eight fresh ones, inside the caller's
 * transaction. Returns them in plain text for the ONE screen that shows them; the database keeps
 * only their hashes, so nothing can ever show them again.
 */
async function replaceRecoveryCodes(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });

  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const code = randomRecoveryCode();
    if (!codes.includes(code)) codes.push(code);
  }

  await tx.twoFactorRecoveryCode.createMany({
    data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
  });

  return codes.map(formatRecoveryCode);
}

/**
 * Spends one recovery code, inside the caller's transaction.
 *
 * The conditional update IS the lock: `usedAt: null` in the WHERE clause means a second attempt
 * with the same code matches nothing, however close together the two arrive.
 */
async function spendRecoveryCode(
  tx: Prisma.TransactionClient,
  userId: string,
  recoveryCode: string,
): Promise<{ spent: boolean; codesLeft: number }> {
  const result = await tx.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(recoveryCode), usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) return { spent: false, codesLeft: 0 };

  const codesLeft = await tx.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
  return { spent: true, codesLeft };
}

/**
 * Takes two-factor off an account: the three columns and every recovery code, inside the caller's
 * transaction. The one place that undoing is written, so the four doors it can come off through —
 * the person, an administrator, an unreadable secret and a deleted account — can never drift apart.
 */
export async function clearTwoFactor(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null },
  });
  await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
}

/* ------------------------------------------------------------------ */
/* The secret                                                          */
/* ------------------------------------------------------------------ */

/** What every check below needs about an account. Never a password hash, never a DTO. */
export type TwoFactorUser = {
  id: string;
  orgId: string;
  name: string;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpLastUsedStep: number | null;
};

/** The columns to select wherever a `TwoFactorUser` is read. */
export const TWO_FACTOR_USER_SELECT = {
  id: true,
  orgId: true,
  name: true,
  totpSecretEnc: true,
  totpEnabledAt: true,
  totpLastUsedStep: true,
} as const;

/**
 * Switches two-factor off because the stored secret can no longer be read, records it, and tells
 * the person. Called from `readableTotpSecret()` and nowhere else.
 *
 * The audit row says WHY in one word and never carries the secret, the ciphertext or anything about
 * it. The notification is written straight into the person's own bell rather than through
 * `notify()`, which is a fan-out to OTHER people and skips whoever caused it; this is a notice to
 * exactly one person about their own account, and it must never reach a company's chat channel.
 */
async function resetUnreadableSecret(user: TwoFactorUser): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await clearTwoFactor(tx, user.id);

    await appendActivity(tx, {
      actorId: user.id,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.TWO_FACTOR_RESET_SYSTEM,
      summary: `Two-factor sign-in was switched off for ${user.name} because the saved setting could no longer be read`,
      metadata: { reason: "secret-unreadable-after-rotation" },
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        type: "ANNOUNCEMENT",
        title: "Two-factor sign-in was switched off",
        body: "We could not read the two-factor setting saved on your account, so it has been switched off. Set it up again from Your account — it takes a minute.",
        linkUrl: "/account",
      },
    });
  });

  // The kind of failure and whose account, never the value that would not open.
  logger.warn("Two-factor was reset because its saved secret could not be read", {
    userId: user.id,
  });
}

/**
 * The secret for an account with two-factor switched on, or null when there is nothing to check
 * against any more.
 *
 * Null means one of two things, and both are safe: the account never had a secret, or the sealed
 * value could not be opened — which is what a rotated `SESSION_SECRET` looks like — in which case
 * two-factor has just been switched off, recorded and notified, and the caller should carry on with
 * an ordinary password-only sign-in. Any OTHER failure is re-thrown: a missing `SESSION_SECRET` is
 * a deployment fault, not a rotation, and must never quietly disarm everybody's second factor.
 */
export async function readableTotpSecret(user: TwoFactorUser): Promise<Buffer | null> {
  if (!user.totpSecretEnc) return null;

  try {
    return Buffer.from(open(TOTP_SECRET_PURPOSE, user.totpSecretEnc), "base64");
  } catch (error) {
    if (error instanceof SecretBoxUnavailableError) throw error;
    if (user.totpEnabledAt) await resetUnreadableSecret(user);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Enrolling                                                           */
/* ------------------------------------------------------------------ */

/** Where somebody stands, for the card on their account page. */
export async function twoFactorStatus(actor: ActorContext): Promise<TwoFactorStatusDTO> {
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: { totpEnabledAt: true },
  });
  if (!user) throw new NotFoundError("We could not find your account.");

  const codesLeft = user.totpEnabledAt
    ? await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } })
    : 0;

  return checkDto(
    TwoFactorStatusSchema,
    {
      enabled: user.totpEnabledAt !== null,
      enabledAt: user.totpEnabledAt,
      recoveryCodesLeft: codesLeft,
    },
    "TwoFactorStatusDTO",
  );
}

/**
 * Starts setting two-factor up: a fresh secret, sealed and saved with no enabled date beside it.
 *
 * Nothing is switched on here and nothing is audited — nobody has attested to anything yet, and a
 * secret with no date gates no sign-in. Pressing the button again simply overwrites it, which is
 * what somebody who abandoned the dialog on another device needs to happen.
 */
export async function beginTwoFactorEnrollment(
  actor: ActorContext,
): Promise<TwoFactorEnrollmentDTO> {
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: { id: true, email: true, totpEnabledAt: true },
  });
  if (!user) throw new NotFoundError("We could not find your account.");
  if (user.totpEnabledAt) {
    throw new ServiceError("Two-factor sign-in is already on for your account.");
  }

  const secret = generateTotpSecret();
  const manualKey = base32Encode(secret);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretEnc: seal(TOTP_SECRET_PURPOSE, secret.toString("base64")),
      totpEnabledAt: null,
      totpLastUsedStep: null,
    },
  });

  const url = otpauthUrl({ secret: manualKey, accountName: user.email, issuer: ISSUER });
  // Drawn on the server into a data: URI, so the page needs no JavaScript and the secret never
  // travels anywhere the browser could cache it as a file.
  const qrDataUri = await QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: "M" });

  return checkDto(
    TwoFactorEnrollmentSchema,
    { qrDataUri, manualKey, otpauthUrl: url },
    "TwoFactorEnrollmentDTO",
  );
}

/**
 * Finishes setting it up: one working code out of the app is the proof it is really configured.
 *
 * Everything lands in one transaction — the enabled date, the step that code used up, the eight
 * recovery codes and the audit row — so nobody can ever end up switched on with no way back in.
 * The codes are returned once and never again.
 */
export async function confirmTwoFactorEnrollment(
  actor: ActorContext,
  input: ConfirmTwoFactorInput,
): Promise<TwoFactorCodesDTO> {
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: TWO_FACTOR_USER_SELECT,
  });
  if (!user) throw new NotFoundError("We could not find your account.");
  if (user.totpEnabledAt) {
    throw new ServiceError("Two-factor sign-in is already on for your account.");
  }

  const secret = await readableTotpSecret(user);
  if (!secret) {
    throw new ServiceError("Start again — scan the QR code, then enter the code from your app.");
  }

  const step = verifyTotpCode(secret, input.code, {
    window: TOTP_WINDOW_STEPS,
    afterStep: user.totpLastUsedStep,
  });
  if (step === null) {
    throw new ServiceError(TWO_FACTOR_PROOF_REQUIRED_MESSAGE);
  }

  const codes = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date(), totpLastUsedStep: step },
    });

    const fresh = await replaceRecoveryCodes(tx, user.id);

    await appendActivity(tx, {
      actorId: user.id,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.TWO_FACTOR_ENABLED,
      summary: `${user.name} switched two-factor sign-in on`,
      // How many codes were issued, never one of them.
      metadata: { recoveryCodes: RECOVERY_CODE_COUNT },
    });

    return fresh;
  });

  return checkDto(TwoFactorCodesSchema, { codes }, "TwoFactorCodesDTO");
}

/* ------------------------------------------------------------------ */
/* Proving the second factor from inside the app                       */
/* ------------------------------------------------------------------ */

/**
 * Checks the proof somebody offered for turning two-factor off or replacing their codes, and spends
 * it. Runs inside the caller's transaction so a recovery code and the change it paid for either
 * both happen or neither does.
 */
async function assertSecondFactor(
  tx: Prisma.TransactionClient,
  user: TwoFactorUser,
  secret: Buffer,
  input: TwoFactorProofInput,
): Promise<void> {
  if (input.recoveryCode) {
    const { spent } = await spendRecoveryCode(tx, user.id, input.recoveryCode);
    if (!spent) throw new ServiceError(TWO_FACTOR_PROOF_REQUIRED_MESSAGE);
    return;
  }

  const step = input.code
    ? verifyTotpCode(secret, input.code, {
        window: TOTP_WINDOW_STEPS,
        afterStep: user.totpLastUsedStep,
      })
    : null;
  if (step === null) throw new ServiceError(TWO_FACTOR_PROOF_REQUIRED_MESSAGE);

  await tx.user.update({ where: { id: user.id }, data: { totpLastUsedStep: step } });
}

/** The signed-in person's own account, or a plain refusal when two-factor is not on. */
async function loadEnrolledSelf(actor: ActorContext): Promise<TwoFactorUser> {
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: TWO_FACTOR_USER_SELECT,
  });
  if (!user) throw new NotFoundError("We could not find your account.");
  if (!user.totpEnabledAt) throw new ServiceError("Two-factor sign-in is not on for your account.");
  return user;
}

/**
 * Switches two-factor off, with proof.
 *
 * A password is deliberately NOT enough: somebody sitting at an unlocked laptop has the password
 * already, and the whole point of the second factor is that it is somewhere else. A live code or an
 * unused recovery code is the only way through here — the other door is an administrator's reset,
 * which is audited and tells the person it happened.
 */
export async function disableTwoFactor(
  actor: ActorContext,
  input: TwoFactorProofInput,
): Promise<TwoFactorStatusDTO> {
  const user = await loadEnrolledSelf(actor);

  const secret = await readableTotpSecret(user);
  // Unreadable means it has just been switched off for them anyway, which is what they asked for.
  if (!secret) return twoFactorStatus(actor);

  await withAttemptBudget(user.id, () =>
    prisma.$transaction(async (tx) => {
      await assertSecondFactor(tx, user, secret, input);
      await clearTwoFactor(tx, user.id);
      // The second factor has just changed, so any sign-in ticket waiting for it is retired here.
      await retireSignInTickets(tx, user.id);

      await appendActivity(tx, {
        actorId: user.id,
        projectId: null,
        entityType: "User",
        entityId: user.id,
        action: ACTIVITY.TWO_FACTOR_DISABLED,
        summary: `${user.name} switched two-factor sign-in off`,
        metadata: { by: input.recoveryCode ? "recovery-code" : "app-code" },
      });
    }),
  );

  return twoFactorStatus(actor);
}

/**
 * Replaces the eight recovery codes with eight fresh ones. Every old code stops working the moment
 * this commits — which is exactly what somebody who has lost the printout needs.
 */
export async function regenerateRecoveryCodes(
  actor: ActorContext,
  input: TwoFactorProofInput,
): Promise<TwoFactorCodesDTO> {
  const user = await loadEnrolledSelf(actor);

  const secret = await readableTotpSecret(user);
  if (!secret) {
    throw new ServiceError(
      "Two-factor sign-in has been switched off for your account. Set it up again from Your account.",
    );
  }

  const codes = await withAttemptBudget(user.id, () =>
    prisma.$transaction(async (tx) => {
      await assertSecondFactor(tx, user, secret, input);
      const fresh = await replaceRecoveryCodes(tx, user.id);

      await appendActivity(tx, {
        actorId: user.id,
        projectId: null,
        entityType: "User",
        entityId: user.id,
        action: ACTIVITY.TWO_FACTOR_CODES_REPLACED,
        summary: `${user.name} replaced their two-factor recovery codes`,
        metadata: {
          recoveryCodes: RECOVERY_CODE_COUNT,
          by: input.recoveryCode ? "recovery-code" : "app-code",
        },
      });

      return fresh;
    }),
  );

  return checkDto(TwoFactorCodesSchema, { codes }, "TwoFactorCodesDTO");
}

/* ------------------------------------------------------------------ */
/* Proving the second factor while signing in                          */
/* ------------------------------------------------------------------ */

export type SecondFactorProof = { code?: string; recoveryCode?: string };

/** What the sign-in route learns from one attempt. A miss says nothing about which half was wrong. */
export type SecondFactorOutcome =
  | { kind: "code"; step: number }
  | { kind: "recovery"; codesLeft: number }
  | { kind: "miss" };

/**
 * Checks the code (or recovery code) somebody typed on the second sign-in screen, inside the
 * route's own transaction — so spending a recovery code, minting the session and writing the audit
 * row all commit together or not at all.
 *
 * It changes nothing else: the route stores the matched step on the account in the same
 * transaction, which is what stops the same six digits being used twice.
 */
export async function checkSecondFactor(
  tx: Prisma.TransactionClient,
  user: TwoFactorUser,
  secret: Buffer,
  proof: SecondFactorProof,
): Promise<SecondFactorOutcome> {
  if (proof.recoveryCode) {
    const { spent, codesLeft } = await spendRecoveryCode(tx, user.id, proof.recoveryCode);
    return spent ? { kind: "recovery", codesLeft } : { kind: "miss" };
  }

  const step = proof.code
    ? verifyTotpCode(secret, proof.code, {
        window: TOTP_WINDOW_STEPS,
        afterStep: user.totpLastUsedStep,
      })
    : null;

  return step === null ? { kind: "miss" } : { kind: "code", step };
}

// The administrator's reset lives beside the other people-administration writes, in
// `src/server/services/admin.ts` — it is one administrator acting on somebody else's account, which
// is what that file is, and it uses `clearTwoFactor()` above so undoing is written in one place.
