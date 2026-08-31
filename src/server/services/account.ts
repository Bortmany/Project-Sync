// The account flows an emailed link carries: a forgotten password, an invitation, a verification.
//
// Four rules govern this file:
//  1. **Asking for a reset tells nobody anything.** `requestPasswordReset()` answers the same
//     nothing whether the address has an account, has a deactivated one, belongs to a contractor
//     whose access has run out, or has never existed. The decision about whether to send is taken
//     in here, where nobody outside can watch it.
//  2. **A link is spent inside the transaction it changes the account in.** Consuming the token,
//     writing the new password, dropping every session and appending the audit row either all
//     happen or none of them do — so a link can never be burnt without the change it was for.
//  3. **A link is never a way in.** Nothing here mints a session or sets a cookie: somebody who has
//     just set a password signs in with it, like everybody else. That is also what keeps an EXTERNAL
//     contractor whose access has expired out — `getSessionUser()` refuses them, and a reset link
//     hands them nothing that would get past it.
//  4. **A miss never says why.** Wrong, tampered with, expired, already used or belonging to a
//     deactivated account all answer with the same one sentence.

import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { isAccessExpired } from "@/lib/access-expiry";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import type {
  EmailSentDTO,
  PasswordChangedDTO,
  ResendInviteInput,
  ResetPasswordInput,
  SetPasswordInput,
  VerifyEmailInput,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import {
  appendEmailActivity,
  emailAvailable,
  emailLink,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/server/services/email";
import {
  EMAIL_TOKEN_TTL_MS,
  consumeEmailToken,
  hashEmailToken,
  issueEmailToken,
} from "@/server/services/email-tokens";

/* ------------------------------------------------------------------ */
/* The wording, in one place                                           */
/* ------------------------------------------------------------------ */

/** Said to everybody who asks for a reset link, whatever we found. */
export const RESET_REQUESTED_MESSAGE =
  "If that address has a Tielora account, we've sent a link to reset your password.";

/** Said on every screen and every route in this round while no mail provider is set up. */
export const EMAIL_DORMANT_MESSAGE =
  "Password resets by email aren't available right now. Please contact your workspace administrator to have your password reset.";

/** The administrator's version of the same fact, on the two admin paths. */
export const INVITE_DORMANT_MESSAGE =
  "Invitations by email aren't set up. Set this person a first password instead.";

/** Wrong, tampered with, expired, already used — one answer for all of them. */
export const LINK_DEAD_MESSAGE = "This link no longer works. It may have expired or already been used.";

/* ------------------------------------------------------------------ */
/* Passwords nobody knows                                              */
/* ------------------------------------------------------------------ */

/**
 * A password hash that cannot be matched by anything anybody could type.
 *
 * An invited account is created with one of these: there is no first password to leak, to write
 * down or to pass along a corridor, and until the invitation is accepted no combination of
 * characters signs in. It is a real argon2 hash of 32 random bytes that are then thrown away, so
 * sign-in costs exactly what it costs for everybody else and reveals nothing by its timing.
 */
export function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("hex"));
}

/* ------------------------------------------------------------------ */
/* Forgotten passwords                                                 */
/* ------------------------------------------------------------------ */

/**
 * Sends a reset link — or quietly does not.
 *
 * Returns nothing at all, on purpose: the route answers the same sentence either way, so an
 * outsider typing addresses into the form learns nothing about which of them are real. An account
 * only earns a link when it can actually sign in: active, and not a contractor whose access has
 * already run out.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  // Nothing to send with, so nothing is issued either: the screens say so plainly instead.
  if (!emailAvailable()) return;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true, accessExpiresAt: true, role: true },
  });
  if (!user || !user.isActive || isAccessExpired(user)) return;

  const { rawToken } = await prisma.$transaction(async (tx) => {
    const issued = await issueEmailToken(user.id, "RESET", EMAIL_TOKEN_TTL_MS.RESET, tx);
    // The person asked for their own link, so they are the actor — there is nobody else to name,
    // and the request itself arrives with no session behind it.
    await appendEmailActivity(tx, {
      actorId: user.id,
      recipientId: user.id,
      recipientName: user.name,
      purpose: "RESET",
    });
    return issued;
  });

  const link = emailLink("RESET", rawToken);
  if (link) {
    void sendPasswordResetEmail({ id: user.id, name: user.name, email: user.email }, link);
  }
}

/**
 * Spends a reset link and sets the new password.
 *
 * Everything happens in one transaction: the link is used up, the password is replaced, **every
 * session that account holds is deleted**, and the audit row is appended. The promise the screen
 * makes — "you've been signed out everywhere else" — is kept here or not at all.
 */
export async function resetPassword(input: ResetPasswordInput): Promise<PasswordChangedDTO> {
  // Hashing is slow and needs no transaction open around it.
  const passwordHash = await hashPassword(input.password);

  const done = await prisma.$transaction(async (tx) => {
    const user = await consumeEmailToken(input.token, "RESET", tx);
    if (!user) return false;

    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: user.id } });

    await appendActivity(tx, {
      actorId: user.id,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.PASSWORD_RESET,
      summary: `${user.name} set a new password from a reset link`,
      // What happened, never what was chosen. No password, no token, no link.
      metadata: { sessionsEnded: true },
    });

    return true;
  });

  if (!done) throw new ServiceError(LINK_DEAD_MESSAGE);
  return { changed: true };
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/** Who an invitation is for. Never carries a password hash or anything else about the account. */
export type InviteTarget = { id: string; name: string; email: string };

/**
 * Mints the invitation link and records that we meant to send it — **inside the caller's
 * transaction**, so the account, its link and the audit row all arrive together or not at all.
 * Returns the raw token for the caller to hand to `deliverInvite()` once it has committed.
 */
export async function issueInvite(
  tx: Prisma.TransactionClient,
  actor: { userId: string; name: string },
  target: InviteTarget,
): Promise<string> {
  const { rawToken } = await issueEmailToken(target.id, "INVITE", EMAIL_TOKEN_TTL_MS.INVITE, tx);
  await appendEmailActivity(tx, {
    actorId: actor.userId,
    actorName: actor.name,
    recipientId: target.id,
    recipientName: target.name,
    purpose: "INVITE",
  });
  return rawToken;
}

/**
 * Puts the invitation on the wire. Call it AFTER the transaction has committed and never await it —
 * the same road `deliverToOrgWebhooks()` takes, so a slow mail provider can never hold up an
 * administrator's screen or undo the account they just created.
 */
export function deliverInvite(
  target: InviteTarget,
  rawToken: string,
  inviterName: string,
  organizationName: string,
): void {
  const link = emailLink("INVITE", rawToken);
  if (!link) return;
  void sendInviteEmail({ ...target, inviterName, organizationName }, link);
}

/**
 * Sends somebody's invitation again, retiring the one already in their inbox.
 *
 * Only for an account that has never signed in: somebody who has already chosen a password does
 * not need a fresh invitation, and "New password" in the same dialog is what that person's
 * administrator wants instead.
 */
export async function resendInvite(
  actor: ActorContext,
  input: ResendInviteInput,
): Promise<EmailSentDTO> {
  assertCan(actor, "MANAGE_USERS");
  if (!emailAvailable()) throw new ServiceError(INVITE_DORMANT_MESSAGE);

  const target = await prisma.user.findFirst({
    where: { id: input.id, orgId: actor.orgId },
    select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true },
  });
  if (!target) throw new NotFoundError("We could not find that person.");
  if (!target.isActive) {
    throw new ServiceError("This account cannot sign in. Reactivate it first, then invite them.");
  }
  if (target.lastLoginAt) {
    throw new ServiceError(
      "This person has already signed in. Set them a new password from Edit instead.",
    );
  }

  const organization = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { name: true },
  });

  const rawToken = await prisma.$transaction((tx) =>
    issueInvite(tx, { userId: actor.userId, name: actor.name }, target),
  );

  deliverInvite(target, rawToken, actor.name, organization?.name ?? "Tielora");
  return { sent: true };
}

/**
 * Spends an invitation link: the first password, and the address proved along with it.
 *
 * Accepting an invitation **marks the address verified** — the link only ever existed in that
 * inbox, which is the whole of what verification asks. Any session the account somehow holds is
 * dropped for the same reason a reset drops them, and no session is created: they sign in next,
 * deliberately, like everybody else.
 */
export async function acceptInvite(input: SetPasswordInput): Promise<PasswordChangedDTO> {
  const passwordHash = await hashPassword(input.password);

  const done = await prisma.$transaction(async (tx) => {
    const user = await consumeEmailToken(input.token, "INVITE", tx);
    if (!user) return false;

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });

    await appendActivity(tx, {
      actorId: user.id,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.INVITE_ACCEPTED,
      summary: `${user.name} accepted their invitation and set a password`,
      metadata: { emailVerified: true },
    });

    return true;
  });

  if (!done) throw new ServiceError(LINK_DEAD_MESSAGE);
  return { changed: true };
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/**
 * Issues and sends a verification email inside the caller's transaction, then hands back the raw
 * token so the caller can put it on the wire after committing. Used by self-serve signup and by
 * the "resend verification email" action.
 */
export async function issueVerification(
  tx: Prisma.TransactionClient,
  user: { id: string; name: string },
): Promise<string> {
  const { rawToken } = await issueEmailToken(user.id, "VERIFY", EMAIL_TOKEN_TTL_MS.VERIFY, tx);
  await appendEmailActivity(tx, {
    actorId: user.id,
    recipientId: user.id,
    recipientName: user.name,
    purpose: "VERIFY",
  });
  return rawToken;
}

/** Puts a verification email on the wire. After the commit, never awaited. */
export function deliverVerification(user: InviteTarget, rawToken: string): void {
  const link = emailLink("VERIFY", rawToken);
  if (!link) return;
  void sendVerificationEmail(user, link);
}

/**
 * "Resend verification email", from the banner. Somebody may only ever ask for their own.
 *
 * An address that is already verified answers the same cheerful nothing rather than an error —
 * there is nothing wrong with pressing it twice, and verification restricts nobody either way.
 */
export async function resendVerification(actor: ActorContext): Promise<EmailSentDTO> {
  if (!emailAvailable()) throw new ServiceError("Verification emails aren't set up on this Tielora.");

  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (!user) throw new NotFoundError("We could not find your account.");
  if (user.emailVerifiedAt) return { sent: true };

  const rawToken = await prisma.$transaction((tx) => issueVerification(tx, user));
  deliverVerification({ id: user.id, name: user.name, email: user.email }, rawToken);
  return { sent: true };
}

/**
 * Was THIS link the one that did the verifying, some moments ago?
 *
 * Corporate mail security opens every link in a message before the person does — Outlook Safe
 * Links, Gmail's fetcher — and `/verify-email` is the one page in this round that spends its token
 * on sight, because being seen IS the confirmation. Without this check the scanner burns the link
 * and the human who follows a second later is told it no longer works, which is both wrong and
 * alarming.
 *
 * So a spent link is looked up once: if it really was a verification link, it really has been
 * used, and that account really is verified now, the visitor is shown the success they earned.
 * Nothing is revealed by saying so — they are holding the token, which is the only thing that
 * could ever have proved this, and no state changes here. Every other miss (a made-up token, a
 * link for another purpose, an account since deactivated, one used but somehow not verified)
 * still answers the same plain nothing.
 *
 * The two password pages need none of this: they only PREVIEW their token when they render and
 * spend it on submit, so a scanner following them changes nothing at all.
 */
async function alreadyVerifiedByThisLink(
  tx: Prisma.TransactionClient,
  rawToken: string,
): Promise<boolean> {
  const row = await tx.emailToken.findUnique({
    where: { tokenHash: hashEmailToken(rawToken) },
    select: {
      purpose: true,
      usedAt: true,
      user: { select: { isActive: true, emailVerifiedAt: true } },
    },
  });

  return (
    row !== null &&
    row.purpose === "VERIFY" &&
    row.usedAt !== null &&
    row.user.isActive &&
    row.user.emailVerifiedAt !== null
  );
}

/**
 * Spends a verification link. Sets `emailVerifiedAt` and nothing else — verification is a nudge,
 * never a lock, so this grants no permission anybody did not already have.
 */
export async function verifyEmailWithToken(input: VerifyEmailInput): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const user = await consumeEmailToken(input.token, "VERIFY", tx);
    // Spent already: either a mail scanner got here first (in which case the address is verified
    // and this visitor should be told so) or it is a genuine miss, which says nothing.
    if (!user) return alreadyVerifiedByThisLink(tx, input.token);

    // An address verified some other way in the meantime — by accepting an invitation, say — keeps
    // the moment it was actually proved, and earns no second audit row.
    if (!user.emailVerifiedAt) {
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await appendActivity(tx, {
        actorId: user.id,
        projectId: null,
        entityType: "User",
        entityId: user.id,
        action: ACTIVITY.EMAIL_VERIFIED,
        summary: `${user.name} verified their email address`,
      });
    }

    return true;
  });
}

/**
 * Does the signed-in person still need the verification nudge?
 *
 * Deliberately simple: any account with no verified address, whenever email is set up. That
 * includes people an administrator created with a temporary password — they are unverified by
 * design — and that is accepted rather than special-cased: the banner is a soft, dismissible line
 * and the resend is one press, which is a smaller cost than a rule nobody can predict.
 */
export async function needsVerificationNudge(userId: string): Promise<boolean> {
  if (!emailAvailable()) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  return user !== null && user.emailVerifiedAt === null;
}
